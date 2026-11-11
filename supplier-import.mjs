import {supplierAIConfig,recognizeSupplierBlocks,suggestSupplierLayout} from './supplier-ai.mjs';
import {ossRequest,MAX_WORKBOOK_BYTES} from './oss-multipart.mjs';
import {createWriteStream} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import {Transform,Readable} from 'node:stream';
import {statfs} from 'node:fs/promises';
import {normalizeMallMappings} from './public/mall-mappings.js';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {imageType,uploadImage,storageDestination,compactImageKey} from './image-storage.mjs';
import {validateProduct} from './core.mjs';
const execute=promisify(execFile),hash=v=>createHash('sha256').update(v).digest('hex');
const workbuddyFields={title_zh:2,title_en:2,spec:1,attributes:4,notes:4};
const workbuddyFormat='ops-supplier-review-v1';
const workbuddyRevision=data=>hash(JSON.stringify(data.products.map(({key,bounds,title,barcodes,cost,price,images})=>[key,bounds,title,barcodes,cost,price,images])));
function applySupplierReview(p,review){
 if(!review)return p;
 const {values,refs,issues}=review;
 const title=[...new Set([...(values.title_en||[]),...(values.title_zh||[])])].join(' / ');
 const warnings=[...p.warnings.filter(w=>!title||!w.includes('暂取首行作为名称')),...issues.map(v=>(review.origin||'WorkBuddy')+' 待核对：'+v)];
 const description=[...new Set([p.description,...(values.notes||[])].filter(Boolean))].join('\n\n');
 const attributes=[...p.attributes];
 if(values.attributes?.length)attributes.push({name:'产品属性',value:values.attributes.join(' / ').slice(0,1000)});
 return {...p,images:review.image&&p.images.includes(review.image)?[review.image,...p.images.filter(id=>id!==review.image)]:p.images,title:title||p.title,spec_hint:p.barcodes.length<=1&&values.spec?.[0]||p.spec_hint,description,attributes,warnings,review_refs:refs};
}
export function supplierImports({db,dataDir,root,getStorage,allowedStorage,recordCollector,audit,prepareCharge,chargeProduct,storeImage,fetchImpl=fetch,aiConfig=supplierAIConfig(),getAIConfig=()=>aiConfig,logAI=entry=>console.info(JSON.stringify(entry)),python=process.env.PYTHON_BIN||'python3'}){
 const directory=join(dataDir,'supplier-previews'),active=new Set();let parsing=0;
 db.exec("CREATE TABLE IF NOT EXISTS supplier_batches(id TEXT PRIMARY KEY,owner TEXT NOT NULL,supplier TEXT NOT NULL,filename TEXT NOT NULL,data TEXT NOT NULL,created INTEGER NOT NULL,state TEXT NOT NULL DEFAULT 'ready',plan TEXT,results TEXT NOT NULL DEFAULT '[]',destination TEXT);CREATE TABLE IF NOT EXISTS supplier_uploaded(batch_id TEXT NOT NULL,asset TEXT NOT NULL,url TEXT NOT NULL,PRIMARY KEY(batch_id,asset));");
 for(const [name,type] of [['billing_rate',"TEXT NOT NULL DEFAULT ''"],['remote_source',"TEXT NOT NULL DEFAULT ''"],['parse_error',"TEXT NOT NULL DEFAULT ''"],['parse_started','INTEGER NOT NULL DEFAULT 0']])if(!db.prepare('PRAGMA table_info(supplier_batches)').all().some(c=>c.name===name))db.exec('ALTER TABLE supplier_batches ADD COLUMN '+name+' '+type);
 db.exec("UPDATE supplier_batches SET billing_rate='{\"due\":0,\"legacy\":true}' WHERE plan IS NOT NULL AND billing_rate=''");
 db.exec("CREATE TABLE IF NOT EXISTS supplier_layouts(owner TEXT NOT NULL,supplier TEXT NOT NULL,signature TEXT NOT NULL,mapping TEXT NOT NULL,PRIMARY KEY(owner,supplier,signature))");
 async function inspectWorkbook(dir){
  const {stdout}=await execute(python,[join(root,'scripts/parse-supplier-xlsx.py'),join(dir,'input.xlsx'),dir,'inspect'],{timeout:15000,maxBuffer:4*1024*1024});
  return JSON.parse(stdout);
 }
 function layoutSignature(layouts,mapping){
  const rows=layouts.find(layout=>layout.sheet===mapping.sheet)?.rows;
  const header=rows?.[mapping.start_row-1];
  if(!header?.[mapping.columns.title]||Object.keys(header).length<2)return null;
  return hash(JSON.stringify([mapping.sheet,mapping.start_row,Object.entries(header).sort(([a],[b])=>Number(a)-Number(b))]));
 }
 async function retryKnownLayout(r,dir){
  const templates=db.prepare('SELECT signature,mapping FROM supplier_layouts WHERE owner=? AND supplier=?').all(r.owner,r.supplier);
  if(!templates.length)return null;
  const layouts=await inspectWorkbook(dir);
  for(const template of templates){
   const mapping=JSON.parse(template.mapping);
   if(layoutSignature(layouts,mapping)!==template.signature)continue;
   return execute(python,[join(root,'scripts/parse-supplier-xlsx.py'),join(dir,'input.xlsx'),dir,JSON.stringify(mapping)],{timeout:120000,maxBuffer:4*1024*1024});
  }
  return null;
 }
 async function enrichWithAI(data,dir,r,metrics,trackedFetch){
  const candidates=data.products.filter(p=>p.needs_ai&&p.bounds);
  metrics.candidates=candidates.length;
  if(!candidates.length){metrics.reason='local_parse_sufficient';return;}
  let aiConfig;try{aiConfig=getAIConfig();}catch{metrics.reason='configuration_error';return;}
  if(!aiConfig){metrics.reason='ai_disabled';return;}
  metrics.reason='ambiguous_product_blocks';
  const groups=Object.create(null),file=join(dir,'ai-'+randomUUID()+'.json');
  for(const p of candidates)(groups[p.sheet]??=[]).push({key:p.key,bounds:p.bounds});
  try{
   db.prepare("UPDATE supplier_batches SET parse_error='正在调用 NewAPI 识别商品字段和图片位置' WHERE id=? AND state='parsing'").run(r.id);
   await writeFile(file,JSON.stringify(groups),{mode:0o600,flag:'wx'});
   const {stdout}=await execute(python,[join(root,'scripts/parse-supplier-xlsx.py'),join(dir,'input.xlsx'),dir,'ai-blocks',file],{timeout:25000,maxBuffer:20*1024*1024});
   const {review,recognized,unresolved,diagnostics}=await recognizeSupplierBlocks(candidates,JSON.parse(stdout),aiConfig,trackedFetch);
   metrics.ai_diagnostics=diagnostics;
   data.ai={recognized,unresolved,local:data.products.length-candidates.length};data.ai_review=review;
  }catch{
   data.ai={recognized:0,unresolved:candidates.length,local:data.products.length-candidates.length};
  }finally{await rm(file,{force:true}).catch(()=>{});}
 }
 async function parseBatch(r){
  const dir=join(directory,r.id),started=Date.now();
  const metrics={event:'supplier_ai_parse',batch_id:r.id,outcome:'parse_failed',reason:'local_parse_failed',products:0,candidates:0,recognized:0,unresolved:0,requests:0,http_statuses:{},network_errors:0};
  const trackedFetch=async(...args)=>{
   metrics.requests++;
   try{
    const response=await fetchImpl(...args);
    const status=response.status;metrics.http_statuses[status]=(metrics.http_statuses[status]||0)+1;
    return response;
   }catch(error){metrics.network_errors++;throw error;}
  };
  parsing++;
  try{
   if(r.remote_source){const remote=JSON.parse(r.remote_source),c=getStorage();if(!c?.enabled||!allowedStorage(r.owner,c)||storageDestination(c)!==remote.destination)throw Error('OSS配置或授权发生变化');const free=await statfs(dataDir);if(free.bavail*free.bsize<remote.size+1024*1024*1024)throw Error('解析所需磁盘空间不足，请先清理');const response=await ossRequest(c,remote.key,'GET',{}, {},undefined,fetchImpl);let size=0;await pipeline(Readable.fromWeb(response.body),new Transform({transform(chunk,encoding,callback){size+=chunk.length;callback(size>remote.size||size>MAX_WORKBOOK_BYTES?Error('OSS文件大小异常'):null,chunk);}}),createWriteStream(join(dir,'input.xlsx'),{mode:0o600}));if(size!==remote.size)throw Error('OSS文件不完整');}
   let out,aiLayout=false;
   try{out=await execute(python,[join(root,'scripts/parse-supplier-xlsx.py'),join(dir,'input.xlsx'),dir],{timeout:120000,maxBuffer:4*1024*1024});}
   catch(e){
    let message;try{message=JSON.parse(e.stdout).error;}catch{}
    if(message?.startsWith('未识别到商品')){
     out=await retryKnownLayout(r,dir).catch(()=>null);
     if(!out)try{
      const config=getAIConfig();
      if(config){
       metrics.reason='layout_fallback';
       const mapping=await suggestSupplierLayout(await inspectWorkbook(dir),config,trackedFetch);
       if(mapping){
        out=await execute(python,[join(root,'scripts/parse-supplier-xlsx.py'),join(dir,'input.xlsx'),dir,JSON.stringify(mapping)],{timeout:60000,maxBuffer:4*1024*1024});
        aiLayout=true;
       }
      }else metrics.reason='ai_disabled';
     }catch{}
    }
    if(!out)throw Error(message||'表格解析失败或超时，请确认文件完整、无密码且为支持的报价单版式');
   }
   const data=JSON.parse(out.stdout);if(data.error)throw Error(data.error);for(const a of data.assets)imageType(await readFile(join(dir,a.file)));
   if(aiLayout){
    data.ai={layout:true};
    for(const p of data.products)p.warnings.push('使用 AI 建议列生成，请核对字段与价格');
   }else await enrichWithAI(data,dir,r,metrics,trackedFetch);
   metrics.products=data.products.length;metrics.recognized=data.ai?.recognized||0;metrics.unresolved=data.ai?.unresolved||0;
   db.prepare("UPDATE supplier_batches SET data=?,state='ready',parse_error='' WHERE id=? AND state='parsing'").run(JSON.stringify(data),r.id);
   metrics.outcome='ready';
  }catch(e){db.prepare("UPDATE supplier_batches SET state='parse_failed',parse_error=? WHERE id=? AND state='parsing'").run(String(e.message).slice(0,500),r.id);}
  finally{parsing--;try{logAI({...metrics,duration_ms:Date.now()-started});}catch{}if(r.remote_source){try{const remote=JSON.parse(r.remote_source),c=getStorage();if(c&&storageDestination(c)===remote.destination){const response=await ossRequest(c,remote.key,'DELETE',{}, {},undefined,fetchImpl);await response.body?.cancel();db.prepare("UPDATE supplier_batches SET remote_source='' WHERE id=?").run(r.id);}}catch{console.error('supplier_private_cleanup_pending');}}}

 }
 async function tick(){
  if(parsing)return;
  db.prepare("UPDATE supplier_batches SET state='parse_failed',parse_error='解析进程中断，请删除此预览后重新上传' WHERE state='parsing' AND parse_started<?").run(Date.now()-300000);
  const r=db.prepare("SELECT * FROM supplier_batches WHERE state='queued' ORDER BY created LIMIT 1").get();if(!r)return;
  if(!db.prepare("UPDATE supplier_batches SET state='parsing',parse_started=? WHERE id=? AND state='queued'").run(Date.now(),r.id).changes)return;
  await parseBatch(r);
 }
 function batch(owner,id){const r=db.prepare('SELECT * FROM supplier_batches WHERE owner=? AND id=?').get(owner,id);if(!r)throw Error('货盘预览不存在或不属于当前空间');return r;}
 const sourceFor=(supplier,p)=>'supplier:'+hash(supplier.toLowerCase()+'|'+(p.barcodes.length?p.barcodes.join('|'):p.title));
 function view(r){const d=JSON.parse(r.data);
 const wanted=new Set(d.products.flatMap(p=>p.barcodes||[])),matches=new Map();
 if(wanted.size){
  for(const row of db.prepare("SELECT p.id,p.data FROM products p WHERE p.owner=? AND EXISTS (SELECT 1 FROM jobs j WHERE j.owner=p.owner AND j.product_id=p.id AND j.status='succeeded')").iterate(r.owner)){
   const product=JSON.parse(row.data);
   for(const code of new Set((product.skus||[]).map(s=>s.sku).filter(code=>wanted.has(code)))){
    const ids=matches.get(code)||new Map();if(ids.size<6)ids.set(row.id,{id:row.id,title:product.title});matches.set(code,ids);
   }
  }
 }
 return {id:r.id,supplier:r.supplier,filename:r.filename,ai:d.ai||null,state:active.has(r.id)?'processing':r.state,error:r.parse_error||'',products:d.products.map(original=>{
  const p=applySupplierReview(original,d.workbuddy?.[original.key]||d.ai_review?.[original.key]);
  const existing=db.prepare('SELECT id FROM products WHERE owner=? AND source=?').get(r.owner,sourceFor(r.supplier,original));
  if(!existing){
   const candidates=new Map();
   for(const code of p.barcodes||[])for(const [id,match] of matches.get(code)||[])if(candidates.size<5)candidates.set(id,match);
   return candidates.size?{...p,publication_candidates:[...candidates.values()]}:p;
  }
  const publications=db.prepare("SELECT target,mall_connection_id,remote_id,revision FROM jobs WHERE owner=? AND product_id=? AND status='succeeded' ORDER BY created DESC,id DESC").all(r.owner,existing.id);
  const seen=new Set();
  return {...p,existing_product:{id:existing.id,publications:publications.filter(j=>{const key=JSON.stringify([j.target,j.mall_connection_id]);if(seen.has(key))return false;seen.add(key);return true;})}};
 }),assets:d.assets.map(a=>({id:a.id,url:'/api/supplier-imports/'+r.id+'/assets/'+a.id})),results:JSON.parse(r.results),plan:r.plan?JSON.parse(r.plan):null};}
 async function prune(){for(const r of db.prepare('SELECT id,state FROM supplier_batches WHERE created<?').all(Date.now()-86400000)){if(active.has(r.id)||r.state==='parsing')continue;await rm(join(directory,r.id),{recursive:true,force:true});db.prepare('DELETE FROM supplier_uploaded WHERE batch_id=?').run(r.id);db.prepare('DELETE FROM supplier_batches WHERE id=?').run(r.id);}}
 return {
  prune,tick,
  list(owner){
   return db.prepare('SELECT id,supplier,filename,state,created,remote_source FROM supplier_batches WHERE owner=? ORDER BY created DESC').all(owner).map(({remote_source,...row})=>({...row,deletable:!remote_source&&!active.has(row.id)&&['ready','parse_failed','done','partial'].includes(row.state)}));
  },
  async enqueueRemote(owner,input){
   if(input.uploadId){const existing=db.prepare('SELECT * FROM supplier_batches WHERE id=? AND owner=?').get(input.uploadId,owner);if(existing)return view(existing);}
   await prune();if(db.prepare('SELECT COUNT(*) n FROM supplier_batches WHERE owner=?').get(owner).n>=5)throw Error('最多保留5份货盘预览，请删除旧预览');
   if(db.prepare('SELECT COUNT(*) n FROM supplier_batches').get().n>=50)throw Error('预览数量已达上限');
   const remote=JSON.stringify({key:input.key,size:input.size,destination:input.destination}),existing=db.prepare('SELECT * FROM supplier_batches WHERE owner=? AND remote_source=?').get(owner,remote);if(existing)return view(existing);
   const id=input.uploadId||randomUUID(),dir=join(directory,id);await mkdir(dir,{recursive:true,mode:0o700});
   db.prepare("INSERT INTO supplier_batches(id,owner,supplier,filename,data,created,state,remote_source) VALUES(?,?,?,?,?,?,'queued',?)").run(id,owner,input.supplier,input.filename,JSON.stringify({products:[],assets:[]}),Date.now(),JSON.stringify({key:input.key,size:input.size,destination:input.destination}));audit(owner,'supplier.direct_upload',id);return view(batch(owner,id));
  },
  async enqueue(owner,input){return this.preview(owner,input,true);},
  async preview(owner,input,background=false){
   await prune();const supplier=String(input.supplier||'').trim(),filename=String(input.filename||'').slice(0,180);
   if(!supplier||supplier.length>100||!filename.toLowerCase().endsWith('.xlsx'))throw Error('请填写供应商并选择xlsx文件');
   if(!Buffer.isBuffer(input.bytes)&&(typeof input.data!=='string'||input.data.length>140*1024*1024||!/^[A-Za-z0-9+/]*={0,2}$/.test(input.data)))throw Error('文件数据无效或超过100MB');
   const bytes=Buffer.isBuffer(input.bytes)?input.bytes:Buffer.from(input.data,'base64');if(bytes.length>100*1024*1024||bytes.subarray(0,4).toString('hex')!=='504b0304')throw Error('请选择不超过100MB的xlsx文件');
   if(parsing>=2||db.prepare('SELECT COUNT(*) n FROM supplier_batches').get().n>=50)throw Error('货盘预览繁忙，请稍后重试或删除旧预览');
   if(db.prepare('SELECT COUNT(*) n FROM supplier_batches WHERE owner=?').get(owner).n>=5)throw Error('最多保留5份货盘预览，请删除旧预览或等待24小时过期');
   const id=randomUUID(),dir=join(directory,id);await mkdir(dir,{recursive:true,mode:0o700});await writeFile(join(dir,'input.xlsx'),bytes,{mode:0o600});
   db.prepare('INSERT INTO supplier_batches(id,owner,supplier,filename,data,created,state,parse_started) VALUES(?,?,?,?,?,?,?,?)').run(id,owner,supplier,filename,JSON.stringify({products:[],assets:[]}),Date.now(),background?'queued':'parsing',background?0:Date.now());audit(owner,'supplier.preview',id);
   if(!background)await parseBatch(batch(owner,id));
   const result=view(batch(owner,id));if(!background&&result.state==='parse_failed')throw Error(result.error);return result;
  },
  async layout(owner,id){
   const r=batch(owner,id);if(r.plan||!['ready','parse_failed'].includes(r.state)||active.has(id))throw Error('当前批次不能修改列映射');
   const dir=join(directory,id);
   const {stdout}=await execute(python,[join(root,'scripts/parse-supplier-xlsx.py'),join(dir,'input.xlsx'),dir,'inspect'],{timeout:15000,maxBuffer:1024*1024}).catch(()=>{throw Error('无法读取表格结构，请重新上传原表');});
   return JSON.parse(stdout);
  },
  workbuddyTemplate(owner,id){
   const r=batch(owner,id),data=JSON.parse(r.data);
   if(r.state!=='ready'||r.plan||active.has(id))throw Error('仅可整理尚未导入的货盘预览');
   if(data.products.some(p=>!p.bounds))throw Error('此预览由旧版本生成，请重新读取原 Excel 后下载清单');
   return {format:workbuddyFormat,batch_id:id,revision:workbuddyRevision(data),workbook:r.filename,
    instructions:'读取同一份原始 Excel，按 items 中每个商品的 sheet 和 bounds（起始行、结束行、起始列、结束列，均从1起且包含端点）提取字段。返回 JSON，只保留 format、batch_id、revision、items。每条 items 返回 key、fields、issues。fields 只允许这五个键：title_zh（最多2格）、title_en（最多2格）、spec（最多1格）、attributes（最多4格）、notes（最多4格）。每个值是 A1 坐标字符串数组，例如 {"title_en":["B13"],"title_zh":["B15"],"spec":["C14"]}，不要输出实际文字、坐标范围或其他键。使用有文字的合并单元格锚点，不猜测；拿不准则省略字段并在 issues 用简短中文说明。不要改图、条码、价格或库存，不重排原表；尽量覆盖所有商品。',
    items:data.products.map(p=>({key:p.key,sheet:p.sheet,bounds:p.bounds,current_title:p.title,fields:{},issues:[]}))};
  },
  async importWorkbuddy(owner,id,input){
   const r=batch(owner,id),data=JSON.parse(r.data);
   if(r.state!=='ready'||r.plan||active.has(id))throw Error('仅可整理尚未导入的货盘预览');
   if(input?.format!==workbuddyFormat||input.batch_id!==id||input.revision!==workbuddyRevision(data)||!Array.isArray(input.items)||!input.items.length||input.items.length>data.products.length)throw Error('整理结果不属于此预览，或商品清单格式不正确');
   const products=new Map(data.products.map(p=>[p.key,p])),review=Object.assign(Object.create(null),data.workbuddy),seen=new Set(),references=Object.create(null),pending=[];
   for(const row of input.items){
    const p=products.get(row?.key);
    if(!p?.bounds||seen.has(row.key)||!row.fields||typeof row.fields!=='object'||Array.isArray(row.fields))throw Error('整理结果包含重复、未知或无原表范围的商品');
    seen.add(row.key);
    const refs={},issues=row.issues??[];
    if(!Array.isArray(issues)||issues.length>5||issues.some(x=>typeof x!=='string'||x.length>180))throw Error('每款商品最多填5条待核对说明，每条不超过180字');
    const fieldIssues=[];
    for(const [field,raw] of Object.entries(row.fields)){
     if(!Object.hasOwn(workbuddyFields,field)){
      if(fieldIssues.length<5)fieldIssues.push('不支持字段「'+field.slice(0,40)+'」，已保留原预览');
      continue;
     }
     if(raw===null)continue;
     const list=typeof raw==='string'?[raw]:raw;
     const limit=workbuddyFields[field];
     if(!Array.isArray(list)||list.some(v=>typeof v!=='string')){
      fieldIssues.push(field+' 需要原表坐标数组，已保留原预览');continue;
     }
     const coordinates=[...new Set(list.map(ref=>ref.trim().toUpperCase().replace(/^\$([A-Z]{1,3})\$?([1-9][0-9]*)$/,'$1$2').replace(/^([A-Z]{1,3})\$([1-9][0-9]*)$/,'$1$2')).filter(Boolean))];
     if(coordinates.length>limit||coordinates.some(ref=>!/^[A-Z]{1,3}[1-9][0-9]{0,6}$/.test(ref))){
      fieldIssues.push(field+' 需填写不超过 '+limit+' 个单元格坐标，已保留原预览');continue;
     }
     refs[field]=coordinates;
     for(const ref of refs[field]){
      const m=typeof ref==='string'&&/^([A-Z]{1,3})([1-9][0-9]{0,6})$/.exec(ref),col=m&&[...m[1]].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0);
      const [first,last,left,right]=p.bounds;
      if(!m||+m[2]<first||+m[2]>last||col<left||col>right)throw Error('商品「'+p.title+'」的 '+field+' 坐标 '+ref+' 超出原表商品块');
      (references[p.sheet]??=new Set()).add(ref);
     }
    }
    pending.push({p,refs,issues:[...issues.map(x=>x.trim()).filter(Boolean),...fieldIssues]});
   }
   const dir=join(directory,id),file=join(dir,'review-'+randomUUID()+'.json');
   active.add(id);
   try{
    await writeFile(file,JSON.stringify(Object.fromEntries(Object.entries(references).map(([k,v])=>[k,[...v]]))),{mode:0o600,flag:'wx'});
    const {stdout}=await execute(python,[join(root,'scripts/parse-supplier-xlsx.py'),join(dir,'input.xlsx'),dir,'references',file],{timeout:25000,maxBuffer:16*1024*1024}).catch(()=>{throw Error('无法核对原表坐标，请检查原表或缩小本次整理范围');});
    const source=JSON.parse(stdout);
    for(const {p,refs,issues} of pending){
     const values={};
     for(const [field,list] of Object.entries(refs)){
      values[field]=list.map(ref=>source[p.sheet]?.[ref]);
      if(values[field].some(v=>typeof v!=='string'||!v.trim()))throw Error('商品「'+p.title+'」的 '+field+' 引用了空白或公式单元格 '+list.find((_,i)=>!values[field][i]));
     }
     if(!Object.values(values).some(v=>v.length)&&!issues.length)issues.push('未返回可补全的字段，请核对原表');
     if([...new Set([...(values.title_en||[]),...(values.title_zh||[])])].join(' / ').length>200){
      issues.push('合并标题超过 200 字（'+[...(refs.title_en||[]),...(refs.title_zh||[])].join('、')+'），已保留原名称');
      delete values.title_en;delete values.title_zh;delete refs.title_en;delete refs.title_zh;
     }
     if((values.spec?.[0]?.length||0)>100){
      issues.push('规格超过 100 字（'+refs.spec[0]+'），已保留原预览，请核对该单元格');
      delete values.spec;delete refs.spec;
     }
     if(values.spec?.length&&p.barcodes.length>1)issues.push('多条码商品的规格请逐个 SKU 核对');
     review[p.key]={values,refs,issues};
    }
    data.workbuddy=review;
    const updated=db.prepare("UPDATE supplier_batches SET data=? WHERE id=? AND owner=? AND state='ready' AND plan IS NULL AND data=?").run(JSON.stringify(data),id,owner,r.data);
    if(!updated.changes)throw Error('货盘预览已变化，请刷新后重新应用整理结果');
    audit(owner,'supplier.workbuddy_preview',id);
   }finally{try{await rm(file,{force:true});}finally{active.delete(id);}}
   return view(batch(owner,id));
  },
  async inspectBlock(owner,id,block){
   const r=batch(owner,id);if(r.plan||!['ready','parse_failed'].includes(r.state)||active.has(id))throw Error('当前批次不能预览商品块');
   const dir=join(directory,id);
   const {stdout}=await execute(python,[join(root,'scripts/parse-supplier-xlsx.py'),join(dir,'input.xlsx'),dir,'block',JSON.stringify(block)],{timeout:15000,maxBuffer:256*1024}).catch(e=>{let message;try{message=JSON.parse(e.stdout).error;}catch{}throw Error(message||'无法读取商品块，请检查行范围或重新上传原表');});
   return JSON.parse(stdout);
  },
  async remap(owner,id,mapping){
   const r=batch(owner,id);if(r.plan||!['ready','parse_failed'].includes(r.state)||active.has(id)||parsing>=2)throw Error('当前批次不能修改列映射');
   const dir=join(directory,id);active.add(id);parsing++;
   try{
    const {stdout}=await execute(python,[join(root,'scripts/parse-supplier-xlsx.py'),join(dir,'input.xlsx'),dir,JSON.stringify(mapping)],{timeout:120000,maxBuffer:4*1024*1024}).catch(e=>{let message;try{message=JSON.parse(e.stdout).error;}catch{}throw Error(message||'无法读取映射，请检查列和行号');});
    const data=JSON.parse(stdout);for(const a of data.assets)imageType(await readFile(join(dir,a.file)));
    db.prepare("UPDATE supplier_batches SET data=?,state='ready',parse_error='' WHERE id=?").run(JSON.stringify(data),id);
    if(!mapping.end_row){
     const layouts=await inspectWorkbook(dir).catch(()=>[]);
     const signature=layoutSignature(layouts,mapping);
     if(signature)db.prepare('INSERT OR REPLACE INTO supplier_layouts(owner,supplier,signature,mapping) VALUES(?,?,?,?)').run(r.owner,r.supplier,signature,JSON.stringify(mapping));
    }
   }finally{active.delete(id);parsing--;}
   return view(batch(owner,id));
  },
  get(owner,id){return view(batch(owner,id));},
  async asset(owner,id,asset){const r=batch(owner,id),a=JSON.parse(r.data).assets.find(a=>a.id===asset);if(!a)throw Error('图片不存在');const bytes=await readFile(join(directory,id,a.file));return {bytes,...imageType(bytes)};},
  async remove(owner,id){
   batch(owner,id);
   if(active.has(id))throw Error('正在处理，不能删除');
   const deleted=db.prepare("DELETE FROM supplier_batches WHERE id=? AND owner=? AND remote_source='' AND state IN ('ready','parse_failed','done','partial')").run(id,owner);
   if(!deleted.changes)throw Error('此预览正在处理或清理上传文件，暂不能删除');
   db.prepare('DELETE FROM supplier_uploaded WHERE batch_id=?').run(id);
   await rm(join(directory,id),{recursive:true,force:true}).catch(()=>console.error('supplier_preview_cleanup_failed'));
   return {ok:true};
  },
  start(owner,id,input){
   const r=batch(owner,id);if(!['ready','partial','done','processing'].includes(r.state))throw Error('请等待解析完成后再导入');if(active.has(id))return view(r);if(active.size>=2)throw Error('已有2个货盘正在导入，请稍后重试');const data=JSON.parse(r.data),c=getStorage();if(!c?.enabled||!allowedStorage(owner,c))throw Error('请先启用共享OSS，并将当前空间至少一个商城域名加入允许列表');
   if(!Array.isArray(input.items)||!input.items.length||input.items.length>500)throw Error('请选择1至500件商品');
   const keys=new Set();const items=input.items.map(item=>{
    const original=data.products.find(p=>p.key===item.key);if(!original||keys.has(item.key)||item.confirmed!==true)throw Error('请逐件确认商品及规格对应关系');keys.add(item.key);
    if(!String(item.title||'').trim()||!Array.isArray(item.skus)||!item.skus.length||item.skus.length>50)throw Error('标题或SKU无效');
    const specs=new Set(),codes=new Set();const skus=item.skus.map((s,i)=>{const cost=Number(s.cost),price=Number(s.price),stock=Number(s.stock),spec=String(s.spec||'').trim();if([s.cost,s.price,s.stock].some(x=>x===null||x===undefined||String(x).trim()==='')||!Number.isFinite(cost)||cost<0||!Number.isFinite(price)||price<=0||!Number.isSafeInteger(stock)||stock<0||!spec||specs.has(spec))throw Error('请填写每个SKU的成本、正售价、整数库存和不重复的规格');specs.add(spec);const raw=Object.hasOwn(s,'barcode')?String(s.barcode||'').trim():String(s.sku||original.barcodes[i]||'').trim();if(raw&&!/^[A-Za-z0-9._-]{1,100}$/.test(raw))throw Error('条码或SKU编码仅支持字母、数字、点、横线和下划线，最多100字');const sku=raw||'SUP-'+hash(r.supplier+'|'+original.key+'|'+i).slice(0,20);if(codes.has(sku))throw Error('同一商品的条码或SKU编码不能重复');codes.add(sku);return {sku,spec,cost,price,stock};});
    return {key:item.key,title:String(item.title).trim().slice(0,200),skus,confirmed:true,...(item.mall_mappings!==undefined?{mall_mappings:normalizeMallMappings(item.mall_mappings)}:{})};
   });
   const plan=JSON.stringify(items);if(r.plan&&r.plan!==plan)throw Error('此批次已开始导入，重试请保持原选择和内容；可重新上传文件建立新预览');if(r.destination&&r.destination!==storageDestination(c))throw Error('存储目标已变化，请恢复原存储配置再重试');
   const rate=r.billing_rate?JSON.parse(r.billing_rate):prepareCharge?.(owner,input.billing_revision,true);
   const completed=JSON.parse(r.results).filter(x=>x.ok);
   db.prepare("UPDATE supplier_batches SET plan=?,destination=?,state='processing',billing_rate=?,results=? WHERE id=?").run(plan,storageDestination(c),JSON.stringify(rate||null),JSON.stringify(completed),id);active.add(id);
   setImmediate(async()=>{let results=completed;try{
    for(const item of items){if(results.some(x=>x.key===item.key&&x.ok))continue;const original=data.products.find(p=>p.key===item.key);let result;
     try{
      const current=getStorage();if(!current?.enabled||!allowedStorage(owner,current)||storageDestination(current)!==storageDestination(c))throw Error('存储配置或授权已变化');
      const source=sourceFor(r.supplier,original);
      const existing=db.prepare('SELECT id FROM products WHERE owner=? AND source=?').get(owner,source);
      if(existing){result={key:item.key,ok:true,id:existing.id,duplicate:true};}
      else{
       const enriched=applySupplierReview(original,data.workbuddy?.[original.key]||data.ai_review?.[original.key]);
       const urls=[];for(const asset of enriched.images){let row=db.prepare('SELECT url FROM supplier_uploaded WHERE batch_id=? AND asset=?').get(id,asset);if(!row||row.url.length>128){const a=data.assets.find(a=>a.id===asset),bytes=await readFile(join(directory,id,a.file)),type=imageType(bytes),key=compactImageKey(owner,bytes,type.ext);const url=await (storeImage?storeImage(c,key,{bytes,...type},owner):uploadImage(c,key,{bytes,...type},{fetchImpl}));db.prepare('INSERT INTO supplier_uploaded VALUES(?,?,?) ON CONFLICT(batch_id,asset) DO UPDATE SET url=excluded.url').run(id,asset,url);row={url};}urls.push(row.url);}
       const latest=getStorage();if(!latest?.enabled||!allowedStorage(owner,latest)||storageDestination(latest)!==storageDestination(c))throw Error('存储配置或授权已变化，未创建商品');
       const metadata={supplier:r.supplier,batch_id:id,filename:r.filename,card:original.key,barcodes:original.barcodes,sku_codes:item.skus.map(s=>s.sku),packaging:original.packaging,category_hint:original.category_hint};
       const product=validateProduct({source_url:source,title:item.title,description:enriched.description,attributes:enriched.attributes,category:'',images:urls,detail_images:[],skus:item.skus,...(item.mall_mappings?{mall_mappings:item.mall_mappings,...(item.mall_mappings[0]||{})}:{})},{supplier:metadata});
       const pid=randomUUID(),now=new Date().toISOString();db.exec('BEGIN IMMEDIATE');try{db.prepare("INSERT INTO products(id,owner,source,data,status,revision,created,updated) VALUES(?,?,?,?,'draft',1,?,?)").run(pid,owner,source,JSON.stringify(product),now,now);chargeProduct?.(owner,pid,rate);recordCollector(pid);audit(owner,'supplier.import',pid);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}result={key:item.key,ok:true,id:pid};
      }
     }catch(e){result={key:item.key,ok:false,error:e.message};}
     results=results.filter(x=>x.key!==item.key);results.push(result);db.prepare('UPDATE supplier_batches SET results=? WHERE id=?').run(JSON.stringify(results),id);
    }
   }finally{active.delete(id);db.prepare('UPDATE supplier_batches SET state=? WHERE id=?').run(items.every(item=>results.some(r=>r.key===item.key&&r.ok))?'done':'partial',id);}});
   return view(batch(owner,id));
  }
 };
}
