import test from 'node:test';
import assert from 'node:assert/strict';
import {createCatalogLoader,applyCatalog} from '../catalog.mjs';
test('商城分类品牌：层级路径、真实ID、缓存和显式刷新',async()=>{
 let calls=0;
 const load=createCatalogLoader(async url=>{calls++;assert.ok(url.startsWith('https://xlupw.com/api/'));return {status:200,data:url.endsWith('category')?[{id:97,cate_name:'服饰',children:[{id:116,cate_name:'袜子'}]}]:[{id:12,brand_name:'测试品牌'}]};});
 const c=await load();assert.equal(c.categories[1].label,'服饰 / 袜子');assert.deepEqual(c.brands[0].ids,[12]);assert.equal(calls,2);await load();assert.equal(calls,2);await load(true);assert.equal(calls,4);
 const p=applyCatalog({category_id:116,category:'伪造名称',brand_ids:[12]},c);assert.equal(p.category,'服饰 / 袜子');assert.equal(p.catalog_target,'crmeb-pro');
 assert.throws(()=>applyCatalog({category_id:999},c));assert.throws(()=>applyCatalog({brand_ids:[999]},c));assert.throws(()=>applyCatalog({brand_ids:[1,12]},c));
});
test('商城列表失败不伪装为空列表、不缓存错误，空品牌可以不设置',async()=>{
 let fail=true;
 const load=createCatalogLoader(async url=>{if(fail&&url.endsWith('category'))throw Error('network');return {status:200,data:[]};});
 const first=await load();assert.ok(first.categoryError);assert.throws(()=>applyCatalog({category_id:1},first));
 fail=false;const next=await load();assert.equal(next.categoryError,'');assert.deepEqual(next.brands,[]);assert.doesNotThrow(()=>applyCatalog({brand_ids:[]},next));
});
test('多门店目录固定独立域名，禁止将会员分类资料冒用到多门店',async()=>{
 const load=createCatalogLoader(async url=>{assert.ok(url.startsWith('https://www.xlyp.cc/api/'));return {status:200,data:url.endsWith('category')?[{id:91,cate_name:'多门店袜子'}]:[]};},'crmeb-store');
 const c=await load();assert.equal(c.target,'crmeb-store');assert.throws(()=>applyCatalog({category_id:91,catalog_target:'crmeb-pro'},c));
 assert.equal(applyCatalog({category_id:91,catalog_target:'crmeb-store'},c).category,'多门店袜子');
});
