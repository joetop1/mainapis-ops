import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import vm from 'node:vm';
import {openStore} from '../core.mjs';
import {connectionStore} from '../connection-store.mjs';

test('前端统一保存两商城授权，任务只取得对应临时Token；团队迁移、隔离、掩码及权限',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ops-crmeb-auth-'));Object.assign(process.env,{DATA_DIR:dir,APP_ORIGIN:'https://ops.mainapis.com',DEMO_MODE:'false'});
 const oldFetch=globalThis.fetch,calls=[];let bad=false;
 globalThis.fetch=async(url,options)=>{calls.push({url,options});assert.equal(options.redirect,'error');return {ok:true,text:async()=>JSON.stringify(bad?{status:400,msg:'appid或appsecret错误',data:{appsecret:'DO-NOT-LEAK'}}:{status:200,data:String(url).includes('access_token')?{access_token:'member-access'}:{token:'store-access'}})};};
 const {handler,closeStore}=await import('../server.mjs'),db=openStore(join(dir,'ops.sqlite'));
 const call=async(path,method='POST',body={},user='alice',token='')=>{
  const req=Readable.from([Buffer.from(JSON.stringify(body))]);Object.assign(req,{url:path,method,headers:{'content-type':'application/json',cookie:'ops_session='+user,origin:'https://ops.mainapis.com','x-csrf-token':'csrf',authorization:'Bearer '+token}});
  const res={status:200,setHeader(){},writeHead(s){this.status=s;},end(b){this.raw=b;}};await handler(req,res);return {status:res.status,raw:res.raw,data:JSON.parse(res.raw)};
 };
 for(const sub of ['alice','bob','outsider'])db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(sub,JSON.stringify({user:{sub},csrf:'csrf'}),Date.now()+60000);
 try{
  for(const [i,target] of ['crmeb-pro','crmeb-store'].entries()){
   const store=await connectionStore(db,dir,target);store.set('alice',{webhookUrl:'https://n8n.mainapis.com/webhook/test-'+i,webhookToken:'hook-'+i});
   const route='/api/connections/'+target+'/auth',credentials={appid:'app-'+i,appsecret:'secret-'+i};
   assert.equal((await call(route+'/test','POST',credentials)).status,200);assert.equal(store.get('alice').appid,undefined);
   assert.equal((await call(route,'POST',credentials)).status,200);assert.equal(store.get('alice').webhookToken,'hook-'+i);
   const shown=await call(route,'GET');assert.equal(shown.data.configured,true);assert.equal(shown.raw.includes(credentials.appsecret),false);assert.equal(shown.raw.includes('member-access'),false);
   assert.equal((await call(route,'POST',{appid:credentials.appid,appsecret:''})).status,200);
   assert.equal((await call(route,'POST',{appid:'different',appsecret:''})).status,400);
   bad=true;assert.equal((await call(route,'POST',{appid:'bad',appsecret:'bad'})).status,400);bad=false;assert.equal(store.get('alice').appid,credentials.appid);
   db.prepare('INSERT INTO products VALUES(?,?,?,?,?,?,?,?)').run('p'+i,'alice','source'+i,'{}','approved',1,'now','now');
   db.prepare('INSERT INTO jobs(id,owner,product_id,revision,target,status,token,message,remote_id,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('job'+i,'alice','p'+i,1,target,'accepted','callback-'+i,'','','now','now');
   db.prepare('INSERT INTO job_snapshots(job_id,product) VALUES(?,?)').run('job'+i,'{}');
  }
  assert.equal((await call('/api/team','POST',{name:'团队'})).status,201);
  assert.equal((await call('/api/team/members','POST',{sub:'bob',role:'reviewer'})).status,200);
  assert.equal((await call('/api/connections/crmeb-pro/auth','GET',{},'bob')).status,403);
  assert.equal((await call('/api/connections/crmeb-pro/auth','GET',{},'outsider')).data.configured,false);
  for(const i of [0,1]){
   const route='/api/callback/job'+i+'/merchant-token',before=calls.length;
   assert.equal((await call(route,'POST',{},'','bad')).status,403);assert.equal(calls.length,before);
   const response=await call(route,'POST',{},'','callback-'+i);assert.equal(response.status,200);assert.equal(response.data.data.access_token,i?'store-access':'member-access');
   assert.equal(response.raw.includes('secret-'),false);assert.equal(JSON.parse(calls.at(-1).options.body).appid,'app-'+i);
   assert.equal(calls.at(-1).url,i?'https://www.xlyp.cc/outapi/get_token':'https://xlupw.com/outapi/access_token');
   assert.equal(db.prepare('SELECT claimed FROM job_snapshots WHERE job_id=?').get('job'+i).claimed,0);
   db.prepare("UPDATE jobs SET status='succeeded' WHERE id=?").run('job'+i);const count=calls.length;
   assert.equal((await call(route,'POST',{},'','callback-'+i)).status,409);assert.equal(calls.length,count);
  }
  const w=JSON.parse(await readFile(new URL('../workflows/crmeb-token-from-ops.json',import.meta.url),'utf8')),n=w.nodes[0];
  assert.equal(n.credentials,undefined);assert.equal(n.parameters.authentication,undefined);
  const resolve=expression=>vm.runInNewContext(expression.slice(3,-2),{$:()=>({first:()=>({json:{callbackUrl:'https://ops.mainapis.com/api/callback/job0',callbackToken:'callback-0'}})})});
  assert.equal(resolve(n.parameters.url),'https://ops.mainapis.com/api/callback/job0/merchant-token');
  assert.equal(resolve(n.parameters.headerParameters.parameters[0].value),'Bearer callback-0');
 }finally{globalThis.fetch=oldFetch;db.close();closeStore();await rm(dir,{recursive:true,force:true});}
});
