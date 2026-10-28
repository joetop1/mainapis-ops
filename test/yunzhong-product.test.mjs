import test from 'node:test';
import assert from 'node:assert/strict';
import {buildYunzhongProduct} from '../yunzhong-product.mjs';
const lease={marker:'OPS-'+'a'.repeat(32),product:{catalog_target:'yunzhong',category_id:2,title:'测试商品',description:'',images:['https://example.com/main.jpg'],detail_images:['https://example.com/detail.jpg'],spec_names:['颜色'],skus:[{sku:'A',spec_values:['红'],price:10,cost:4,stock:2,image:'https://example.com/a.jpg'},{sku:'B',spec_values:['黑'],price:20,cost:8,stock:3,image:'https://example.com/b.jpg'}]}};
const config={categoryIds:[1,2],categoryLevel:2,dispatchPrice:'8.00'};
test('芸众规格按SC/SV/SP插入标记映射，保留真实组合和逐SKU价格库存配图，不造笛卡尔积',()=>{
 const before=structuredClone(lease),payload=buildYunzhongProduct(lease,config);assert.deepEqual(lease,before);
 assert.equal(payload.base.status,0);assert.equal(payload.base.stock,5);assert.deepEqual(payload.base.good_content,lease.product.detail_images);assert.equal(payload.options.option.length,2);
 assert.deepEqual(payload.options.specs.map(spec=>spec.title),['颜色']);
 assert.equal(payload.options.option[0].specs,'SV0X0');assert.equal(payload.options.option[1].specs,'SV0X1');
 assert.equal(payload.options.option[1].product_price,'20.00');assert.equal(payload.options.option[1].thumb,'https://example.com/b.jpg');
 assert.ok(payload.options.specs.every(spec=>spec.id.startsWith('SC')));assert.ok(payload.options.option.every(option=>option.id.startsWith('SP')));
});
test('文字、参数、三级分类和未核验字段均在写入前阻止，不静默丢失内容',()=>{
 for(const changes of [{description:'必须保留的文字'},{attributes:[{name:'材质',value:'硅胶'}]},{brand_ids:[1]},{tag_ids:[2]}])assert.throws(()=>buildYunzhongProduct({...lease,product:{...lease.product,...changes}},config));
 assert.throws(()=>buildYunzhongProduct(lease,{...config,categoryLevel:3,categoryIds:[1,9,2]}));
 assert.throws(()=>buildYunzhongProduct(lease,{...config,dispatchPrice:undefined}));
});

test('多维规格在写入前拦截，不自动合并或丢弃维度',()=>{
 const product={...lease.product,spec_names:['颜色','尺寸'],skus:lease.product.skus.map(row=>({...row,spec_values:[...row.spec_values,'M']}))};
 assert.throws(()=>buildYunzhongProduct({...lease,product},config),/多维SKU/);
});
import {verifyYunzhongOfficialProduct} from '../yunzhong-product.mjs';
test('官方读回仅覆盖部分字段，即使全部匹配也保持待人工核对',()=>{
 const expected=buildYunzhongProduct(lease,config),actual={id:99,...expected.base};
 const options={has_option:1,specs:[{title:'颜色',spec_item:[{id:1,title:'红'},{id:2,title:'黑'}]}],option:expected.options.option.map((row,i)=>({...row,specs:String(i+1)}))};
 const result=verifyYunzhongOfficialProduct(actual,options,{...lease,candidate_id:'99'},config);
 assert.equal(result.status,'awaiting_review');assert.match(result.message,/基础字段与SKU已核对/);
 options.option[0].stock=999;assert.match(verifyYunzhongOfficialProduct(actual,options,{...lease,candidate_id:'99'},config).message,/不一致/);
});

test('芸众官方和独立入口均舍弃不支持的虚拟销量，保留原商品及价格库存',()=>{
 const withSales={...lease,product:{...lease.product,virtual_sales:888}};
 const before=structuredClone(withSales);
 for(const compatibility of [false,true]){
  const settings={...config,compatibility};
  assert.deepEqual(buildYunzhongProduct(withSales,settings),buildYunzhongProduct(lease,settings));
 }
 assert.deepEqual(withSales,before);
 assert.throws(()=>buildYunzhongProduct({...withSales,product:{...withSales.product,tag_ids:[2]}},config),/标签尚未映射/);
});
