process.env.OPS_LEGACY_N8N_PUBLISH='true';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {setTimeout as delay} from 'node:timers/promises';
import {openStore} from '../core.mjs';
import {connectionStore} from '../connection-store.mjs';
test('同一审核版本批量发布会员、多门店、Tigshop：独立快照、部分失败、重复提交与空间隔离',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ops-batch-'));Object.assign(process.env,{DATA_DIR:dir,APP_ORIGIN:'https://ops.mainapis.com',DEMO_MODE:'false'});
 const original=globalThis.fetch,calls=[];
 globalThis.fetch=async(url,opts={})=>{
  calls.push({url,opts});let value;
  if(String(url).startsWith('https://hooks.example.com/'))return {ok:true,status:200};
  if(String(url).includes('eurofxref'))return {ok:true,text:async()=>`<Cube time='${new Date().toISOString().slice(0,10)}'><Cube currency='CNY' rate='8.0'/></Cube>`};
  if(String(url).includes('/api/category'))value={status:200,data:[{id:String(url).includes('xlupw')?11:12,cate_name:'分类'}]};
  else if(String(url).includes('/api/brand'))value={status:200,data:[{id:String(url).includes('xlupw')?21:22,brand_name:'品牌'}]};
  else if(String(url).includes('getAllCategory'))value={code:0,data:[{categoryId:13,categoryName:'Tig类目',children:[]}]};
  else if(String(url).includes('/brand/search'))value={code:0,data:{brandList:[{brandId:23,brandName:'Tig品牌'}]}};
  else if(String(url).includes('/adminapi/'))value={code:0,data:{records:[],total:0}};
  else throw Error('Unexpected test request');
  return {ok:true,text:async()=>JSON.stringify(value)};
 };
 const {handler,closeStore}=await import('../server.mjs'),db=openStore(join(dir,'ops.sqlite'));
 for(const sub of ['alice','outsider'])db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(sub,JSON.stringify({user:{sub,name:sub},csrf:'csrf'}),Date.now()+60000);
 const call=async(path,method='GET',body={},sub='alice')=>{const req=Readable.from(method==='GET'?[]:[Buffer.from(JSON.stringify(body))]);Object.assign(req,{url:path,method,headers:{cookie:'ops_session='+sub,origin:'https://ops.mainapis.com','x-csrf-token':'csrf','content-type':'application/json'}});const res={status:200,setHeader(){},writeHead(s){this.status=s;},end(v){this.body=v;}};await handler(req,res);return {status:res.status,data:JSON.parse(res.body)};};
 try{
  const state=(await call('/api/state')).data,ids=Object.fromEntries(state.malls.filter(m=>m.legacy).map(m=>[m.type,m.id]));
  for(const type of ['crmeb-pro','crmeb-store']){const c=await connectionStore(db,dir,type);c.set('alice',{webhookUrl:'https://hooks.example.com/'+type,webhookToken:'h'.repeat(40)});}
  (await connectionStore(db,dir)).set('alice',{token:'a'.repeat(32),url:'https://tig.example.com',templateId:5});
  const maps=[['crmeb-pro',11,21],['crmeb-store',12,22],['tigshop',13,23]].map(([type,category,brand])=>({catalog_target:type,catalog_connection_id:ids[type],category_id:category,category:'分类',brand_ids:[brand],tag_ids:[],...(type==='crmeb-store'?{applicable_type:1}:{})}));
  const product={source_url:'https://detail.1688.com/offer/811.html',title:'测试',images:['https://example.com/main.jpg'],skus:[{sku:'A',spec:'红',cost:2,price:10,stock:10}],catalog_target:'crmeb-pro',catalog_connection_id:ids['crmeb-pro'],category_id:11,brand_ids:[21],mall_mappings:maps};
  const made=await call('/api/products','POST',product);assert.equal(made.status,201,JSON.stringify(made));const id=made.data.id;
  const saved=JSON.parse(db.prepare('SELECT data FROM products WHERE id=?').get(id).data);assert.equal(saved.mall_mappings.length,3);assert.equal(saved.mall_mappings[2].category,'Tig类目');
  assert.equal((await call('/api/products/'+id+'/approve','POST',{revision:1})).status,200);
  const destinations=maps.map(m=>({connection_id:m.catalog_connection_id,target:m.catalog_target}));
  assert.equal((await call('/api/products/'+id+'/publish','POST',{revision:1,destinations},'outsider')).status,400);
  assert.equal((await call('/api/products/'+id+'/publish','POST',{revision:1,destinations:[destinations[0],destinations[0]]})).status,400);
  // An absent mapping fails only that destination; other prepared malls create independent jobs.
  const unmapped=(await call('/api/malls','POST',{system:'crmeb-pro',name:'未设置分类'})).data.connection;
  const batch=await call('/api/products/'+id+'/publish','POST',{revision:1,destinations:[...destinations,{connection_id:unmapped.id,target:'crmeb-pro'}]});assert.equal(batch.status,202,JSON.stringify(batch));assert.equal(batch.data.results.filter(r=>r.ok).length,3);assert.match(batch.data.results[3].error,/尚未设置/);
  await delay(30);
  const snapshots=db.prepare('SELECT j.target,j.mall_connection_id,s.product FROM jobs j JOIN job_snapshots s ON s.job_id=j.id WHERE product_id=?').all(id);assert.equal(snapshots.length,3);
  for(const row of snapshots){const snapshot=JSON.parse(row.product),expected=maps.find(m=>m.catalog_target===row.target);assert.equal(snapshot.category_id,expected.category_id);assert.deepEqual(snapshot.brand_ids,expected.brand_ids);assert.equal(snapshot.catalog_connection_id,row.mall_connection_id);assert.equal(snapshot.mall_mappings,undefined);if(row.target==='crmeb-store')assert.equal(snapshot.applicable_type,1);}
  assert.equal(JSON.parse(db.prepare('SELECT data FROM products WHERE id=?').get(id).data).mall_mappings.length,3);
  const again=await call('/api/products/'+id+'/publish','POST',{revision:1,destinations});assert.ok(again.data.results.every(r=>!r.ok));assert.equal(db.prepare('SELECT COUNT(*) n FROM jobs WHERE product_id=?').get(id).n,3);
  const outsiderState=(await call('/api/state','GET',{},'outsider')).data,foreign=outsiderState.malls[0];const badSave=await call('/api/products/'+id,'PUT',{...product,revision:1,mall_mappings:[...maps,{catalog_connection_id:foreign.id,catalog_target:foreign.type,category_id:0,brand_ids:[]}]});assert.equal(badSave.status,400);
  // A connector-specific stock rejection does not prevent the two CRMEB destinations.
  const zero=await call('/api/products','POST',{...product,source_url:'https://detail.1688.com/offer/812.html',skus:product.skus.map(s=>({...s,stock:0}))});assert.equal(zero.status,201);
  await call('/api/products/'+zero.data.id+'/approve','POST',{revision:1});const partial=await call('/api/products/'+zero.data.id+'/publish','POST',{revision:1,destinations});assert.equal(partial.data.results.filter(r=>r.ok).length,2);assert.match(partial.data.results.find(r=>r.target==='tigshop').error,/总库存/);
  // Shared product edit retains all mappings but invalidates the former approval.
  assert.equal((await call('/api/products/'+id,'PUT',{...product,revision:1,title:'已修改'})).status,200);const stale=await call('/api/products/'+id+'/publish','POST',{revision:1,destinations});assert.equal(stale.status,400);assert.equal(db.prepare('SELECT COUNT(*) n FROM jobs WHERE product_id=?').get(id).n,3);
  const olderClient={...product,revision:2,title:'旧客户端修改',mall_mappings:undefined};assert.equal((await call('/api/products/'+id,'PUT',olderClient)).status,200);assert.equal(JSON.parse(db.prepare('SELECT data FROM products WHERE id=?').get(id).data).mall_mappings.length,3);
 }finally{await delay(30);globalThis.fetch=original;db.close();closeStore();await rm(dir,{recursive:true,force:true});}
});
