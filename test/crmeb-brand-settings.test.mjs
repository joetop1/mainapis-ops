import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {openStore} from '../core.mjs';
test('backend-brand settings require session and CSRF, and isolate saved credentials by owner and mall',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ops-brands-'));
 Object.assign(process.env,{DATA_DIR:dir,APP_ORIGIN:'https://ops.mainapis.com',DEMO_MODE:'false'});
 const old=globalThis.fetch,requests=[];
 globalThis.fetch=async(url,options)=>{
  requests.push(String(url));let data;
  if(String(url).endsWith('/outapi/access_token')){assert.equal(JSON.parse(options.body).appsecret,'member-secret');data={status:200,data:{access_token:'member-token'}};}
  else if(String(url).endsWith('/outapi/get_token')){assert.equal(JSON.parse(options.body).appsecret,'store-secret');data={status:200,data:{token:'store-token'}};}
  else if(String(url).endsWith('/outapi/brand/list')){assert.match(options.headers.Authorization,/Bearer (member|store)-token/);data={status:200,data:[{value:22,label:'新品牌'}]};}
  else data={status:200,data:[]};
  return {ok:true,status:200,text:async()=>JSON.stringify(data)};
 };
 const {handler,closeStore}=await import('../server.mjs'),db=openStore(join(dir,'ops.sqlite'));
 for(const owner of ['alice','bob'])db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(owner,JSON.stringify({user:{sub:owner},csrf:'csrf'}),Date.now()+60000);
 const call=async(path,method='GET',body={},owner='alice',csrf='csrf')=>{const req=Readable.from([Buffer.from(JSON.stringify(body))]);Object.assign(req,{url:path,method,headers:{cookie:'ops_session='+owner,'content-type':'application/json',origin:'https://ops.mainapis.com','x-csrf-token':csrf}});const res={status:200,setHeader(){},writeHead(s){this.status=s;},end(b){this.body=b;}};await handler(req,res);return {status:res.status,raw:res.body,data:JSON.parse(res.body)};};
 try{
  assert.equal((await call('/api/connections/crmeb-pro','POST',{appid:'member',appsecret:'member-secret'},'alice','wrong')).status,403);
  for(const [target,appid,appsecret]of [['crmeb-pro','member','member-secret'],['crmeb-store','store','store-secret']]){
   const r=await call('/api/connections/'+target,'POST',{appid,appsecret});assert.equal(r.status,200);assert.equal(r.data.count,1);assert.ok(!r.raw.includes(appsecret));
   const saved=await call('/api/connections/'+target);assert.equal(saved.data.configured,true);assert.ok(!saved.raw.includes(appsecret));
   assert.equal((await call('/api/connections/'+target,'GET',{},'bob')).data.configured,false);
   const c=await call('/api/catalog/'+target+'?refresh=1');assert.equal(c.data.brands[0].name,'新品牌');
  }
  assert.equal((await call('/api/connections/crmeb-pro','POST',{appid:'changed'})).status,400);
  assert.equal((await call('/api/connections/crmeb-pro','POST',{})).status,200);
 }finally{globalThis.fetch=old;db.close();closeStore();await rm(dir,{recursive:true,force:true});}
});
