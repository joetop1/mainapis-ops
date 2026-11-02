import test from 'node:test';
import assert from 'node:assert/strict';
import {validateProduct,assertPublishable} from '../core.mjs';
import {normalizeMallMappings,productForMall,productMallMappings} from '../public/mall-mappings.js';
const mapping=(id,target,category,brand)=>({catalog_connection_id:id,catalog_target:target,category_id:category,category:'分类'+category,brand_ids:[brand],tag_ids:[brand+100],...(target==='crmeb-store'?{applicable_type:1}:{})});
const product={source_url:'https://detail.1688.com/offer/123.html',title:'商品',images:['https://example.com/a.jpg'],skus:[{sku:'A',spec:'红',cost:2,price:5,stock:10}],mall_mappings:[mapping('member','crmeb-pro',11,21),mapping('store','crmeb-store',12,22),mapping('tig','tigshop',13,23)]};
test('三个商城独立分类品牌标签和门店范围，快照只包含所选映射和共用商品资料',()=>{
 const p=validateProduct(product),before=JSON.stringify(p);assertPublishable(p);
 const m=productForMall(p,'member','crmeb-pro'),s=productForMall(p,'store','crmeb-store'),t=productForMall(p,'tig','tigshop');
 assert.equal(m.category_id,11);assert.deepEqual(s.brand_ids,[22]);assert.equal(s.applicable_type,1);assert.deepEqual(t.tag_ids,[123]);assert.equal(m.mall_mappings,undefined);assert.equal(t.catalog_connection_id,'tig');assert.equal(t.title,p.title);assert.equal(JSON.stringify(p),before);
 assert.throws(()=>productForMall(p,'store','crmeb-pro'),/尚未设置/);assert.throws(()=>productForMall(p,'foreign','tigshop'),/尚未设置/);
});
test('重复连接、非法ID和错系统映射拒绝；不完整映射可以保存但不能发布',()=>{
 for(const rows of [[mapping('a','crmeb-pro',1,1),mapping('a','tigshop',2,2)],[{...mapping('a','crmeb-pro',1,1),brand_ids:[-1]}],[mapping('a','unknown',1,1)]])assert.throws(()=>normalizeMallMappings(rows));
 const p=validateProduct({...product,mall_mappings:[{...mapping('a','crmeb-pro',0,1),category:''}]});assert.throws(()=>assertPublishable(p));assert.throws(()=>productForMall(p,'a','crmeb-pro'),/有效分类/);
});
test('旧商品只保留原商城归属，不把原分类品牌复制给另一商城',()=>{
 const old={...product,mall_mappings:undefined,...mapping('old','crmeb-pro',11,21)};assert.equal(productMallMappings(old).length,1);assert.equal(productForMall(old,'old','crmeb-pro').category_id,11);assert.throws(()=>productForMall(old,'new','crmeb-pro'),/另一个商城/);
});
