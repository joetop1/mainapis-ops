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
export function supplierImports({db,dataDir,root,getStorage,allowedStorage,recordCollector,audit,prepareCharge,chargeProduct,storeImage,fetchImpl=fetch,python=process.env.PYTHON_BIN||'python3'}){
 const directory=join(dataDir,'supplier-previews'),active=new Set();let parsing=0;
 db.exec("CREATE TABLE IF NOT EXISTS supplier_batches(id TEXT PRIMARY KEY,owner TEXT NOT NULL,supplier TEXT NOT NULL,filename TEXT NOT NULL,data TEXT NOT NULL,created INTEGER NOT NULL,state TEXT NOT NULL DEFAULT 'ready',plan TEXT,results TEXT NOT NULL DEFAULT '[]',destination TEXT);CREATE TABLE IF NOT EXISTS supplier_uploaded(batch_id TEXT NOT NULL,asset TEXT NOT NULL,url TEXT NOT NULL,PRIMARY KEY(batch_id,asset));");
 for(const [name,type] of [['billing_rate',"TEXT NOT NULL DEFAULT ''"],['remote_source',"TEXT NOT NULL DEFAULT ''"],['parse_error',"TEXT NOT NULL DEFAULT ''"],['parse_started','INTEGER NOT NULL DEFAULT 0']])if(!db.prepare('PRAGMA table_info(supplier_batches)').all().some(c=>c.name===name))db.exec('ALTER TABLE supplier_batches ADD COLUMN '+name+' '+type);
 db.exec("UPDATE supplier_batches SET billing_rate='{\"due\":0,\"legacy\":true}' WHERE plan IS NOT NULL AND billing_rate=''");
 async function parseBatch(r){
  const dir=join(directory,r.id);parsing++;
  try{
   if(r.remote_source){const remote=JSON.parse(r.remote_source),c=getStorage();if(!c?.enabled||!allowedStorage(r.owner,c)||storageDestination(c)!==remote.destination)throw Error('OSS配置或授权发生变化');const free=await statfs(dataDir);if(free.bavail*free.bsize<remote.size+1024*1024*1024)throw Error('解析所需磁盘空间不足，请先清理');const response=await ossRequest(c,remote.key,'GET',{}, {},undefined,fetchImpl);let size=0;await pipeline(Readable.fromWeb(response.body),new Transform({transform(chunk,encoding,callback){size+=chunk.length;callback(size>remote.size||size>MAX_WORKBOOK_BYTES?Error('OSS文件大小异常'):null,chunk);}}),createWriteStream(join(dir,'input.xlsx'),{mode:0o600}));if(size!==remote.size)throw Error('OSS文件不完整');}
   let out;try{out=await execute(python,[join(root,'scripts/parse-supplier-xlsx.py'),join(dir,'input.xlsx'),dir],{timeout:120000,maxBuffer:4*1024*1024});}catch(e){let message;try{message=JSON.parse(e.stdout).error;}catch{}throw Error(message||'表格解析失败或超时，请确认文件完整、无密码且为支持的报价单版式');}
   const data=JSON.parse(out.stdout);if(data.error)throw Error(data.error);for(const a of data.assets)imageType(await readFile(join(dir,a.file)));
   db.prepare("UPDATE supplier_batches SET data=?,state='ready',parse_error='' WHERE id=? AND state='parsing'").run(JSON.stringify(data),r.id);
  }catch(e){db.prepare("UPDATE supplier_batches SET state='parse_failed',parse_error=? WHERE id=? AND state='parsing'").run(String(e.message).slice(0,500),r.id);}
  finally{parsing--;await rm(join(dir,'input.xlsx'),{force:true});if(r.remote_source){try{const remote=JSON.parse(r.remote_source),c=getStorage();if(c&&storageDestination(c)===remote.destination){const response=await ossRequest(c,remote.key,'DELETE',{}, {},undefined,fetchImpl);await response.body?.cancel();db.prepare("UPDATE supplier_batches SET remote_source='' WHERE id=?").run(r.id);}}catch{console.error('supplier_private_cleanup_pending');}}}

 }
 async function tick(){
  if(parsing)return;
  db.prepare("UPDATE supplier_batches SET state='parse_failed',parse_error='解析进程中断，请删除此预览后重新上传' WHERE state='parsing' AND parse_started<?").run(Date.now()-300000);
  const r=db.prepare("SELECT * FROM supplier_batches WHERE state='queued' ORDER BY created LIMIT 1").get();if(!r)return;
  if(!db.prepare("UPDATE supplier_batches SET state='parsing',parse_started=? WHERE id=? AND state='queued'").run(Date.now(),r.id).changes)return;
  await parseBatch(r);
 }
 function batch(owner,id){const r=db.prepare('SELECT * FROM supplier_batches WHERE owner=? AND id=?').get(owner,id);if(!r)throw Error('货盘预览不存在或不属于当前空间');return r;}
 function view(r){const d=JSON.parse(r.data);return {id:r.id,supplier:r.supplier,filename:r.filename,state:active.has(r.id)?'processing':r.state,error:r.parse_error||'',products:d.products,assets:d.assets.map(a=>({id:a.id,url:'/api/supplier-imports/'+r.id+'/assets/'+a.id})),results:JSON.parse(r.results),plan:r.plan?JSON.parse(r.plan):null};}
 async function prune(){for(const r of db.prepare('SELECT id,state FROM supplier_batches WHERE created<?').all(Date.now()-86400000)){if(active.has(r.id)||r.state==='parsing')continue;await rm(join(directory,r.id),{recursive:true,force:true});db.prepare('DELETE FROM supplier_uploaded WHERE batch_id=?').run(r.id);db.prepare('DELETE FROM supplier_batches WHERE id=?').run(r.id);}}
 return {
  prune,tick,
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
  get(owner,id){return view(batch(owner,id));},
  async asset(owner,id,asset){const r=batch(owner,id),a=JSON.parse(r.data).assets.find(a=>a.id===asset);if(!a)throw Error('图片不存在');const bytes=await readFile(join(directory,id,a.file));return {bytes,...imageType(bytes)};},
  async remove(owner,id){batch(owner,id);if(active.has(id)||batch(owner,id).state==='parsing')throw Error('正在处理，不能删除');await rm(join(directory,id),{recursive:true,force:true});db.prepare('DELETE FROM supplier_uploaded WHERE batch_id=?').run(id);db.prepare('DELETE FROM supplier_batches WHERE id=?').run(id);return {ok:true};},
  start(owner,id,input){
   const r=batch(owner,id);if(!['ready','partial','done','processing'].includes(r.state))throw Error('请等待解析完成后再导入');if(active.has(id))return view(r);if(active.size>=2)throw Error('已有2个货盘正在导入，请稍后重试');const data=JSON.parse(r.data),c=getStorage();if(!c?.enabled||!allowedStorage(owner,c))throw Error('请先启用共享OSS，并将当前空间至少一个商城域名加入允许列表');
   if(!Array.isArray(input.items)||!input.items.length||input.items.length>100)throw Error('请选择1至100件商品');
   const keys=new Set();const items=input.items.map(item=>{
    const original=data.products.find(p=>p.key===item.key);if(!original||keys.has(item.key)||item.confirmed!==true)throw Error('请逐件确认商品及规格对应关系');keys.add(item.key);
    if(!String(item.title||'').trim()||!Array.isArray(item.skus)||!item.skus.length||item.skus.length>50)throw Error('标题或SKU无效');
    const specs=new Set(),codes=new Set();const skus=item.skus.map((s,i)=>{const cost=Number(s.cost),price=Number(s.price),stock=Number(s.stock),spec=String(s.spec||'').trim();if([s.cost,s.price,s.stock].some(x=>x===null||x===undefined||String(x).trim()==='')||!Number.isFinite(cost)||cost<0||!Number.isFinite(price)||price<=0||!Number.isSafeInteger(stock)||stock<0||!spec||specs.has(spec))throw Error('请填写每个SKU的成本、正售价、整数库存和不重复的规格');specs.add(spec);const raw=Object.hasOwn(s,'barcode')?String(s.barcode||'').trim():String(s.sku||original.barcodes[i]||'').trim();if(raw&&!/^[A-Za-z0-9._-]{1,100}$/.test(raw))throw Error('条码或SKU编码仅支持字母、数字、点、横线和下划线，最多100字');const sku=raw||'SUP-'+hash(r.supplier+'|'+original.key+'|'+i).slice(0,20);if(codes.has(sku))throw Error('同一商品的条码或SKU编码不能重复');codes.add(sku);return {sku,spec,cost,price,stock};});
    return {key:item.key,title:String(item.title).trim().slice(0,200),skus,confirmed:true,...(item.mall_mappings!==undefined?{mall_mappings:normalizeMallMappings(item.mall_mappings)}:{})};
   });
   const plan=JSON.stringify(items);if(r.plan&&r.plan!==plan)throw Error('此批次已开始导入，重试请保持原选择和内容；可重新上传文件建立新预览');if(r.destination&&r.destination!==storageDestination(c))throw Error('存储目标已变化，请恢复原存储配置再重试');
   const rate=r.billing_rate?JSON.parse(r.billing_rate):prepareCharge?.(owner,input.billing_revision,true);
   db.prepare("UPDATE supplier_batches SET plan=?,destination=?,state='processing',billing_rate=? WHERE id=?").run(plan,storageDestination(c),JSON.stringify(rate||null),id);active.add(id);
   setImmediate(async()=>{let results=JSON.parse(r.results);try{
    for(const item of items){if(results.some(x=>x.key===item.key&&x.ok))continue;const original=data.products.find(p=>p.key===item.key);let result;
     try{
      const current=getStorage();if(!current?.enabled||!allowedStorage(owner,current)||storageDestination(current)!==storageDestination(c))throw Error('存储配置或授权已变化');
      const source='supplier:'+hash(r.supplier.toLowerCase()+'|'+(original.barcodes.length?original.barcodes.join('|'):original.title));
      const existing=db.prepare('SELECT id FROM products WHERE owner=? AND source=?').get(owner,source);
      if(existing){result={key:item.key,ok:true,id:existing.id,duplicate:true};}
      else{
       const urls=[];for(const asset of original.images){let row=db.prepare('SELECT url FROM supplier_uploaded WHERE batch_id=? AND asset=?').get(id,asset);if(!row||row.url.length>128){const a=data.assets.find(a=>a.id===asset),bytes=await readFile(join(directory,id,a.file)),type=imageType(bytes),key=compactImageKey(owner,bytes,type.ext);const url=await (storeImage?storeImage(c,key,{bytes,...type},owner):uploadImage(c,key,{bytes,...type},{fetchImpl}));db.prepare('INSERT INTO supplier_uploaded VALUES(?,?,?) ON CONFLICT(batch_id,asset) DO UPDATE SET url=excluded.url').run(id,asset,url);row={url};}urls.push(row.url);}
       const latest=getStorage();if(!latest?.enabled||!allowedStorage(owner,latest)||storageDestination(latest)!==storageDestination(c))throw Error('存储配置或授权已变化，未创建商品');
       const metadata={supplier:r.supplier,batch_id:id,filename:r.filename,card:original.key,barcodes:original.barcodes,sku_codes:item.skus.map(s=>s.sku),packaging:original.packaging,category_hint:original.category_hint};
       const product=validateProduct({source_url:source,title:item.title,description:original.description,attributes:original.attributes,category:'',images:urls,detail_images:[],skus:item.skus,...(item.mall_mappings?{mall_mappings:item.mall_mappings,...(item.mall_mappings[0]||{})}:{})},{supplier:metadata});
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
