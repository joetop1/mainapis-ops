import test from 'node:test';
import assert from 'node:assert/strict';
import {applyBulkMapping} from '../public/bulk-settings.js';
import {bulkProductSettings} from '../bulk-settings.mjs';
import {openStore} from '../core.mjs';
const a={catalog_connection_id:'a',catalog_target:'crmeb-pro',category_id:1,category:'会员分类',brand_ids:[2],tag_ids:[3]},b={catalog_connection_id:'b',catalog_target:'crmeb-store',category_id:4,category:'多店分类',brand_ids:[5],tag_ids:[],applicable_type:1};
test('批量映射仅填空缺与覆盖按字段独立处理，保留其他商城、标签、门店范围及来源',()=>{
 const p={...a,mall_mappings:[a,b],supplier_import:{supplier:'货盘来源'},skus:[{sku:'x',stock:8}]},before=JSON.stringify(p),change={...a,category_id:11,category:'新分类',brand_ids:[12],tag_ids:[]};
 const filled=applyBulkMapping(p,change,'fill');assert.equal(filled.category_id,1);assert.deepEqual(filled.brand_ids,[2]);assert.deepEqual(filled.mall_mappings[1],b);
 const overwrite=applyBulkMapping(p,change,'overwrite');assert.equal(overwrite.category_id,11);assert.deepEqual(overwrite.brand_ids,[12]);assert.deepEqual(overwrite.tag_ids,[3]);assert.equal(JSON.stringify(p),before);
 const onlyBrand=applyBulkMapping(p,{...change,category_id:0,category:''},'overwrite');assert.equal(onlyBrand.category_id,1);assert.deepEqual(onlyBrand.brand_ids,[12]);
 const newMall=applyBulkMapping(p,{...b,category_id:14,category:'修改多店',brand_ids:[]},'overwrite');assert.equal(newMall.category_id,1);assert.equal(newMall.mall_mappings[1].category_id,14);assert.equal(newMall.mall_mappings[1].applicable_type,1);assert.deepEqual(newMall.mall_mappings[1].brand_ids,[5]);assert.deepEqual(newMall.supplier_import,p.supplier_import);
 assert.throws(()=>applyBulkMapping(p,change,'bad'));
});
test('采集箱批量修改验证归属和版本，成功项回草稿、仅修改目标映射，无变化不增加版本',async()=>{
 const db=openStore(':memory:');try{
  const p={...a,mall_mappings:[a,b],title:'测试',images:[],skus:[],supplier_import:{supplier:'供应商'}};
  for(const [id,owner]of [['p1','alice'],['p2','alice'],['p3','bob']])db.prepare("INSERT INTO products VALUES(?,?,?,?,'approved',1,'now','now')").run(id,owner,id,JSON.stringify(p));
  const calls=[],run=(products,mapping,mode)=>bulkProductSettings({db,owner:'alice',input:{products,mapping,mode},validateMapping:async m=>m,audit:(...r)=>calls.push(r)});
  const result=await run([{id:'p1',revision:1},{id:'p2',revision:0},{id:'p3',revision:1}],{...a,category_id:10,category:'新分类'},'overwrite');assert.deepEqual(result.results.map(r=>r.ok),[true,false,false]);const row=db.prepare('SELECT * FROM products WHERE id=?').get('p1');assert.equal(row.status,'draft');assert.equal(row.revision,2);assert.deepEqual(JSON.parse(row.data).supplier_import,p.supplier_import);assert.equal(calls.length,1);
  const again=await run([{id:'p1',revision:2}],{...a,category_id:10,category:'新分类'},'overwrite');assert.equal(again.results[0].unchanged,true);assert.equal(db.prepare('SELECT revision FROM products WHERE id=?').get('p1').revision,2);
 }finally{db.close();}
});
