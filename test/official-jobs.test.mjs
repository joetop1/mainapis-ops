import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {openStore} from '../core.mjs';
test('官方任务：一次性领取、不可假成功、核对nonce防过期回调、跨账号保护',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ops-official-'));Object.assign(process.env,{DATA_DIR:dir,APP_ORIGIN:'https://ops.mainapis.com',DEMO_MODE:'false',N8N_WEBHOOK_URL:'https://n8n.mainapis.com/webhook/test',N8N_WEBHOOK_TOKEN:'test'});
 const fetchOriginal=globalThis.fetch;const outbound=[];globalThis.fetch=async(url,options)=>{outbound.push(JSON.parse(options.body));return{ok:true};};
 const {handler,closeStore}=await import('../server.mjs');const db=openStore(join(dir,'ops.sqlite'));
 const p={title:'商品',category:'测试',source_url:'https://detail.1688.com/offer/123.html',images:['https://xlupw.com/test.jpg'],skus:[{sku:'A',spec:'默认',price:1,cost:0,stock:1}]};
 db.prepare('INSERT INTO products VALUES(?,?,?,?,?,?,?,?)').run('p','alice',p.source_url,JSON.stringify(p),'approved',1,'now','now');
 db.prepare('INSERT INTO jobs VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('job','alice','p',1,'crmeb-pro','accepted','callback-secret','','','now','now');db.prepare('INSERT INTO job_snapshots(job_id,product) VALUES(?,?)').run('job',JSON.stringify(p));
 for(const owner of ['alice','bob'])db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(owner,JSON.stringify({user:{sub:owner},csrf:'csrf'}),Date.now()+60000);
 async function call(url,body,owner='alice'){
  const req=Readable.from([Buffer.from(JSON.stringify(body))]);Object.assign(req,{url,method:'POST',headers:{'content-type':'application/json',authorization:'Bearer callback-secret',cookie:'ops_session='+owner,origin:'https://ops.mainapis.com','x-csrf-token':'csrf'}});
  const res={status:200,setHeader(){},writeHead(s){this.status=s;},end(b){this.body=b;}};await handler(req,res);return{status:res.status,data:JSON.parse(res.body)};
 }
 try{
  assert.equal((await call('/api/callback/job/claim',{action:'inspect_publish'})).status,200);assert.equal(db.prepare('SELECT claimed FROM job_snapshots').get().claimed,0);
  assert.equal((await call('/api/callback/job/claim',{action:'publish_draft'})).status,200);assert.equal((await call('/api/callback/job/claim',{action:'publish_draft'})).status,409);
  assert.equal((await call('/api/callback/job',{status:'failed'})).status,409);assert.equal((await call('/api/callback/job',{status:'succeeded',remote_id:'42'})).status,409);
  assert.equal((await call('/api/callback/job',{status:'awaiting_review',message:'等待ID'})).status,200);
  assert.equal((await call('/api/jobs/job/verify',{remote_id:'42'},'bob')).status,409);
  assert.equal((await call('/api/jobs/job/retry',{})).status,409);
  assert.equal((await call('/api/jobs/job/verify',{remote_id:'42'})).status,202);const first=outbound.at(-1);assert.equal(first.action,'verify_draft');
  assert.equal((await call('/api/callback/job/claim',{action:'verify_draft',verification_nonce:first.verification_nonce})).status,200);
  assert.equal((await call('/api/jobs/job/verify',{remote_id:'43'})).status,202);const second=outbound.at(-1);
  assert.equal((await call('/api/callback/job',{status:'succeeded',remote_id:'42',verification_nonce:first.verification_nonce})).status,409);
  assert.equal((await call('/api/callback/job',{status:'succeeded',remote_id:'42',verification_nonce:second.verification_nonce})).status,409);
  assert.equal((await call('/api/callback/job',{status:'succeeded',remote_id:'43',verification_nonce:second.verification_nonce})).status,200);
  assert.equal((await call('/api/callback/job',{status:'succeeded',remote_id:'43',verification_nonce:second.verification_nonce})).data.duplicate,true);
  assert.equal((await call('/api/products/p/publish',{target:'crmeb-pro',revision:1})).status,409);
 }finally{globalThis.fetch=fetchOriginal;db.close();closeStore();await rm(dir,{recursive:true,force:true});}
});
