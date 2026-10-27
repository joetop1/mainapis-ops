import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {openStore} from '../core.mjs';
import {connectionStore} from '../connection-store.mjs';
test('芸众前端凭据加密、测试不保存、失败不覆盖、团队迁移与权限隔离',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'ops-yunzhong-'));Object.assign(process.env,{DATA_DIR:directory,APP_ORIGIN:'https://ops.mainapis.com',DEMO_MODE:'false'});
 const previousFetch=globalThis.fetch;let bad=false;const calls=[];
 globalThis.fetch=async(url,options)=>{calls.push({url,options});return {ok:true,text:async()=>JSON.stringify(bad?{result:0,msg:'do-not-leak'}:{result:1,data:{data:[],last_page:1}})};};
 const {handler,closeStore}=await import('../server.mjs'),db=openStore(join(directory,'ops.sqlite')),store=await connectionStore(db,directory,'yunzhong');
 for(const sub of ['alice','bob','outsider'])db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(sub,JSON.stringify({user:{sub},csrf:'csrf'}),Date.now()+60000);
 const call=async(path,method='GET',data={},user='alice')=>{const req=Readable.from([Buffer.from(JSON.stringify(data))]);Object.assign(req,{url:path,method,headers:{cookie:'ops_session='+user,origin:'https://ops.mainapis.com','x-csrf-token':'csrf','content-type':'application/json'}});const res={status:200,setHeader(){},writeHead(s){this.status=s;},end(b){this.body=b;}};await handler(req,res);return {status:res.status,data:JSON.parse(res.body),raw:String(res.body)};};
 try{
  const credentials={appid:'2026102700151259',appsecret:'private-yunzhong-secret',dispatchPrice:'0.00',categoryLevel:2},path='/api/connections/yunzhong';
  assert.equal((await call(path+'/test','POST',credentials)).status,200);assert.equal(store.get('alice'),null);
  assert.equal((await call(path,'POST',credentials)).status,200);assert.equal(store.get('alice').appsecret,credentials.appsecret);
  const shown=await call(path);assert.equal(shown.data.publishingReady,true);assert.equal(shown.raw.includes(credentials.appsecret),false);
  assert.equal((await call(path,'POST',{...credentials,categoryLevel:3})).status,200);assert.equal((await call(path)).data.publishingReady,false);
  await call(path,'POST',credentials);
  bad=true;assert.equal((await call(path,'POST',{appid:credentials.appid,appsecret:'wrong'})).status,400);assert.equal(store.get('alice').appsecret,credentials.appsecret);bad=false;
  assert.equal((await call('/api/team','POST',{name:'团队'})).status,201);assert.equal((await call('/api/team/members','POST',{sub:'bob',role:'editor'})).status,200);
  assert.equal((await call(path)).data.configured,true);assert.equal((await call(path,'GET',{},'bob')).status,403);assert.equal((await call(path,'GET',{},'outsider')).data.configured,false);
  assert.ok(calls.every(c=>c.options.method==='GET'));assert.ok(calls.every(c=>!c.url.includes('goods/create')));
 }finally{globalThis.fetch=previousFetch;db.close();closeStore();await rm(directory,{recursive:true,force:true});}
});
