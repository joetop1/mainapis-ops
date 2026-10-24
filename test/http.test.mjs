import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
test('请求处理链路：登录隔离、CSRF、商品导入、审核、编辑失效、发布未配置',async()=>{
 const data=await mkdtemp(join(tmpdir(),'goods-test-')),origin='http://127.0.0.1:3080';
 Object.assign(process.env,{DATA_DIR:data,APP_ORIGIN:origin,DEMO_MODE:'true'});
 const {handler,closeStore}=await import('../server.mjs');
 async function request(path,options={}) {
   const req=Readable.from(options.body?[Buffer.from(options.body)]:[]);
   const headers=Object.fromEntries(Object.entries(options.headers||{}).map(([k,v])=>[k.toLowerCase(),v]));
   Object.assign(req,{url:path.replace(origin,''),method:options.method||'GET',headers});
   const res={status:200,headers:{},setHeader(k,v){this.headers[k.toLowerCase()]=v;},writeHead(status,h={}){this.status=status;for(const [k,v]of Object.entries(h))this.setHeader(k,v);},end(v){this.body=v||'';}};
   await handler(req,res);
   return {status:res.status,headers:{get:k=>res.headers[k.toLowerCase()]},json:async()=>JSON.parse(res.body||'{}')};
 }
 try {
  assert.equal((await request(origin+'/pricing.js')).headers.get('content-type'),'text/javascript');
  assert.equal((await request(origin+'/api/state')).status,401);
  const login=await request(origin+'/auth/login',{redirect:'manual'});assert.equal(login.status,302);const cookie=login.headers.get('set-cookie').split(';')[0];
  const me=await(await request(origin+'/api/me',{headers:{cookie}})).json();assert.equal(me.user.sub,'demo');
  async function call(path,method='GET',body,csrf=me.csrf){const r=await request(origin+path,{method,headers:{cookie,origin,'Content-Type':'application/json','X-CSRF-Token':csrf},body:body?JSON.stringify(body):undefined});return{status:r.status,data:await r.json()};}
  const p={source_url:'https://detail.1688.com/offer/123.html',title:'收纳盒',category:'家居',images:['https://example.com/image.png'],skus:[{sku:'A',spec:'白色',cost:10,price:20,stock:3}]};
  assert.equal((await call('/api/products','POST',p,'bad')).status,403);
  let r=await call('/api/products','POST',p);assert.equal(r.status,201);const id=r.data.id;
  assert.equal((await call('/api/products','POST',p)).status,400);
  assert.equal((await call(`/api/products/${id}/approve`,'POST',{revision:1})).status,200);
  assert.equal((await call(`/api/products/${id}/publish`,'POST',{target:'crmeb-pro',revision:1})).status,503);
  assert.equal((await call(`/api/products/${id}`,'PUT',{...p,title:'修改后的标题',revision:1})).status,200);
  assert.equal((await call(`/api/products/${id}`,'PUT',{...p,revision:1})).status,409);
  r=await call('/api/state');assert.equal(r.data.products[0].revision,2);assert.equal(r.data.products[0].status,'draft');assert.equal(r.data.jobs.length,0);
  r=await call('/api/import','POST',{products:[p,{source_url:'https://evil.com'}]});assert.deepEqual(r.data.results.map(x=>x.ok),[false,false]);
  r=await call('/api/import','POST',{table:'商品标题\t宝贝ID\t价格\t代发价\n官方导出测试\t456\t3.98\t4.98'});assert.equal(r.data.results[0].ok,true);
  const imported=(await call('/api/state')).data.products.find(x=>x.source_url.includes('/456.html'));assert.equal(imported.status,'draft');assert.equal(imported.sourcing.purchase_price,'3.98');assert.equal(imported.skus.length,0);
  assert.equal((await call(`/api/products/${imported.id}/approve`,'POST',{revision:1})).status,400);
  assert.equal((await call('/api/import','POST',{table:'商品标题\t宝贝ID\n重复来源\t456'})).data.results[0].ok,false);
  assert.equal((await call('/api/callback/fake','POST',{status:'succeeded'})).status,403);
  const originalFetch=globalThis.fetch;let removed=false;
  try{
   globalThis.fetch=async url=>{assert.ok(String(url).startsWith('https://xlupw.com/api/'));return {ok:true,text:async()=>JSON.stringify({status:200,data:String(url).endsWith('category')?(removed?[]:[{id:97,cate_name:'服饰',children:[{id:116,cate_name:'袜子'}]}]):[{id:12,brand_name:'品牌A'}]})};};
   assert.equal((await request(origin+'/api/catalog/crmeb-pro')).status,401);
   assert.equal((await call('/api/catalog/crmeb-pro')).data.categories[1].label,'服饰 / 袜子');
   const selected={...p,source_url:'https://detail.1688.com/offer/789.html',category:'客户端伪造分类名称',category_id:116,brand_ids:[12]};
   r=await call('/api/products','POST',selected);assert.equal(r.status,201);const selectedId=r.data.id;
   const stored=(await call('/api/state')).data.products.find(x=>x.id===selectedId);assert.equal(stored.category,'服饰 / 袜子');assert.equal(stored.category_id,116);
   assert.equal((await call('/api/products','POST',{...selected,category_id:999})).status,400);
   assert.equal((await call('/api/products','POST',{...selected,brand_ids:[999]})).status,400);
   removed=true;await call('/api/catalog/crmeb-pro?refresh=1');
   assert.equal((await call(`/api/products/${selectedId}/approve`,'POST',{revision:1})).status,400);
  }finally{globalThis.fetch=originalFetch;}
  await call('/auth/logout','POST',{});assert.equal((await call('/api/state')).status,401);
 } finally {closeStore();await rm(data,{recursive:true,force:true});}
});
