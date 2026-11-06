import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {buildSameStyleProduct} from '../same-style.mjs';
import {collectTaobao} from '../extensions/1688-collector/taobao.js';
import {canonicalSourceURL} from '../public/source-url.js';
import {validateProduct,assertPublishable} from '../core.mjs';
import {detailImagesFromJSON} from '../public/detail-images.js';
import {matchSkuImages} from '../public/sku-images.js';
import {productAttributesFromJSON} from '../public/product-attributes.js';
import {matchSpecificationImport} from '../public/specifications.js';
const url='https://item.taobao.com/item.htm?id=123';
function fixture(){return {item:{itemId:'123',title:'测试商品',images:['//img.alicdn.com/main.jpg','https://evil.test/recommend.png']},skuBase:{props:[{pid:'1',name:'容量',values:[{vid:'10',name:'50ml',image:'//img.alicdn.com/50.jpg'},{vid:'20',name:'100ml'}]}],skus:[{skuId:'51',propPath:'1:10'},{skuId:'52',propPath:'1:20'}]},skuCore:{sku2info:{51:{price:{priceText:'12.50'},quantity:500},52:{price:{priceText:'20-30'},quantity:900}}},props:{groupProps:[{基本信息:[{品牌:'测试品牌'},{下游平台:'不导入'}]}]},token:'DO-NOT-EXPORT',recommend:{item:{title:'错误商品',images:['https://img.alicdn.com/wrong.jpg']}}};}
function capture(data,diagnostic=false,href=url,doc={}){return JSON.parse(JSON.stringify(vm.runInNewContext('('+collectTaobao.toString()+')('+diagnostic+')',{URL,location:{href},window:{__ICE_APP_CONTEXT__:data},document:{querySelector:()=>null,querySelectorAll:()=>[],...doc}})));}
test('淘宝来源只接收明确商品ID，移除跟踪参数并拒绝伪域名及歧义ID',()=>{
 assert.equal(canonicalSourceURL(url+'&spm=tracking#x'),url);
 for(const u of [url.replace('https:','http:'),url.replace('item.taobao.com','item.taobao.com.evil.test'),url+'&id=999','https://item.taobao.com/item.htm','https://user:secret@item.taobao.com/item.htm?id=123','https://item.taobao.com/item.htm?id=not-number','https://taobao.com/'])assert.throws(()=>canonicalSourceURL(u));
 assert.equal(readFileSync(new URL('../public/source-url.js',import.meta.url),'utf8'),readFileSync(new URL('../extensions/1688-collector/source-url.js',import.meta.url),'utf8'));
});
test('淘宝现代SKU结构读取规格和图片，绝不沿用零售价及库存，也不导出账号字段',()=>{
 const result=capture({appData:{loaderData:{home:{data:fixture()}}}}),p=result.product;
 assert.equal(p.source_url,url);assert.equal(p.title,'测试商品');assert.deepEqual(p.images,['https://img.alicdn.com/main.jpg']);assert.deepEqual(p.spec_names,['容量']);assert.equal(p.skus.length,2);assert.equal(p.skus[0].cost,12.5);assert.equal(p.skus[1].cost,0);assert.equal(p.skus[0].image,'https://img.alicdn.com/50.jpg');assert.ok(p.skus.every(s=>s.price===0&&s.stock===0));assert.deepEqual(p.attributes,[{name:'品牌',value:'测试品牌'}]);assert.equal(JSON.stringify(result).includes('DO-NOT-EXPORT'),false);assert.equal(JSON.stringify(result).includes('wrong.jpg'),false);assert.throws(()=>assertPublishable(validateProduct(p)));
 const diagnostics=capture(fixture(),true);assert.ok(diagnostics.diagnostics.schemas.length);assert.equal(JSON.stringify(diagnostics).includes('DO-NOT-EXPORT'),false);assert.equal(JSON.stringify(diagnostics).includes('测试商品'),false);
});
test('详情只读取真实详情容器，支持apiStack的JSON数据；不完整规格不降级伪造',()=>{
 const img={getAttribute:name=>name==='data-src'?'//img.alicdn.com/detail.jpg':null};
 const p=capture({apiStack:[{value:JSON.stringify(fixture())}]},false,url,{querySelectorAll:s=>s.startsWith('#description')?[{querySelectorAll:()=>[img]}]:[]}).product;
 assert.deepEqual(p.detail_images,['https://img.alicdn.com/detail.jpg']);assert.equal(p.skus.length,2);
 const bad=fixture();bad.skuBase.skus[1].propPath='1:missing';const result=capture(bad);assert.equal(result.product.skus.length,0);assert.ok(result.warnings.some(w=>w.includes('未识别到完整')));assert.ok(capture({},false,'https://evil.test/item.htm?id=123').error);
 const other=fixture();other.item.itemId='999';assert.equal(capture(other).product.skus.length,0);
});
test('淘宝采集可导入并继续使用补图、参数补充、规格补充及同款整理来源',()=>{
 const p=capture(fixture()).product;p.detail_images=['https://img.alicdn.com/detail.jpg'];const product=validateProduct(p),data={products:[product]};
 assert.deepEqual(detailImagesFromJSON(url+'&spm=foo',data),p.detail_images);assert.equal(matchSkuImages(url,product.skus.map(s=>s.sku),product)[0].sku,'TB-51');assert.equal(productAttributesFromJSON(url,data)[0].name,'品牌');assert.deepEqual(matchSpecificationImport(url,product.skus,product).names,['容量']);assert.throws(()=>detailImagesFromJSON(url.replace('123','999'),data),/不一致/);
});

test('淘宝作为同款图文来源，仍保留货盘的编码和价格库存',()=>{
 const ref={...capture(fixture()).product,id:'ref',revision:1},stock={id:'stock',revision:1,source_url:'supplier:'+'a'.repeat(64),supplier_import:{supplier:'供应商'},title:'货盘',images:['https://img.alicdn.com/stock.jpg'],skus:[{sku:'BARCODE',spec:'50ml',cost:8,price:16,stock:20}]};
 const {product}=buildSameStyleProduct([stock,ref],{main_id:'stock',reference_id:'ref',title:'整理商品',dimension:'容量',images:'reference',rows:[{product_id:'stock',original_sku:'BARCODE',value:'50ml',reference_sku:'TB-51'}]});assert.equal(product.source_url,url);assert.equal(product.skus.length,1);assert.equal(product.skus[0].sku,'BARCODE');assert.equal(product.skus[0].stock,20);assert.equal(product.skus[0].cost,8);assert.equal(product.skus[0].image,ref.skus[0].image);
});

test('天猫独立来源与相同商品ID的淘宝区分，图文SKU可导入及补充',()=>{
 const source='https://detail.tmall.com/item.htm?id=123';
 assert.equal(canonicalSourceURL(source+'&spm=tracking#x'),source);assert.notEqual(canonicalSourceURL(source),canonicalSourceURL(url));
 const result=capture(fixture(),false,source),product=validateProduct(result.product);
 assert.equal(product.source_url,source);assert.equal(product.skus.length,2);assert.equal(product.skus[0].image,'https://img.alicdn.com/50.jpg');assert.ok(result.warnings.some(w=>w.startsWith('天猫价格')));
 assert.equal(capture(fixture(),true,source).diagnostics.platform,'tmall');
 product.detail_images=['https://img.alicdn.com/detail.jpg'];const data={products:[product]};
 assert.equal(detailImagesFromJSON(source+'&track=1',data).length,1);assert.equal(productAttributesFromJSON(source,data)[0].name,'品牌');assert.equal(matchSkuImages(source,product.skus.map(s=>s.sku),product).length,1);assert.deepEqual(matchSpecificationImport(source,product.skus,product).names,['容量']);assert.throws(()=>detailImagesFromJSON(url,data),/不一致/);
 for(const address of [source.replace('detail.tmall.com','detail.tmall.com.evil.test'),source.replace('https:','http:'),source+'&id=456',source.replace('/item.htm','/other.htm')]){assert.throws(()=>canonicalSourceURL(address));assert.ok(capture(fixture(),false,address).error);}
 const stock={id:'stock',revision:1,source_url:'supplier:'+'b'.repeat(64),supplier_import:{supplier:'供应商'},title:'货盘',images:[],skus:[{sku:'BAR',spec:'50ml',cost:9,price:19,stock:8}]};
 const merged=buildSameStyleProduct([stock,{...product,id:'ref',revision:1}],{main_id:'stock',reference_id:'ref',title:'新商品',dimension:'容量',images:'reference',rows:[{product_id:'stock',original_sku:'BAR',value:'50ml',reference_sku:'TB-51'}]}).product;
 assert.equal(merged.source_url,source);assert.equal(merged.skus[0].sku,'BAR');assert.equal(merged.skus[0].cost,9);
});
