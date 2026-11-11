import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {openStore,validateProduct} from '../core.mjs';
import {supplierImports} from '../supplier-import.mjs';
const root=dirname(dirname(fileURLToPath(import.meta.url))),python=process.env.PYTHON_BIN||'python3';
const config={enabled:true,bucket:'examplebucket',region:'cn-hangzhou',publicOrigin:'https://images.example.com',allowedOrigins:['https://mall.example.com'],accessKeyId:'exampleAccessKeyID',accessKeySecret:'exampleSecretForTestsOnly'};
// Synthetic fixture only: never commit supplier product data or artwork.
function createFixture(path,withImage=false,table=false){execFileSync(python,['-c',`import zipfile,sys
z=zipfile.ZipFile(sys.argv[1],'w')
z.writestr('xl/workbook.xml','<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="测试" r:id="rId1"/></sheets></workbook>')
z.writestr('xl/_rels/workbook.xml.rels','<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>')
rows={3:{'C':'产品名称','D':'测试产品','I':'产品名称','J':'多规格产品'},4:{'C':'条码','D':'6977880050002','I':'条码','J':'6977880050040、6977880050033'},5:{'C':'产品成分','D':'棉'},6:{'C':'产品参数','D':'10cm'},7:{'C':'箱规','D':'10/箱'},8:{'C':'描述','D':'产品说明'},10:{'C':'零售价','D':'59元','E':'批发价','F':'29元','I':'零售价','J':'99元','K':'批发价','L':'39元'}}
if sys.argv[3]=='1': rows={1:{'A':'货品叫法','B':'拿货金额'},2:{'A':'测试商品','B':'35'}}
if sys.argv[3]=='2':
 h={'B':'产品名称','C':'颜色/编号','D':'零售价（元）','E':'批发价（元）','I':'描述'}
 rows={11:h,13:{'B':'Example Alpha'},15:{'B':'样品甲','C':'100ml'},16:{'C':'6977880050002','D':'199','E':'89','I':'原商品描述'},20:{'G':'详细说明'*30},21:{'B':'甲补充说明'},
 23:h,25:{'B':'样品乙','C':'6977880050040'},26:{'B':'Example Beta','D':'239','E':'99'},30:{'C':'15ml'},31:{'I':'乙补充说明'}}

data=''.join('<row r="%s">'%r+''.join('<c r="%s%s" t="inlineStr"><is><t>%s</t></is></c>'%(c,r,v) for c,v in cs.items())+'</row>' for r,cs in rows.items())
extra='<drawing xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="drawing"/>' if sys.argv[2]=='1' else ''
z.writestr('xl/worksheets/sheet1.xml','<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'+data+'</sheetData>'+extra+'</worksheet>')
if extra:
 import base64
 z.writestr('xl/worksheets/_rels/sheet1.xml.rels','<Relationships><Relationship Id="drawing" Target="../drawings/drawing1.xml"/></Relationships>')
 anchors=[(12,'image'),(13,'second')] if sys.argv[3]=='2' else [(4,'image')]
 z.writestr('xl/drawings/drawing1.xml','<wsDr xmlns:d="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'+''.join('<twoCellAnchor><from><row>%s</row><col>0</col></from><pic><a:blip r:embed="%s"/></pic></twoCellAnchor>'%(r,key) for r,key in anchors)+'</wsDr>')
 z.writestr('xl/drawings/_rels/drawing1.xml.rels','<Relationships><Relationship Id="image" Target="../media/image.png"/><Relationship Id="second" Target="../media/second.png"/></Relationships>')
 png=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhWQAAAAASUVORK5CYII=')
 z.writestr('xl/media/image.png',png)
 if sys.argv[3]=='2':z.writestr('xl/media/second.png',png+b'x')
z.close()`,path,withImage?'1':'0',table==='mixed'?'2':table?'1':'0']);}
async function wait(service,owner,id){for(let i=0;i<100;i++){const v=service.get(owner,id);if(v.state!=='processing')return v;await delay(5);}throw Error('worker timeout');}
test('货盘卡片提取、预览隔离、库存必填、多SKU确认、导入幂等、无1688链接编辑支持',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ops-supplier-test-')),db=openStore(join(dir,'test.sqlite'));const path=join(dir,'test.xlsx');createFixture(path);const audits=[],collectors=[];
 const service=supplierImports({db,dataDir:dir,root,getStorage:()=>config,allowedStorage:()=>true,recordCollector:id=>collectors.push(id),audit:(...r)=>audits.push(r),python});
 try{
  const batch=await service.preview('alice',{supplier:'测试供应商',filename:'报价.xlsx',data:(await readFile(path)).toString('base64')});assert.equal(batch.products.length,2);assert.equal(batch.products[0].cost,29);assert.equal(batch.products[0].price,59);assert.equal(batch.products[1].barcodes.length,2);assert.equal(batch.products[0].packaging,'10/箱');assert.throws(()=>service.get('bob',batch.id),/不属于/);
  const item={key:batch.products[0].key,title:'测试产品',confirmed:true,skus:[{spec:'默认',cost:'29',price:'59',stock:''}]};assert.throws(()=>service.start('alice',batch.id,{items:[item]}),/库存/);assert.throws(()=>service.start('alice',batch.id,{items:[{...item,confirmed:false}]}),/确认/);
  item.skus[0].stock='5';service.start('alice',batch.id,{items:[item]});const result=await wait(service,'alice',batch.id);assert.equal(result.state,'done');assert.equal(result.results[0].ok,true);const row=db.prepare('SELECT * FROM products').get(),p=JSON.parse(row.data);assert.equal(p.supplier_import.supplier,'测试供应商');assert.equal(p.skus[0].sku,'6977880050002');assert.equal(p.status,undefined);assert.equal(row.status,'draft');assert.equal(p.category,'');assert.deepEqual(p.images,[]);assert.equal(collectors.length,1);assert.throws(()=>validateProduct(p),/1688/);const edited=validateProduct({...p,title:'编辑后'}, {supplier:p.supplier_import});assert.equal(edited.title,'编辑后');assert.equal(edited.supplier_import.filename,'报价.xlsx');
  service.start('alice',batch.id,{items:[item]});await wait(service,'alice',batch.id);assert.equal(db.prepare('SELECT COUNT(*) n FROM products').get().n,1);
  const batch2=await service.preview('alice',{supplier:'测试供应商',filename:'报价.xlsx',data:(await readFile(path)).toString('base64')});service.start('alice',batch2.id,{items:[{...item,key:batch2.products[0].key}]});const duplicate=await wait(service,'alice',batch2.id);assert.equal(duplicate.results[0].duplicate,true);assert.equal(db.prepare('SELECT COUNT(*) n FROM products').get().n,1);
  assert.throws(()=>service.start('alice',batch.id,{items:[{...item,title:'改动原计划'}]}),/保持原选择/);await service.remove('alice',batch.id);assert.throws(()=>service.get('alice',batch.id));assert.equal(db.prepare('SELECT COUNT(*) n FROM products').get().n,1);
 }finally{db.close();await rm(dir,{recursive:true,force:true});}
});
test('货盘图片上传失败不创建商品，恢复后沿用原计划重试，停用存储被拦截',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ops-supplier-images-')),db=openStore(join(dir,'test.sqlite'));let enabled=true,fail=true,puts=0;const objects=new Map();
 const fetchImpl=async(url,options={})=>{if(options.method==='PUT'){puts++;if(fail)return new Response('',{status:403});objects.set(new URL(url).pathname,options.body);return new Response('');}return new Response(objects.get(new URL(url).pathname));};
 const service=supplierImports({db,dataDir:dir,root,getStorage:()=>({...config,enabled}),allowedStorage:()=>true,recordCollector(){},audit(){},python,fetchImpl});
 try{assert.throws(()=>service.start('alice','bad',{items:[]}),/不存在/);const path=join(dir,'test.xlsx');createFixture(path,true);const b=await service.preview('alice',{supplier:'供应商',filename:'x.xlsx',data:(await readFile(path)).toString('base64')});assert.equal(b.products[0].images.length,1);assert.equal((await service.asset('alice',b.id,b.assets[0].id)).mime,'image/png');await assert.rejects(service.asset('bob',b.id,b.assets[0].id),/不属于/);
  const items=[{key:b.products[0].key,title:'测试产品',confirmed:true,skus:[{spec:'默认',cost:29,price:59,stock:5}]}];enabled=false;assert.throws(()=>service.start('alice',b.id,{items}),/OSS/);enabled=true;
  service.start('alice',b.id,{items});let result=await wait(service,'alice',b.id);assert.equal(result.state,'partial');assert.equal(result.results[0].ok,false);assert.equal(db.prepare('SELECT COUNT(*) n FROM products').get().n,0);assert.equal(puts,1);
  fail=false;service.start('alice',b.id,{items});result=await wait(service,'alice',b.id);assert.equal(result.state,'done');const product=JSON.parse(db.prepare('SELECT data FROM products').get().data);assert.ok(product.images[0].startsWith(config.publicOrigin+'/ops/'));assert.equal(puts,2);
 }finally{db.close();await rm(dir,{recursive:true,force:true});}
});
test('导入允许减少和新增SKU，条码跟随行保留，重复编码拦截且重试不改变生成编码',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ops-supplier-skus-')),db=openStore(join(dir,'test.sqlite')),path=join(dir,'test.xlsx');createFixture(path);const service=supplierImports({db,dataDir:dir,root,getStorage:()=>config,allowedStorage:()=>true,recordCollector(){},audit(){},python});
 try{
  const b=await service.preview('alice',{supplier:'调整SKU',filename:'报价.xlsx',data:(await readFile(path)).toString('base64')});
  const reduced={key:b.products[1].key,title:'多规格减少为单规格',confirmed:true,mall_mappings:[{catalog_connection_id:'mall-a',catalog_target:'crmeb-pro',category_id:11,category:'分类',brand_ids:[21],tag_ids:[]}],skus:[{barcode:'6977880050033',spec:'保留款',cost:2,price:5,stock:3}]};
  const added={key:b.products[0].key,title:'单规格增加为两规格',confirmed:true,skus:[{barcode:'6977880050002',spec:'原款',cost:2,price:5,stock:3},{barcode:'',spec:'新增款',cost:3,price:6,stock:4}]};
  assert.throws(()=>service.start('alice',b.id,{items:[{...added,skus:added.skus.map(s=>({...s,barcode:'SAME'}))}]}),/不能重复/);
  assert.throws(()=>service.start('alice',b.id,{items:[{...added,skus:[]}]}),/SKU无效/);
  service.start('alice',b.id,{items:[reduced,added]});let result=await wait(service,'alice',b.id);assert.equal(result.state,'done');const products=db.prepare('SELECT data FROM products').all().map(r=>JSON.parse(r.data)),one=products.find(p=>p.title===reduced.title),two=products.find(p=>p.title===added.title);assert.equal(one.mall_mappings[0].category_id,11);assert.deepEqual(one.brand_ids,[21]);assert.equal(one.skus.length,1);assert.equal(one.skus[0].sku,'6977880050033');assert.equal(one.supplier_import.barcodes.length,2);assert.equal(two.skus.length,2);assert.match(two.skus[1].sku,/^SUP-/);assert.notEqual(two.skus[0].sku,two.skus[1].sku);
  service.start('alice',b.id,{items:result.plan});result=await wait(service,'alice',b.id);assert.equal(result.state,'done');assert.equal(db.prepare('SELECT COUNT(*) n FROM products').get().n,2);
 }finally{db.close();await rm(dir,{recursive:true,force:true});}
});

test('后台货盘队列持久保存、跨实例解析、状态隔离及失败可见',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ops-supplier-queue-')),db=openStore(join(dir,'test.sqlite')),path=join(dir,'test.xlsx');createFixture(path);
 const options={db,dataDir:dir,root,getStorage:()=>config,allowedStorage:()=>true,recordCollector(){},audit(){},python};
 try{
  const api=supplierImports(options),b=await api.enqueue('alice',{supplier:'后台供应商',filename:'报价.xlsx',bytes:await readFile(path)});
  assert.equal(b.state,'queued');assert.deepEqual(b.products,[]);assert.throws(()=>api.get('bob',b.id),/不属于/);assert.throws(()=>api.start('alice',b.id,{items:[]}),/解析完成/);
  const worker=supplierImports(options);await worker.tick();const ready=api.get('alice',b.id);assert.equal(ready.state,'ready');assert.equal(ready.products.length,2);
  const broken=await api.enqueue('alice',{supplier:'损坏文件',filename:'坏.xlsx',bytes:Buffer.from('504b03040000','hex')});await worker.tick();assert.equal(api.get('alice',broken.id).state,'parse_failed');assert.ok(api.get('alice',broken.id).error);assert.equal(db.prepare('SELECT COUNT(*) n FROM products').get().n,0);
  const interrupted=await api.enqueue('alice',{supplier:'中断',filename:'旧.xlsx',bytes:await readFile(path)});db.prepare("UPDATE supplier_batches SET state='parsing',parse_started=1 WHERE id=?").run(interrupted.id);await worker.tick();assert.match(api.get('alice',interrupted.id).error,/中断/);
 }finally{db.close();await rm(dir,{recursive:true,force:true});}
});

test('私有OSS货盘按大小流式下载、解析后删除原件且不自动创建商品',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ops-supplier-private-')),db=openStore(join(dir,'test.sqlite')),path=join(dir,'test.xlsx');createFixture(path);const bytes=await readFile(path),calls=[];
 const fetchImpl=async(url,options)=>{calls.push(options.method);return options.method==='GET'?new Response(bytes):new Response(null,{status:204});};
 const service=supplierImports({db,dataDir:dir,root,getStorage:()=>config,allowedStorage:()=>true,recordCollector(){},audit(){},fetchImpl,python});
 const {storageDestination}=await import('../image-storage.mjs');
 try{
  const input={supplier:'私有货盘',filename:'报价.xlsx',key:'ops-private/workbooks/test/file.xlsx',size:bytes.length,destination:storageDestination(config)};
  const queued=await service.enqueueRemote('alice',input);assert.equal((await service.enqueueRemote('alice',input)).id,queued.id);await service.tick();assert.equal(service.get('alice',queued.id).state,'ready');assert.equal(service.get('alice',queued.id).products.length,2);assert.deepEqual(calls,['GET','DELETE']);assert.equal(db.prepare('SELECT COUNT(*) n FROM products').get().n,0);
  const bad=await service.enqueueRemote('alice',{...input,key:'ops-private/workbooks/test/bad.xlsx',size:bytes.length+1});await service.tick();assert.equal(service.get('alice',bad.id).state,'parse_failed');assert.match(service.get('alice',bad.id).error,/不完整/);
 }finally{db.close();await rm(dir,{recursive:true,force:true});}
});

test('陌生表头首次点选成功后，同账号同供应商可自动复用',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ops-supplier-layout-'));
 const db=openStore(join(dir,'test.sqlite')),path=join(dir,'table.xlsx');
 try{
  createFixture(path,false,true);
  const input={supplier:'测试供应商',filename:'报价.xlsx',bytes:await readFile(path)};
  const service=supplierImports({db,dataDir:dir,root,python,audit:()=>{}});
  const first=await service.enqueue('alice',input);
  await service.tick();
  assert.equal(service.get('alice',first.id).state,'parse_failed');
  const mapped=await service.remap('alice',first.id,{sheet:'测试',start_row:2,columns:{title:1,cost:2}});
  assert.equal(mapped.products[0].cost,35);
  const next=await service.enqueue('alice',input);
  await service.tick();
  assert.equal(service.get('alice',next.id).products[0].title,'测试商品');
  const other=await service.enqueue('bob',input);
  await service.tick();
  assert.equal(service.get('bob',other.id).state,'parse_failed');
 }finally{db.close();await rm(dir,{recursive:true,force:true});}
});

test('WorkBuddy 清单按商品块取原表值，拒绝串款并保留原图、价格和条码',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ops-supplier-workbuddy-')),db=openStore(join(dir,'test.sqlite')),path=join(dir,'test.xlsx');
 try{
  createFixture(path,true);
  const service=supplierImports({db,dataDir:dir,root,getStorage:()=>config,allowedStorage:()=>true,recordCollector(){},audit(){},storeImage:async()=>config.publicOrigin+'/test.png',python});
  const b=await service.preview('alice',{supplier:'供应商',filename:'报价.xlsx',data:(await readFile(path)).toString('base64')});
  const manifest=service.workbuddyTemplate('alice',b.id);
  assert.throws(()=>service.workbuddyTemplate('bob',b.id),/不属于/);
  const {format,batch_id,revision}=manifest,key=manifest.items[0].key;
  const payload=fields=>({format,batch_id,revision,items:[{key,fields,issues:['复核说明']}]});
  await assert.rejects(service.importWorkbuddy('alice',b.id,payload({title_zh:['J3']})),/超出/);
  await assert.rejects(service.importWorkbuddy('alice',b.id,payload({title_zh:['D9']})),/空白/);
  const result=await service.importWorkbuddy('alice',b.id,payload({title_zh:['D3'],spec:['D6'],attributes:['D5'],notes:['D7']}));
  const [p,other]=result.products;
  assert.equal(p.spec_hint,'10cm');assert.equal(p.title,'测试产品');assert.match(p.description,/10\/箱/);assert.deepEqual(p.review_refs.spec,['D6']);assert.match(p.warnings.join(' '),/复核说明/);
  for(const field of ['images','barcodes','cost','price'])assert.deepEqual(p[field],b.products[0][field]);
  assert.deepEqual(other,b.products[1]);assert.equal(db.prepare('SELECT COUNT(*) n FROM products').get().n,0);
  service.start('alice',b.id,{items:[{key,confirmed:true,title:p.title,skus:[{spec:p.spec_hint,cost:p.cost,price:p.price,stock:2}]}]});
  assert.equal((await wait(service,'alice',b.id)).state,'done');
  const saved=JSON.parse(db.prepare('SELECT data FROM products').get().data);
  assert.match(saved.description,/10\/箱/);assert.deepEqual(saved.attributes.find(a=>a.name==='产品属性'),{name:'产品属性',value:'棉'});
 }finally{db.close();await rm(dir,{recursive:true,force:true});}
});

test('WorkBuddy 同表商品采用不同字段行：按各自坐标补全双语标题、规格及说明',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ops-supplier-mixed-')),db=openStore(join(dir,'test.sqlite')),path=join(dir,'mixed.xlsx');
 try{
  createFixture(path,false,'mixed');
  const service=supplierImports({db,dataDir:dir,root,audit(){},python});
  const queued=await service.enqueue('alice',{supplier:'测试供应商',filename:'mixed.xlsx',bytes:await readFile(path)});
  await service.tick();
  const b=service.get('alice',queued.id),manifest=service.workbuddyTemplate('alice',b.id);
  assert.equal(b.products.length,2);
  const [a,c]=manifest.items;
  assert.deepEqual(a.bounds.slice(0,2),[12,22]);assert.deepEqual(c.bounds.slice(0,2),[24,31]);
  const apply=items=>service.importWorkbuddy('alice',b.id,{format:manifest.format,batch_id:b.id,revision:manifest.revision,items});
  await assert.rejects(apply([{key:a.key,fields:{spec:['C30']}}]),/超出/);
  const result=await apply([
   {key:a.key,fields:{title_en:['B13','B13'],title_zh:'b15',spec:'$C$15',notes:['B21'],unknown:['D16']}},
   {key:c.key,fields:{title_zh:['B25'],title_en:['B26'],spec:['C30'],notes:['I31'],attributes:['A24','A25','A26','A27','A28']}},
  ]);
  assert.deepEqual(result.products.map(p=>[p.title,p.spec_hint,p.cost,p.price]),[
   ['Example Alpha / 样品甲','100ml',89,199],['Example Beta / 样品乙','15ml',99,239],
  ]);
  assert.match(result.products[0].warnings.join(' '),/不支持字段「unknown」/);
  assert.match(result.products[1].warnings.join(' '),/attributes 需填写不超过 4 个/);
  assert.equal(result.products[0].description,'原商品描述\n\n甲补充说明');
  assert.equal(result.products[1].description,'乙补充说明');
  assert.deepEqual(service.get('alice',b.id).products,result.products);
  const fallback=await apply([
   {key:a.key,fields:{title_zh:['B15'],spec:['G20']}},
   {key:c.key,fields:{spec:['C30']}},
  ]);
  assert.equal(fallback.products[0].title,'样品甲');
  assert.equal(fallback.products[0].spec_hint,b.products[0].spec_hint);
  assert.match(fallback.products[0].warnings.join(' '),/规格超过 100 字（G20）/);
  assert.equal(fallback.products[1].spec_hint,'15ml');
 }finally{db.close();await rm(dir,{recursive:true,force:true});}
});

test('上传仅本地解析，手动重试才调用 NewAPI，采用原文及已提取图片，拒绝串款并在模型失败时回退',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ops-supplier-newapi-')),db=openStore(join(dir,'test.sqlite')),path=join(dir,'mixed.xlsx');
 try{
  createFixture(path,true,'mixed');
  let offline=false,calls=0;
  const service=supplierImports({db,dataDir:dir,root,audit(){},python,aiConfig:{endpoint:new URL('https://example.com/v1/chat/completions'),key:'test-key',model:'test-model'},fetchImpl:async(url,options)=>{
   calls++;
   assert.equal(new URL(url).pathname,'/v1/chat/completions');
   const req=JSON.parse(options.body),[first,second]=JSON.parse(req.messages[1].content);
   assert.equal(req.model,'test-model');assert.equal(first.cells.B15,'样品甲');assert.equal(second.cells.B15,undefined);assert.deepEqual(first.image_anchors,['A13','A14']);
   if(offline)return new Response('',{status:503});
   return Response.json({choices:[{message:{content:JSON.stringify({items:[
    {id:first.id,fields:{title_lines:['B21','B15','B13'],spec:['C15'],notes:['B21']},image:'A14'},
    {id:second.id,fields:{title_zh:['B15'],spec:['C30']},image:'Z99'},
   ]})}}]});
  }});
  const input={supplier:'测试供应商',filename:'mixed.xlsx',bytes:await readFile(path)};
  const queued=await service.enqueue('alice',input);await service.tick();
  assert.equal(calls,0);
  assert.throws(()=>service.retryAI('bob',queued.id),/不属于/);
  service.retryAI('alice',queued.id);await service.tick();
  const result=service.get('alice',queued.id);
  assert.equal(calls,1);
  assert.deepEqual(result.ai,{recognized:2,unresolved:0,local:0});
  assert.equal(result.products[0].title,'Example Alpha / 样品甲 / 甲补充说明');
  assert.equal(result.products[0].spec_hint,'100ml');
  assert.equal(result.products[0].cost,89);
  assert.equal(result.products[0].images[0],result.products[0].image_anchors.A14);
  assert.equal(result.products[0].images.length,2);
  assert.match(result.products[0].description,/甲补充说明/);
  assert.equal(result.products[1].title,'样品乙');
  assert.match(result.products[1].warnings.join(' '),/主图坐标未匹配/);
  offline=true;
  const retry=await service.enqueue('alice',input);await service.tick();
  assert.equal(calls,1);
  service.retryAI('alice',retry.id);await service.tick();
  const fallback=service.get('alice',retry.id);
  assert.equal(calls,2);assert.equal(fallback.state,'ready');
  assert.deepEqual(fallback.ai,{recognized:0,unresolved:2,local:0});
  assert.equal(fallback.products[0].title,'Example Alpha');
 }finally{db.close();await rm(dir,{recursive:true,force:true});}
});

test('可本地解析的货盘不调用模型，未知单表才请求一次列映射',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ops-ai-fallback-')),db=openStore(join(dir,'test.sqlite')),path=join(dir,'catalog.xlsx');
 try{
  let calls=0;const logs=[];
  const service=supplierImports({db,dataDir:dir,root,audit(){},python,logAI:entry=>logs.push(entry),aiConfig:{endpoint:new URL('https://example.com/v1/chat/completions'),key:'test-key',model:'test-model'},fetchImpl:async(_,options)=>{
   calls++;
   const request=JSON.parse(options.body);
   assert.deepEqual(JSON.parse(request.messages[1].content),{'1':{'1':'货品叫法','2':'拿货金额'}});
   return Response.json({choices:[{message:{content:JSON.stringify({header:1,columns:{title:1,cost:2}})}}]});
  }});
  const upload=async()=>{const b=await service.enqueue('alice',{supplier:'测试供应商',filename:'catalog.xlsx',bytes:await readFile(path)});await service.tick();return service.get('alice',b.id);};
  createFixture(path);const local=await upload();
  assert.equal(local.state,'ready');assert.equal(local.ai,null);assert.equal(calls,0);
  createFixture(path,false,true);const failed=await upload();
  assert.equal(failed.state,'parse_failed');assert.equal(calls,0);
  service.retryAI('alice',failed.id);await service.tick();const fallback=service.get('alice',failed.id);
  assert.equal(calls,1);assert.equal(fallback.state,'ready');assert.deepEqual(fallback.ai,{layout:true});
  assert.equal(fallback.products[0].title,'测试商品');assert.equal(fallback.products[0].cost,35);
  assert.match(fallback.products[0].warnings.join(' '),/AI 建议列/);
  assert.deepEqual(logs.map(l=>[l.reason,l.requests,l.outcome]),[['local_parse_sufficient',0,'ready'],['local_parse_failed',0,'parse_failed'],['layout_fallback',1,'ready']]);
  assert.deepEqual(logs[2].http_statuses,{200:1});
  assert.doesNotMatch(JSON.stringify(logs),/test-key|测试商品|货品叫法/);
 }finally{db.close();await rm(dir,{recursive:true,force:true});}
});
