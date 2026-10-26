import {buildTigshopProduct} from '../tigshop.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeProductAttributes,descriptionWithAttributes,productAttributesFromJSON} from '../public/product-attributes.js';
import {validateProduct} from '../core.mjs';
import {buildOfficialProduct} from '../crmeb-official.mjs';
import {buildStoreProduct} from '../crmeb-store.mjs';
const source='https://detail.1688.com/offer/123456.html';
test('动态保留商品参数、去重并过滤供货平台信息',()=>{
 const rows=[{name:'材质',value:'硅胶'},{name:'容量',value:'30 ml'},{name:'材质',value:'硅胶'},...['主要下游平台','主要销售地区','是否跨境出口专供货源','是否有可授权的自有品牌','代发条件','起批量','供应商名称'].map(name=>({name,value:'不应出现'}))];
 assert.deepEqual(normalizeProductAttributes(rows),[{name:'材质',value:'硅胶'},{name:'容量',value:'30 ml'}]);
 assert.deepEqual(validateProduct({source_url:source,attributes:rows}).attributes,normalizeProductAttributes(rows));
 assert.throws(()=>normalizeProductAttributes([{name:'材质',value:{unsafe:1}}]));
 assert.throws(()=>normalizeProductAttributes(Array(101).fill({name:'a',value:'b'})));
});
test('旧商品兼容，补充参数仅接受同来源采集文件',()=>{
 assert.deepEqual(validateProduct({source_url:source}).attributes,[]);
 const data={products:[{source_url:source,attributes:[{name:'尺寸',value:'20cm'}]}]};
 assert.equal(productAttributesFromJSON(source+'?tracking=1',data)[0].name,'尺寸');
 assert.throws(()=>productAttributesFromJSON('https://detail.1688.com/offer/999.html',data));
 assert.equal(descriptionWithAttributes('说明',[]),'说明');
});
test('通过现有详情字段发布，两个CRMEB均转义参数，过滤平台字段且不改变原商品',()=>{
 const product={source_url:source,title:'测试',category_id:1,catalog_target:'crmeb-store',description:'原详情',attributes:[{name:'材质',value:'<script>alert(1)</script>'},{name:'下游平台',value:'ebay'}],images:['https://example.com/main.jpg'],detail_images:['https://example.com/detail.jpg'],skus:[{sku:'A',spec:'默认',price:10,cost:1,stock:1}]};
 const publishing={...product,description:descriptionWithAttributes(product.description,product.attributes)};
 const lease={marker:'OPS-'+'a'.repeat(32),product:publishing};
 for(const build of [buildOfficialProduct,buildStoreProduct]){
  const payload=build(lease,{shippingTemplateId:1});
  assert.match(payload.description,/产品基本信息/);assert.match(payload.description,/&lt;script&gt;/);assert.doesNotMatch(payload.description,/<script>|ebay|下游平台/);assert.match(payload.description,/原详情/);assert.match(payload.description,/detail.jpg/);
 }
 const tig=buildTigshopProduct({...lease,product:{...publishing,catalog_target:'tigshop'}},{sourceCurrency:'CNY',targetCurrency:'EUR',eurPerCny:0.125},{templateId:1});assert.match(tig.productDesc,/产品基本信息/);assert.doesNotMatch(tig.productDesc,/<script>|ebay/);
 assert.equal(product.description,'原详情');
});
