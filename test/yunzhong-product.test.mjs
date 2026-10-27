import test from 'node:test';
import assert from 'node:assert/strict';
import {buildYunzhongProduct} from '../yunzhong-product.mjs';
const lease={marker:'OPS-'+'a'.repeat(32),product:{catalog_target:'yunzhong',category_id:2,title:'测试商品',description:'',images:['https://example.com/main.jpg'],detail_images:['https://example.com/detail.jpg'],spec_names:['颜色','尺寸'],skus:[{sku:'A',spec_values:['红','M'],price:10,cost:4,stock:2,image:'https://example.com/a.jpg'},{sku:'B',spec_values:['黑','L'],price:20,cost:8,stock:3,image:'https://example.com/b.jpg'}]}};
const config={categoryIds:[1,2],categoryLevel:2,dispatchPrice:'8.00'};
test('芸众规格按SC/SV/SP插入标记映射，保留真实组合和逐SKU价格库存配图，不造笛卡尔积',()=>{
 const before=structuredClone(lease),payload=buildYunzhongProduct(lease,config);assert.deepEqual(lease,before);
 assert.equal(payload.base.status,0);assert.equal(payload.base.stock,5);assert.deepEqual(payload.base.good_content,lease.product.detail_images);assert.equal(payload.options.option.length,2);
 assert.deepEqual(payload.options.specs.map(spec=>spec.title),['颜色','尺寸']);
 assert.equal(payload.options.option[0].specs,'SV0X0_SV1X0');assert.equal(payload.options.option[1].specs,'SV0X1_SV1X1');
 assert.equal(payload.options.option[1].product_price,'20.00');assert.equal(payload.options.option[1].thumb,'https://example.com/b.jpg');
 assert.ok(payload.options.specs.every(spec=>spec.id.startsWith('SC')));assert.ok(payload.options.option.every(option=>option.id.startsWith('SP')));
});
test('文字、参数、三级分类和未核验字段均在写入前阻止，不静默丢失内容',()=>{
 for(const changes of [{description:'必须保留的文字'},{attributes:[{name:'材质',value:'硅胶'}]},{brand_ids:[1]},{tag_ids:[2]},{virtual_sales:5}])assert.throws(()=>buildYunzhongProduct({...lease,product:{...lease.product,...changes}},config));
 assert.throws(()=>buildYunzhongProduct(lease,{...config,categoryLevel:3,categoryIds:[1,9,2]}));
 assert.throws(()=>buildYunzhongProduct(lease,{...config,dispatchPrice:undefined}));
});
