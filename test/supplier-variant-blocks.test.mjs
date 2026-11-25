import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const scripts=fileURLToPath(new URL('../scripts/',import.meta.url));
const python=process.env.PYTHON_BIN||'python3';
const fixture=String.raw`
import sys,json,re
sys.path.insert(0,sys.argv[1])
from supplier_variant_blocks import variant_blocks
cells={(0,2):'产品名称',(0,5):'颜色/编号',(0,6):'零售价',(0,7):'批发价',(0,8):'代发价',(0,11):'产品描述',
(1,5):'Red-Violet',(2,3):'测试中文名',(3,2):'Example Name',(3,5):'6900000000001',(3,6):'99',(3,7):'29',(3,8):'39',(3,11):'原始描述',(4,5):'AB-001-rv',(6,2):'体验宣传语',
(8,5):'Black',(9,5):'AB-001-bk',(10,5):'6900000000002',(10,6):'109',(10,7):'35',(10,8):'45',
(15,2):'产品名称',(15,5):'容量',(15,6):'零售价',(15,7):'批发价',(15,11):'产品描述',
(16,5):'60ml',(17,2):'第二款',(18,2):'Second',(17,5):'6900000000003',(17,6):'68',(17,7):'26',(18,5):'AB-LU-003',(19,11):'第二描述'}
columns={'title':2,'barcode':5,'cost':7,'price':6,'description':11}
labels={'title':'产品名称','barcode':'颜色/编号','cost':'批发价','price':'零售价','description':'产品描述'}
headers=[(0,columns,labels),(15,{'title':2,'model':5,'cost':7,'price':6,'description':11},{**labels,'model':'容量'})]
mode=sys.argv[2]
if mode=='conflict':cells[5,7]='999'
if mode=='ambiguous':cells[5,5]='6900000000099'
if mode=='missing':del cells[3,7]
if mode=='different':cells[9,5]='AB-002-bk'
normalize=lambda s:re.sub(r'[\s（）()]','',s)
money=lambda s:float(s) if re.fullmatch(r'\d+(?:\.\d+)?',s) else None
if mode=='xlsx':
 import zipfile,html
 ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main';rel='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
 def col(c):
  name='';c+=1
  while c:c,k=divmod(c-1,26);name=chr(65+k)+name
  return name
 data=''.join('<row r="%d">'% (r+1)+''.join('<c r="%s%d" t="inlineStr"><is><t>%s</t></is></c>'%(col(c),r+1,html.escape(v))for (rr,c),v in cells.items()if rr==r)+'</row>'for r in sorted({r for r,c in cells}))
 with zipfile.ZipFile(sys.argv[3],'w')as z:
  z.writestr('xl/workbook.xml','<workbook xmlns="'+ns+'" xmlns:r="'+rel+'"><sheets><sheet name="货盘" r:id="s"/></sheets></workbook>')
  z.writestr('xl/_rels/workbook.xml.rels','<Relationships><Relationship Id="s" Target="worksheets/sheet1.xml"/></Relationships>')
  z.writestr('xl/worksheets/sheet1.xml','<worksheet xmlns="'+ns+'"><sheetData>'+data+'</sheetData></worksheet>')
 sys.exit(0)
try:
 result=variant_blocks(cells,[(0,0,'first'),(8,0,'second-colour'),(14,0,'next')],headers,'货盘',money,normalize,{(0,0):8,(8,0):15,(14,0):23})
 print(json.dumps(result,ensure_ascii=False))
except ValueError as error:print(json.dumps({'error':str(error)},ensure_ascii=False))
`;
function run(mode='normal'){return JSON.parse(execFileSync(python,['-c',fixture,scripts,mode],{encoding:'utf8'}));}
test('重复表头商品块组合缩进中英文名称，颜色/条码/型号任意顺序配对且价格不串行',()=>{
 const rows=run(),first=rows['0'],second=rows['15'];
 assert.equal(first.title,'测试中文名 / Example Name');assert.equal(first.variants.length,2);
 assert.deepEqual(first.variants.map(s=>[s.spec,s.barcode,s.model,s.cost,s.price]),[['Red-Violet','6900000000001','AB-001-rv',29,99],['Black','6900000000002','AB-001-bk',35,109]]);
 assert.deepEqual(first.source_refs.title,['D3','C4']);assert.match(first.description,/体验宣传语/);assert(!first.title.includes('宣传语'));
 assert.deepEqual(first.images,['first','second-colour']);assert.deepEqual(second.images,['next']);assert.equal(second.variants[0].spec,'60ml');assert.equal(second.variants[0].cost,26);
 assert.equal(first.needs_ai,false);assert(first.attributes.some(a=>a.value.includes('AB-001-rv')));
});
test('价格冲突或缺失留空，不以代发价替代成本，非唯一条码和跨系列型号拦截',()=>{
 assert.equal(run('conflict')['0'].variants[0].cost,null);assert.match(run('conflict')['0'].warnings.join(','),/冲突/);
 assert.equal(run('missing')['0'].variants[0].cost,null);
 assert.match(run('ambiguous').error,/唯一配对/);assert.match(run('different').error,/不同型号系列/);
});

test('真实XLSX入口按颜色与容量混合表头路由，不误拆为逐行商品',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ops-variant-blocks-'));
 try{
  const path=join(dir,'input.xlsx');execFileSync(python,['-c',fixture,scripts,'xlsx',path]);
  const parsed=JSON.parse(execFileSync(python,[join(scripts,'parse-supplier-xlsx.py'),path,dir],{encoding:'utf8'}));
  assert.equal(parsed.products.length,2);assert.equal(parsed.products[0].variants.length,2);assert.equal(parsed.products[1].variants.length,1);
  assert.equal(parsed.products[0].title,'测试中文名 / Example Name');assert.equal(parsed.products[1].variants[0].spec,'60ml');
 }finally{await rm(dir,{recursive:true,force:true});}
});
