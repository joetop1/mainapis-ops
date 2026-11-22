import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {openStore} from '../core.mjs';
import {supplierImports} from '../supplier-import.mjs';
const python=process.env.PYTHON_BIN||'python3';
function fixture(path,mode='normal'){
 execFileSync(python,['-c',`import zipfile,html,sys,base64
z=zipfile.ZipFile(sys.argv[1],'w');ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main';rel='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
header={'C':'产品名称','F':'容量','G':'零售价（元）','H':'批发价（元）','I':'代发价（元）','L':'产品描述','M':'规格'}
rows={1:header,2:{'F':'50ml','L':'第一款原始描述','M':'第一款材质参数'},3:{'C':'测试牌水基润滑液','F':'6900000000001','G':'69','H':'28','I':'35'},4:{'C':'AQUA','G':'（限价）'},5:{'F':'100ml'},6:{'F':'6900000000002','G':'·'},7:{'C':'高性价比款','G':'109','H':'48','I':'55'},10:header,11:{'F':'30ml','L':'第二块原始描述'},12:{'C':'测试牌男性护理喷雾','F':'6900000000003','G':'199','H':'78'},13:{'C':'Male Spray'},14:{'F':'30ml'},15:{'C':'测试牌女性护理喷雾','F':'6900000000004','G':'209','H':'88'}}
if sys.argv[2]=='ambiguous':rows[8]={'F':'6900000000099'}
if sys.argv[2]=='conflict':rows[8]={'H':'999'}
if sys.argv[2]=='labelled':rows[17]={'A':'（男用）','B':'（女用）'}
if sys.argv[2]=='rows':rows={1:header,2:{'C':'标准行商品甲','F':'50ml','G':'69','H':'28'},10:header,11:{'C':'标准行商品乙','F':'100ml','G':'109','H':'48'}}
def cell(c,r,v):return '<c r="%s%s" t="inlineStr"><is><t>%s</t></is></c>'%(c,r,html.escape(v))
data=''.join('<row r="%s">'%r+''.join(cell(c,r,v)for c,v in cs.items())+'</row>'for r,cs in sorted(rows.items()))
z.writestr('xl/workbook.xml','<workbook xmlns="'+ns+'" xmlns:r="'+rel+'"><sheets><sheet name="货盘" r:id="s"/></sheets></workbook>')
z.writestr('xl/_rels/workbook.xml.rels','<Relationships><Relationship Id="s" Target="worksheets/sheet1.xml"/></Relationships>')
z.writestr('xl/worksheets/sheet1.xml','<worksheet xmlns="'+ns+'" xmlns:r="'+rel+'"><sheetData>'+data+'</sheetData><mergeCells><mergeCell ref="L2:L9"/><mergeCell ref="L11:L17"/></mergeCells><drawing r:id="d"/></worksheet>')
z.writestr('xl/worksheets/_rels/sheet1.xml.rels','<Relationships><Relationship Id="d" Target="../drawings/drawing1.xml"/></Relationships>')
anchors=''.join('<twoCellAnchor><from><row>%s</row><col>%s</col></from><pic><a:blip r:embed="i%s"/></pic></twoCellAnchor>'%(r,c,i)for r,c,i in ([(1,0,1),(10,0,2),(10,1,1)] if sys.argv[2]=='labelled' else [(1,0,1),(10,0,2)]))
z.writestr('xl/drawings/drawing1.xml','<wsDr xmlns="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="'+rel+'">'+anchors+'</wsDr>')
z.writestr('xl/drawings/_rels/drawing1.xml.rels','<Relationships><Relationship Id="i1" Target="../media/a.png"/><Relationship Id="i2" Target="../media/b.png"/></Relationships>')
png=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhWQAAAAASUVORK5CYII=');z.writestr('xl/media/a.png',png);z.writestr('xl/media/b.png',png+b'x');z.close()
`,path,mode]);
}
test('容量/条码上下排列按商品块识别，多规格各自保留价格、来源和块内图片',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ops-capacity-'));
 try{
  const path=join(dir,'input.xlsx');fixture(path);
  const {products}=JSON.parse(execFileSync(python,['scripts/parse-supplier-xlsx.py',path,dir],{encoding:'utf8'}));
  assert.equal(products.length,3);
  const [a,b,c]=products;
  assert.equal(a.title,'测试牌水基润滑液');
  assert.deepEqual(a.variants.map(v=>[v.spec,v.barcode,v.cost,v.price]),[['50ml','6900000000001',28,69],['100ml','6900000000002',48,109]]);
  assert.equal(a.cost,null);assert.equal(a.price,null);
  assert.deepEqual(a.variants[1].source_refs.price,['G7']);
  assert.deepEqual(a.variants[1].source_refs.barcode,['F6']);
  assert.match(a.description,/第一款原始描述/);assert.match(a.description,/AQUA/);
  assert.equal(a.attributes.find(x=>x.name==='产品参数').value,'第一款材质参数');
  assert.equal(a.images.length,1);assert.equal(b.images.length,1);assert.notEqual(a.images[0],b.images[0]);
  assert.equal(b.title,'测试牌男性护理喷雾');assert.equal(c.title,'测试牌女性护理喷雾');
  assert.deepEqual(b.barcodes,['6900000000003']);assert.deepEqual(c.barcodes,['6900000000004']);
  assert.match(c.warnings.join('；'),/候选图片/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('无法唯一配对的条码拦截，冲突价格留空且不借用相邻规格价格',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ops-capacity-invalid-'));
 try{
  const path=join(dir,'input.xlsx');fixture(path,'ambiguous');
  assert.throws(()=>execFileSync(python,['scripts/parse-supplier-xlsx.py',path,dir],{encoding:'utf8'}),e=>/条码不是唯一值/.test(e.stdout));
  fixture(path,'conflict');
  const {products}=JSON.parse(execFileSync(python,['scripts/parse-supplier-xlsx.py',path,dir],{encoding:'utf8'}));
  assert.equal(products[0].variants[0].cost,28);assert.equal(products[0].variants[1].cost,null);
  assert.match(products[0].warnings.join('；'),/100ml的成本缺失或有多个值/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('同块男用女用图片仅在原表有明确列标注时分别归属',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ops-capacity-images-'));
 try{
  const path=join(dir,'input.xlsx');fixture(path,'labelled');
  const {products}=JSON.parse(execFileSync(python,['scripts/parse-supplier-xlsx.py',path,dir],{encoding:'utf8'}));
  const [,male,female]=products;
  assert.equal(male.images.length,1);assert.equal(female.images.length,1);
  assert.notEqual(male.images[0],female.images[0]);
  assert.equal(male.warnings.length,0);assert.equal(female.warnings.length,0);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('只有容量没有条码上下配对证据的普通行式表格继续按行读取',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ops-capacity-rows-'));
 try{
  const path=join(dir,'input.xlsx');fixture(path,'rows');
  const {products}=JSON.parse(execFileSync(python,['scripts/parse-supplier-xlsx.py',path,dir],{encoding:'utf8'}));
  assert.deepEqual(products.map(p=>[p.title,p.spec_hint,p.cost,p.price]),[['标准行商品甲','50ml',28,69],['标准行商品乙','100ml',48,109]]);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('容量货盘预览通过服务保留各SKU价格，确认入库仍要求人工补库存',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ops-capacity-service-')),db=openStore(join(dir,'test.sqlite'));
 try{
  const path=join(dir,'input.xlsx');fixture(path);
  const service=supplierImports({db,dataDir:dir,root:process.cwd(),getStorage:()=>({enabled:true}),allowedStorage:()=>true,recordCollector(){},audit(){},python,logAI(){}});
  const batch=await service.preview('alice',{supplier:'合成供应商',filename:'test.xlsx',data:(await readFile(path)).toString('base64')});
  assert.equal(batch.products.length,3);
  const product=batch.products[0];
  assert.deepEqual(product.variants.map(v=>[v.cost,v.price]),[[28,69],[48,109]]);
  assert.throws(()=>service.start('alice',batch.id,{items:[{key:product.key,title:product.title,confirmed:true,skus:product.variants}]}),/库存/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM products').get().n,0);
 }finally{db.close();await rm(dir,{recursive:true,force:true});}
});
