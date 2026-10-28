import test from 'node:test';
import assert from 'node:assert/strict';
import {openStore,uid} from '../core.mjs';
import {createTigshopRunner} from '../tigshop-direct.mjs';
import {buildTigshopProduct} from '../tigshop.mjs';
const p={catalog_target:'tigshop',category_id:1,brand_ids:[],title:'测试',images:['https://example.com/a.jpg'],skus:[{sku:'red',spec:'红',stock:4,price:80,cost:40,image:'https://example.com/red.jpg'}],tigshop:{fx:{sourceCurrency:'CNY',targetCurrency:'EUR',eurPerCny:0.125,rateDate:'2026-10-23'},shipping:{templateId:51}}};
function setup(mode){
 const db=openStore(':memory:'),id=uid(),requests=[];
 db.prepare('INSERT INTO products VALUES(?,?,?,?,?,?,?,?)').run('p','alice','https://detail.1688.com/offer/1.html','{}','approved',1,'now','now');
 db.prepare('INSERT INTO jobs(id,owner,product_id,revision,target,status,token,message,remote_id,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,'alice','p',1,'tigshop','dispatching','private-token','','','now','now');
 db.prepare('INSERT INTO job_snapshots(job_id,product) VALUES(?,?)').run(id,JSON.stringify(p));
 const job=db.prepare('SELECT * FROM jobs WHERE id=?').get(id),marker='OPS-'+id.replaceAll('-','');let created=false;
 const fetcher=async(url,options)=>{
  requests.push({url,options});assert.equal(options.redirect,'error');assert.equal(options.headers['X-ADMIN-TYPE'],'admin');
  let result;
  if(url.endsWith('shippingTplList'))result=mode==='auth'?{code:401,message:'login'}:{code:0,data:[{shopId:0,shippingTplId:51,shippingTplName:'中国大陆'}]};
  else if(url.includes('/list?'))result={code:0,data:{records:created?[{productId:100,productSn:marker,shopId:0}]:[]}};
  else if(url.endsWith('/create')){created=true;if(mode==='timeout')throw Error('network timeout');result={code:0,data:'商品已添加'};}
  else if(url.endsWith('detail?id=100')){
   const payload=buildTigshopProduct({product:p,marker},p.tigshop.fx,p.tigshop.shipping);
   result={code:0,data:{...payload,productId:100,productList:payload.productList.map(x=>({...x,skuData:x.attrs.map(a=>({name:a.attrName,value:a.attrValue}))}))}};
  }else throw Error('unexpected endpoint');
  return {ok:true,status:200,text:async()=>JSON.stringify(result)};
 };
 const run=createTigshopRunner({db,getConnection:owner=>{assert.equal(owner,'alice');return {token:'a'.repeat(32)};},audit(){},fetcher});
 return {db,id,job,run,requests};
}
test('direct flow creates once, finds its ID and verifies saved EUR data',async()=>{
 const t=setup('success');try{
  await Promise.all([t.run(t.job),t.run(t.job)]);
  const row=t.db.prepare('SELECT * FROM jobs WHERE id=?').get(t.id);
  assert.equal(row.status,'succeeded');assert.equal(row.remote_id,'100');assert.equal(t.requests.filter(r=>r.url.endsWith('/create')).length,1);
  const original=JSON.parse(t.db.prepare('SELECT product FROM job_snapshots WHERE job_id=?').get(t.id).product);assert.deepEqual(original,p);
  await t.run(t.job);assert.equal(t.requests.filter(r=>r.url.endsWith('/create')).length,1);
 }finally{t.db.close();}
});
test('auth failure is visible and leaves creation unclaimed',async()=>{
 const t=setup('auth');try{await t.run(t.job);assert.equal(t.db.prepare('SELECT claimed FROM job_snapshots').get().claimed,0);assert.match(t.db.prepare('SELECT message FROM jobs').get().message,/鉴权/);assert.equal(t.requests.length,1);}finally{t.db.close();}
});
test('uncertain POST never releases the claim or retries creation',async()=>{
 const t=setup('timeout');try{await t.run(t.job);assert.equal(t.db.prepare('SELECT claimed FROM job_snapshots').get().claimed,1);assert.equal(t.db.prepare('SELECT status FROM jobs').get().status,'unknown');await t.run(t.job);assert.equal(t.requests.filter(r=>r.url.endsWith('/create')).length,1);}finally{t.db.close();}
});
