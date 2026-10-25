import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {validateProduct} from '../core.mjs';
import {buildOfficialProduct,verifyOfficialProduct} from '../crmeb-official.mjs';
import {buildStoreProduct,verifyStoreProduct} from '../crmeb-store.mjs';
import {buildTigshopProduct,verifyTigshopProduct} from '../tigshop.mjs';
import {specificationMatrix,remapSpecificationValues,matchSpecificationImport} from '../public/specifications.js';
import {collect1688} from '../extensions/1688-collector/collector.js';
const base={source_url:'https://detail.1688.com/offer/123456.html',title:'多维度商品',category:'分类',category_id:1,catalog_target:'crmeb-store',images:['https://example.com/main.jpg'],spec_names:['颜色','尺码'],skus:[{sku:'A',spec_values:['红','M'],image:'https://example.com/red.jpg',price:20,cost:10,stock:5},{sku:'B',spec_values:['红','L'],image:'https://example.com/red.jpg',price:25,cost:11,stock:6},{sku:'C',spec_values:['蓝','M'],image:'https://example.com/blue.jpg',price:30,cost:12,stock:7}]};
const config={shippingTemplateId:1},marker='OPS-'+'a'.repeat(32);
const collect=root=>JSON.parse(JSON.stringify(vm.runInNewContext('('+collect1688.toString()+')()', {window:{__INIT_DATA__:root},document:{title:'测试商品',querySelector:()=>null,querySelectorAll:()=>[]},location:{protocol:'https:',hostname:'detail.1688.com',pathname:'/offer/123456.html',href:base.source_url},URL})));

test('规格维度贯通采集和保存，不将颜色尺码拼成一个属性',()=>{
 const root={skuModel:{skuProps:[{pid:7,prop:'颜色',value:[{vid:1,name:'红',imageUrl:'https://cbu01.alicdn.com/red.jpg'},{vid:2,name:'蓝',imageUrl:'https://cbu01.alicdn.com/blue.jpg'}]},{pid:8,prop:'尺码',value:[{vid:1,name:'M'},{vid:2,name:'L'}]}],skuInfoMap:{'8:1;7:1':{skuId:'1',price:10},'8:2;7:1':{skuId:'2',price:11},'8:1;7:2':{skuId:'3',price:12}}}};
 const out=collect(root).product;assert.deepEqual(out.spec_names,['颜色','尺码']);assert.deepEqual(out.skus.map(s=>s.spec_values),[['红','M'],['红','L'],['蓝','M']]);
 const saved=validateProduct(out);assert.deepEqual(saved.spec_names,out.spec_names);assert.deepEqual(saved.skus.map(s=>s.spec_values),out.skus.map(s=>s.spec_values));assert.equal(saved.skus[0].cost,10);assert.equal(saved.skus[0].price,0);assert.equal(saved.skus[0].stock,0);assert.equal(saved.skus[0].image,'https://cbu01.alicdn.com/red.jpg');
 const noNames=collect({skuInfoMap:{'红>M':{skuId:'1',price:10},'蓝>L':{skuId:'2',price:12}}});assert.deepEqual(noNames.product.spec_names,['规格1','规格2']);assert.ok(noNames.warnings.some(s=>s.includes('维度名称')));
 const named=collect({skuMap:[{skuId:'1',specAttrs:[{propName:'颜色',valueName:'红'},{propName:'尺码',valueName:'M'}]},{skuId:'2',specAttrs:[{propName:'尺码',valueName:'L'},{propName:'颜色',valueName:'蓝'}]}]});assert.deepEqual(named.product.spec_names,['颜色','尺码']);assert.deepEqual(named.product.skus[1].spec_values,['蓝','L']);
});
test('两个CRMEB生成独立属性组和实际SKU组合，按维度核验且不补造缺货组合',()=>{
 for(const [target,build,verify] of [['crmeb-pro',buildOfficialProduct,verifyOfficialProduct],['crmeb-store',buildStoreProduct,verifyStoreProduct]]){
  const lease={marker,candidate_id:'42',product:validateProduct({...base,catalog_target:target})},payload=build(lease,config);
  assert.deepEqual(payload.items.map(x=>x.value),['颜色','尺码']);assert.deepEqual(payload.items[0].detail.map(x=>x.value),['红','蓝']);assert.deepEqual(payload.items[1].detail.map(x=>x.value),['M','L']);
  assert.equal(payload.attrs.length,3);assert.deepEqual(payload.attrs[1].attr_arr,['红','L']);assert.deepEqual(payload.attrs[1].detail,{'颜色':'红','尺码':'L'});assert.equal(payload.attrs[1].stock,6);assert.equal(payload.attrs[2].pic,base.skus[2].image);
  const response={status:200,data:{productInfo:{...payload,id:42}}};assert.equal(verify(response,lease,config).status,'succeeded');response.data.productInfo.attrs[1].detail['尺码']='M';assert.equal(verify(response,lease,config).status,'awaiting_review');
 }
});
test('Tigshop保留多组属性和逐SKU组合并核验，不覆盖独立售价与库存',()=>{
 const lease={marker,candidate_id:'42',product:validateProduct({...base,catalog_target:'tigshop'})},fx={sourceCurrency:'CNY',targetCurrency:'EUR',eurPerCny:0.125},shipping={templateId:51};
 const payload=buildTigshopProduct(lease,fx,shipping);assert.deepEqual(payload.attrList.spe.map(g=>g.attrName),['颜色','尺码']);assert.equal(payload.productList.length,3);assert.deepEqual(payload.productList[1].attrs,[{attrName:'颜色',attrValue:'红'},{attrName:'尺码',attrValue:'L'}]);assert.equal(payload.productList[1].skuPrice,'3.13');assert.equal(payload.productList[1].skuStock,6);
 const response={code:0,data:{...payload,productId:42,productList:payload.productList.map(s=>({...s,skuData:s.attrs.map(a=>({name:a.attrName,value:a.attrValue}))}))}};
 assert.equal(verifyTigshopProduct(response,lease,fx,shipping).status,'succeeded');response.data.productList[1].skuData[1].value='M';assert.equal(verifyTigshopProduct(response,lease,fx,shipping).status,'awaiting_review');
 const bad=structuredClone(lease);bad.product.skus[1].image='https://example.com/different.jpg';assert.throws(()=>buildTigshopProduct(bad,fx,shipping),/首级规格/);
});
test('旧规格不猜拆；新维度不完整、重复或危险属性必须拒绝',()=>{
 const old={...base};delete old.spec_names;old.skus=[{...base.skus[0],spec:'红 / M'}];delete old.skus[0].spec_values;
 assert.equal(specificationMatrix(old).structured,false);assert.equal(buildStoreProduct({marker,product:old},config).items.length,1);
 for(const mutate of [p=>p.spec_names=['颜色','颜色'],p=>p.skus[0].spec_values=['红'],p=>p.skus[0].spec_values=['','M'],p=>p.skus[1].spec_values=['红','M'],p=>p.spec_names=['__proto__','尺码'],p=>delete p.spec_names]){const p=structuredClone(base);mutate(p);assert.throws(()=>validateProduct(p));}
});
test('旧商品按来源和SKU编码导入新维度，不修改价格、成本、库存或配图',()=>{
 const current=base.skus.map(s=>({...s,price:99,stock:100,image:'https://example.com/own.jpg'}));const incoming={...base,skus:[...base.skus].reverse()};
 const result=matchSpecificationImport(base.source_url,current,incoming);assert.deepEqual(result.names,base.spec_names);assert.deepEqual(result.skus[0].spec_values,['红','M']);assert.equal(result.skus[0].price,99);assert.equal(result.skus[0].stock,100);assert.equal(result.skus[0].image,'https://example.com/own.jpg');
 assert.throws(()=>matchSpecificationImport('https://detail.1688.com/offer/9.html',current,incoming));assert.throws(()=>matchSpecificationImport(base.source_url,current,{...incoming,skus:incoming.skus.slice(1)}));
 const remapped=remapSpecificationValues(base.skus,base.spec_names,['尺码','颜色']);assert.deepEqual(remapped[0].spec_values,['M','红']);assert.equal(remapped[0].price,20);assert.deepEqual(base.skus[0].spec_values,['红','M']);
 assert.deepEqual(remapSpecificationValues(base.skus,base.spec_names,['颜色','包装'])[0].spec_values,['红','']);
});
test('两个完整准备节点在无URL全局的n8n沙箱中也保留多维规格',()=>{
 for(const target of ['member','store']){
  const code=readFileSync(new URL(`../workflows/crmeb-${target}-prepare-template1.js`,import.meta.url),'utf8'),lease={marker,action:'publish_draft',product:validateProduct({...base,catalog_target:target==='member'?'crmeb-pro':'crmeb-store'})};
  const result=vm.runInNewContext(`(function(){${code}})()`,{$:()=>({first:()=>({json:lease})}),$json:{status:200,data:{access_token:'token',token:'token'}}});assert.deepEqual(JSON.parse(JSON.stringify(result[0].json.payload.attrs[0].attr_arr)),['红','M']);
  const verifyCode=readFileSync(new URL(`../workflows/crmeb-${target}-verify.js`,import.meta.url),'utf8');const checkedLease={...lease,candidate_id:'42'},prepared=result[0].json;
  const receipt=vm.runInNewContext(`(function(){${verifyCode}})()`,{$:name=>({first:()=>({json:name==='读取可信任务快照'?checkedLease:{config:prepared.config}})}),$json:{status:200,data:{productInfo:{...prepared.payload,id:42}}}});assert.equal(receipt[0].json.status,'succeeded');
 }
});

test('三维规格保持各列顺序，名称与值不能靠显示文本猜测',()=>{
 const p=validateProduct({...base,spec_names:['颜色','尺码','包装'],skus:base.skus.map((s,i)=>({...s,spec_values:[...s.spec_values,i===1?'双件装':'单件装']}))});
 const payload=buildStoreProduct({marker,product:p},config);assert.deepEqual(payload.items.map(g=>g.value),['颜色','尺码','包装']);assert.deepEqual(payload.attrs[1].attr_arr,['红','L','双件装']);assert.equal(payload.attrs.length,3);
 const legacy={...base};delete legacy.spec_names;legacy.skus=[{sku:'X',spec:'红 / M / 单件装',price:20,cost:10,stock:2}];assert.equal(buildStoreProduct({marker,product:legacy},config).items.length,1);
});
