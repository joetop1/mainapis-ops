import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {randomUUID} from 'node:crypto';
import {openStore} from '../core.mjs';
import {taskQueue} from '../task-queue.mjs';

test('默认商城核心发布由Worker直连，保存配置快照，恢复未领取旧任务并保护已领取创建',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ops-core-worker-'));
 Object.assign(process.env,{DATA_DIR:dir,APP_ORIGIN:'https://ops.mainapis.com',DEMO_MODE:'false',OPS_DURABLE_QUEUE:'true',OPS_LEGACY_N8N_PUBLISH:'false',N8N_WEBHOOK_URL:'https://n8n.mainapis.com/webhook/old',N8N_WEBHOOK_TOKEN:'old'});
 const original=globalThis.fetch,calls=[];
 let timeout=false;
 globalThis.fetch=async(url,options={})=>{
  calls.push({url:String(url),body:options.body?JSON.parse(options.body):null});
  assert(!String(url).includes('n8n.mainapis.com'),'新发布不得进入n8n');
  if(String(url).endsWith('/outapi/access_token'))return {ok:true,text:async()=>JSON.stringify({status:200,data:{access_token:'token'}})};
  if(String(url).endsWith('/api/category'))return {ok:true,text:async()=>JSON.stringify({status:200,data:[{id:1,cate_name:'测试'}]})};
  if(String(url).endsWith('/api/brand'))return {ok:true,text:async()=>JSON.stringify({status:200,data:[]})};
  if(String(url).endsWith('/outapi/product')){
   if(timeout)throw Error('timeout after create');
   return {ok:true,text:async()=>JSON.stringify({status:200,data:{}})};
  }
  throw Error('Unexpected request '+url);
 };
 const {handler,startPublicationWorker,closeStore}=await import('../server.mjs');
 const db=openStore(join(dir,'ops.sqlite'));
 let worker;
 const call=async(url,body={},method='POST')=>{
  const req=Readable.from([Buffer.from(JSON.stringify(body))]);
  Object.assign(req,{url,method,headers:{'content-type':'application/json',cookie:'ops_session=alice',origin:'https://ops.mainapis.com','x-csrf-token':'csrf'}});
  const res={setHeader(){},writeHead(status){this.status=status;},end(value){this.body=value;}};
  await handler(req,res);return {status:res.status,data:JSON.parse(res.body)};
 };
 const product={title:'发布快照',category:'测试',category_id:1,catalog_target:'crmeb-pro',source_url:'https://detail.1688.com/offer/123.html',images:['https://example.com/a.jpg'],skus:[{sku:'A',spec:'默认',price:10,cost:5,stock:3}]};
 const seed=id=>db.prepare('INSERT INTO products VALUES(?,?,?,?,?,?,?,?)').run(id,'alice',product.source_url+'/'+id,JSON.stringify(product),'approved',1,'now','now');
 const waitDone=async id=>{
  for(let n=0;n<600;n++){
   if(db.prepare('SELECT state FROM publication_queue WHERE job_id=?').get(id)?.state==='done')return;
   await new Promise(resolve=>setTimeout(resolve,10));
  }
  assert.fail('Worker did not complete');
 };
 try{
  db.prepare('INSERT INTO sessions VALUES(?,?,?)').run('alice',JSON.stringify({user:{sub:'alice'},csrf:'csrf'}),Date.now()+60000);
  seed('p');
  assert.equal((await call('/api/products/p/publish',{target:'crmeb-pro',revision:1})).status,503);
  assert.equal(calls.length,0);
  assert.equal((await call('/api/connections/crmeb-pro/auth',{appid:'a',appsecret:'secret',shippingTemplateId:9})).status,200);
  const settings=await call('/api/connections/crmeb-pro/publishing',{},'GET');
  assert.equal(settings.data.transport,'worker');assert.equal(settings.data.configured,true);
  assert.equal((await call('/api/connections/crmeb-pro/publishing',{url:'https://n8n.mainapis.com/webhook/new',token:'ignored'})).status,409);
  const request_id='publish-request-123456';
  const created=await call('/api/products/p/publish',{target:'crmeb-pro',revision:1,request_id});
  assert.equal(created.status,202,JSON.stringify(created.data));
  const id=created.data.id;
  const receipt=await call('/api/products/p/publish?request_id='+request_id,{},'GET');
  assert.equal(receipt.status,200);assert.equal(receipt.data.results[0].id,id);
  assert.equal(receipt.data.results[0].ok,true);
  assert.deepEqual((await call('/api/products/p/publish?request_id=other-request-123456',{},'GET')).data.results,[]);
  db.prepare('INSERT INTO publication_receipts VALUES(?,?,?,?,?)').run('other-owner','p',request_id,'other-mall',id);
  assert.equal((await call('/api/products/p/publish?request_id='+request_id,{},'GET')).data.results.length,1);
  assert.equal((await call('/api/products/p/publish',{target:'crmeb-pro',revision:1,request_id})).status,409);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM jobs WHERE product_id=?').get('p').n,1);
  assert.equal(calls.filter(c=>c.url.endsWith('/outapi/product')).length,0);
  const snapshot=JSON.parse(db.prepare('SELECT product FROM job_snapshots WHERE job_id=?').get(id).product);
  assert.deepEqual(snapshot.crmeb,{origin:'https://xlupw.com',shippingTemplateId:9});
  worker=startPublicationWorker();await waitDone(id);
  assert.equal(db.prepare('SELECT mode FROM job_transports WHERE job_id=?').get(id).mode,'direct');
  assert.equal(db.prepare('SELECT status FROM jobs WHERE id=?').get(id).status,'awaiting_review');
  assert.equal(calls.find(c=>c.url.endsWith('/outapi/product')).body.temp_id,9);

  seed('legacy');const oldId=randomUUID();
  db.prepare('INSERT INTO jobs(id,owner,product_id,revision,target,status,token,created,updated) VALUES(?,?,?,?,?,?,?,?,?)').run(oldId,'alice','legacy',1,'crmeb-pro','dispatching','old-token','now','now');
  db.prepare('INSERT INTO job_snapshots(job_id,product) VALUES(?,?)').run(oldId,JSON.stringify(product));
  taskQueue(db).enqueue(oldId);
  await waitDone(oldId);
  assert.equal(JSON.parse(db.prepare('SELECT product FROM job_snapshots WHERE job_id=?').get(oldId).product).crmeb.shippingTemplateId,9);
  assert.equal(db.prepare('SELECT status FROM jobs WHERE id=?').get(oldId).status,'awaiting_review');

  seed('timeout');timeout=true;
  const pending=await call('/api/products/timeout/publish',{target:'crmeb-pro',revision:1});
  assert.equal(pending.status,202);
  await waitDone(pending.data.id);
  assert.equal(db.prepare('SELECT status FROM jobs WHERE id=?').get(pending.data.id).status,'unknown');
  assert.equal(db.prepare('SELECT claimed FROM job_snapshots WHERE job_id=?').get(pending.data.id).claimed,1);
  const writes=calls.filter(c=>c.url.endsWith('/outapi/product')).length;
  assert.equal((await call('/api/jobs/'+pending.data.id+'/retry')).status,409);
  assert.equal(calls.filter(c=>c.url.endsWith('/outapi/product')).length,writes);
 }finally{
  if(worker)await worker.stop();
  globalThis.fetch=original;db.close();closeStore();await rm(dir,{recursive:true,force:true});
 }
});
