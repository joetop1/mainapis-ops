import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {openStore} from '../core.mjs';
test('生产模式：账号隔离、回调认证、终态幂等和冲突拦截',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ops-callback-'));Object.assign(process.env,{DATA_DIR:dir,APP_ORIGIN:'https://ops.mainapis.com',DEMO_MODE:'false'});
 const {handler,closeStore}=await import('../server.mjs');const db=openStore(join(dir,'ops.sqlite'));
 db.prepare('INSERT INTO products VALUES(?,?,?,?,?,?,?,?)').run('product','alice','https://detail.1688.com/offer/123.html',JSON.stringify({title:'测试',images:[],skus:[]}), 'approved',1,'now','now');
 db.prepare('INSERT INTO jobs(id,owner,product_id,revision,target,status,token,message,remote_id,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('job','alice','product',1,'crmeb-pro','accepted','callback-secret','','','now','now');
 for(const owner of ['alice','bob'])db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(owner,JSON.stringify({user:{sub:owner},csrf:'csrf'}),Date.now()+60000);
 async function call(url,body,token='callback-secret',owner='alice'){
  const req=Readable.from(body?[Buffer.from(JSON.stringify(body))]:[]);Object.assign(req,{url,method:body?'POST':'GET',headers:{'content-type':'application/json',authorization:'Bearer '+token,cookie:'ops_session='+owner}});
  const res={status:200,setHeader(){},writeHead(s){this.status=s;},end(b){this.body=b;}};await handler(req,res);return{status:res.status,data:JSON.parse(res.body)};
 }
 try{
  assert.equal((await call('/api/state',null,'','bob')).data.products.length,0);
  const alice=(await call('/api/state')).data;assert.equal(alice.jobs.length,1);assert.equal(alice.jobs[0].token,undefined);
  assert.equal((await call('/api/callback/job',{status:'succeeded',remote_id:'42'},'bad')).status,403);
  assert.equal((await call('/api/callback/job',{status:'succeeded'})).status,400);
  assert.equal((await call('/api/callback/job',{status:'succeeded',remote_id:'42'})).status,200);
  assert.equal((await call('/api/callback/job',{status:'succeeded',remote_id:'42'})).data.duplicate,true);
  assert.equal((await call('/api/callback/job',{status:'failed'})).status,409);
  assert.equal((await call('/api/state')).data.jobs[0].remote_id,'42');
 }finally{db.close();closeStore();await rm(dir,{recursive:true,force:true});}
});
