import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {openStore} from '../core.mjs';
test('publishing settings override environment per owner and mall, redact secrets, preserve brand credentials and drive retries',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ops-publish-settings-'));
 Object.assign(process.env,{DATA_DIR:dir,APP_ORIGIN:'https://ops.mainapis.com',DEMO_MODE:'false',N8N_WEBHOOK_URL:'https://n8n.mainapis.com/webhook/ops-crmeb-official',N8N_WEBHOOK_TOKEN:'environment-member',N8N_STORE_WEBHOOK_URL:'https://n8n.mainapis.com/webhook/ops-crmeb-store',N8N_STORE_WEBHOOK_TOKEN:'environment-store'});
 const old=globalThis.fetch,requests=[];
 globalThis.fetch=async(url,options)=>{requests.push({url,options});return {ok:true,status:200};};
 const {handler,closeStore}=await import('../server.mjs'),db=openStore(join(dir,'ops.sqlite'));
 for(const owner of ['alice','bob'])db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(owner,JSON.stringify({user:{sub:owner},csrf:'csrf'}),Date.now()+60000);
 const call=async(path,method='GET',body={},owner='alice',csrf='csrf')=>{const req=Readable.from([Buffer.from(JSON.stringify(body))]);Object.assign(req,{url:path,method,headers:{cookie:owner?'ops_session='+owner:'',origin:'https://ops.mainapis.com','x-csrf-token':csrf,'content-type':'application/json'}});const res={status:200,setHeader(){},writeHead(s){this.status=s;},end(b){this.body=b;}};await handler(req,res);return {status:res.status,raw:res.body,data:JSON.parse(res.body)};};
 const {connectionStore}=await import('../connection-store.mjs');const store=await connectionStore(db,dir,'crmeb-pro');
 const token='member-'+ 'a'.repeat(40),url='https://n8n.mainapis.com/webhook/ops-crmeb-official';
 try{
  store.set('alice',{appid:'existing-brand-app',appsecret:'existing-brand-secret',testedAt:'now'});
  const path='/api/connections/crmeb-pro/publishing';
  assert.equal((await call(path,'GET',{},'')).status,401);
  assert.equal((await call(path,'POST',{url,token},'alice','bad')).status,403);
  assert.equal((await call(path)).data.source,'environment');
  assert.equal((await call(path+'/test','POST',{url,token})).data.ok,true);
  assert.equal((await call(path)).data.source,'environment'); // Test does not save.
  assert.equal((await call(path,'POST',{url,token})).status,200);
  assert.equal(store.get('alice').appsecret,'existing-brand-secret');
  const shown=await call(path);assert.equal(shown.data.source,'page');assert.equal(shown.data.hasToken,true);assert.ok(!shown.raw.includes(token));
  assert.equal((await call(path,'GET',{},'bob')).data.source,'environment');
  assert.equal((await call('/api/connections/crmeb-store/publishing')).data.source,'environment');
  assert.equal((await call(path,'POST',{url,token:''})).status,200);assert.equal(store.get('alice').webhookToken,token);
  const id='12345678-1234-1234-1234-123456789abc';
  db.prepare('INSERT INTO products VALUES(?,?,?,?,?,?,?,?)').run('p','alice','source','{}','approved',1,'now','now');
  db.prepare('INSERT INTO jobs VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,'alice','p',1,'crmeb-pro','unknown','callback-secret','','','now','now');
  db.prepare('INSERT INTO job_snapshots(job_id,product) VALUES(?,?)').run(id,'{}');
  assert.equal((await call('/api/jobs/'+id+'/retry','POST')).status,202);
  const dispatched=requests.at(-1);assert.equal(dispatched.url,url);assert.equal(dispatched.options.headers['X-Ops-Token'],token);assert.equal(JSON.parse(dispatched.options.body).job_id,id);
  assert.equal((await call('/api/connections/crmeb-store/publishing','POST',{url,token})).status,400);
 }finally{globalThis.fetch=old;db.close();closeStore();await rm(dir,{recursive:true,force:true});}
});
