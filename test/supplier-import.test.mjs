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
function createFixture(path,withImage=false){execFileSync(python,['-c',`import zipfile,sys
z=zipfile.ZipFile(sys.argv[1],'w')
z.writestr('xl/workbook.xml','<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="测试" r:id="rId1"/></sheets></workbook>')
z.writestr('xl/_rels/workbook.xml.rels','<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>')
rows={3:{'C':'产品名称','D':'测试产品','I':'产品名称','J':'多规格产品'},4:{'C':'条码','D':'6977880050002','I':'条码','J':'6977880050040、6977880050033'},5:{'C':'产品成分','D':'棉'},6:{'C':'产品参数','D':'10cm'},7:{'C':'箱规','D':'10/箱'},8:{'C':'描述','D':'产品说明'},10:{'C':'零售价','D':'59元','E':'批发价','F':'29元','I':'零售价','J':'99元','K':'批发价','L':'39元'}}
data=''.join('<row r="%s">'%r+''.join('<c r="%s%s" t="inlineStr"><is><t>%s</t></is></c>'%(c,r,v) for c,v in cs.items())+'</row>' for r,cs in rows.items())
extra='<drawing xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="drawing"/>' if sys.argv[2]=='1' else ''
z.writestr('xl/worksheets/sheet1.xml','<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'+data+'</sheetData>'+extra+'</worksheet>')
if extra:
 import base64
 z.writestr('xl/worksheets/_rels/sheet1.xml.rels','<Relationships><Relationship Id="drawing" Target="../drawings/drawing1.xml"/></Relationships>')
 z.writestr('xl/drawings/drawing1.xml','<wsDr xmlns="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><twoCellAnchor><from><row>4</row><col>0</col></from><pic><a:blip r:embed="image"/></pic></twoCellAnchor></wsDr>')
 z.writestr('xl/drawings/_rels/drawing1.xml.rels','<Relationships><Relationship Id="image" Target="../media/image.png"/></Relationships>')
 z.writestr('xl/media/image.png',base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhWQAAAAASUVORK5CYII='))
z.close()`,path,withImage?'1':'0']);}
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
