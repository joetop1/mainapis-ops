import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {openStore,uid} from '../core.mjs';
test('settings authenticate, isolate secrets and migrate an unclaimed n8n task to direct execution',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ops-tigshop-settings-'));
 Object.assign(process.env,{DATA_DIR:dir,APP_ORIGIN:'https://ops.mainapis.com',DEMO_MODE:'false',N8N_TIGSHOP_WEBHOOK_URL:'https://n8n.mainapis.com/webhook/old',N8N_TIGSHOP_WEBHOOK_TOKEN:'old-secret'});
 const oldFetch=globalThis.fetch,requests=[];
 globalThis.fetch=async(url,options)=>{
  requests.push(String(url));assert.ok(!String(url).includes('n8n.mainapis.com'));
  assert.equal(options.headers['X-Api-Token'],'a'.repeat(32));
  let response;
  if(String(url).endsWith('shippingTplList'))response={code:0,data:[{shopId:0,shippingTplId:51,shippingTplName:'中国大陆',isDefault:1}]};
  else if(String(url).endsWith('getAllCategory'))response={code:0,data:[{categoryId:1,categoryName:'袜子'}]};
  else if(String(url).endsWith('brand/search'))response={code:0,data:{brandList:[{brandId:2,brandName:'测试品牌'}]}};
  else if(String(url).includes('/list?'))response={code:0,data:{records:[]}};
  else if(String(url).endsWith('/create'))throw Error('uncertain timeout');
  else throw Error('unexpected endpoint');
  return {ok:true,status:200,text:async()=>JSON.stringify(response)};
 };
 const {handler,closeStore}=await import('../server.mjs'),db=openStore(join(dir,'ops.sqlite'));
 for(const who of ['alice','bob'])db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(who,JSON.stringify({user:{sub:who},csrf:'csrf-'+who}),Date.now()+60000);
 async function call(url,{method='GET',body={},who='alice',csrf=true,authorization=''}={}){
  const req=Readable.from([Buffer.from(JSON.stringify(body))]);Object.assign(req,{url,method,headers:{'content-type':'application/json',cookie:who?'ops_session='+who:'',origin:'https://ops.mainapis.com','x-csrf-token':csrf?'csrf-'+who:'wrong',authorization}});
  const res={status:200,setHeader(){},writeHead(s){this.status=s;},end(b){this.body=b;}};await handler(req,res);return {status:res.status,data:JSON.parse(res.body),raw:res.body};
 }
 try{
  assert.equal((await call('/api/connections/tigshop',{who:''})).status,401);
  assert.equal((await call('/api/connections/tigshop',{method:'POST',csrf:false})).status,403);
  const token='a'.repeat(32);
  const tested=await call('/api/connections/tigshop/test',{method:'POST',body:{token}});
  assert.equal(tested.status,200);assert.equal(tested.data.templates[0].id,51);assert.ok(!tested.raw.includes(token));
  assert.equal((await call('/api/connections/tigshop')).data.configured,false);
  assert.equal((await call('/api/connections/tigshop',{method:'POST',body:{token,templateId:51}})).status,200);
  const got=await call('/api/connections/tigshop');assert.equal(got.data.configured,true);assert.ok(!got.raw.includes(token));
  assert.equal((await call('/api/connections/tigshop',{who:'bob'})).data.configured,false);
  assert.equal((await call('/api/catalog/tigshop',{who:'bob'})).status,400);
  assert.equal((await call('/api/catalog/tigshop')).data.categories[0].id,1);
  assert.equal((await call('/api/connections/tigshop',{method:'POST',body:{templateId:51}})).status,200);
  const id=uid(),p={catalog_target:'tigshop',category_id:1,brand_ids:[2],title:'测试',images:['https://example.com/a.jpg'],skus:[{sku:'A',spec:'红',price:80,cost:40,stock:2}],tigshop:{fx:{sourceCurrency:'CNY',targetCurrency:'EUR',eurPerCny:0.125,rateDate:'2026-10-23'},shipping:{templateId:51}}};
  db.prepare('INSERT INTO products VALUES(?,?,?,?,?,?,?,?)').run('p','alice','https://detail.1688.com/offer/1.html',JSON.stringify(p),'approved',1,'now','now');
  db.prepare('INSERT INTO jobs(id,owner,product_id,revision,target,status,token,message,remote_id,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,'alice','p',1,'tigshop','accepted','legacy-callback-token','','','now','now');
  db.prepare('INSERT INTO job_snapshots(job_id,product) VALUES(?,?)').run(id,JSON.stringify(p));
  let releaseBody,bodyStarted;
  const started=new Promise(resolve=>bodyStarted=resolve),gate=new Promise(resolve=>releaseBody=resolve);
  const delayed=Readable.from((async function*(){bodyStarted();await gate;yield Buffer.from(JSON.stringify({action:'publish_draft'}));})());
  Object.assign(delayed,{url:'/api/callback/'+id+'/claim',method:'POST',headers:{'content-type':'application/json',authorization:'Bearer legacy-callback-token'}});
  const delayedResponse={setHeader(){},writeHead(status){this.status=status;},end(body){this.body=body;}};
  const pendingCallback=handler(delayed,delayedResponse);await started;
  assert.equal((await call('/api/jobs/'+id+'/retry',{method:'POST'})).status,202);
  releaseBody();await pendingCallback;assert.equal(delayedResponse.status,409);
  const late=await call('/api/callback/'+id+'/claim',{method:'POST',authorization:'Bearer legacy-callback-token',body:{action:'publish_draft'}});
  assert.equal(late.status,409);
  // Wait for the deliberately uncertain POST to finish before closing SQLite.
  for(let i=0;i<100;i++){await new Promise(resolve=>setImmediate(resolve));if(db.prepare('SELECT status FROM jobs WHERE id=?').get(id).status==='unknown')break;}
  assert.equal(db.prepare('SELECT status FROM jobs WHERE id=?').get(id).status,'unknown');
  assert.equal(db.prepare('SELECT claimed FROM job_snapshots WHERE job_id=?').get(id).claimed,1);
  assert.equal((await call('/api/jobs/'+id+'/retry',{method:'POST'})).status,409);
  assert.equal(requests.filter(u=>u.endsWith('/create')).length,1);
  assert.ok(!(await call('/api/state')).raw.includes(token));
 }finally{globalThis.fetch=oldFetch;db.close();closeStore();await rm(dir,{recursive:true,force:true});}
});
