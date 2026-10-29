import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {openStore} from '../core.mjs';
test('团队采集API只认登录身份，默认前端我的范围可读取，全部仍允许协作',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ops-collection-scope-'));Object.assign(process.env,{DATA_DIR:dir,APP_ORIGIN:'https://ops.mainapis.com',DEMO_MODE:'false'});
 const {handler,closeStore}=await import('../server.mjs'),db=openStore(join(dir,'ops.sqlite'));
 const call=async(path,method='GET',body={},actor='alice')=>{const req=Readable.from([Buffer.from(JSON.stringify(body))]);Object.assign(req,{url:path,method,headers:{cookie:'ops_session='+actor,'content-type':'application/json',origin:'https://ops.mainapis.com','x-csrf-token':'csrf'}});const res={status:200,setHeader(){},writeHead(s){this.status=s;},end(b){this.body=b;}};await handler(req,res);return {status:res.status,data:JSON.parse(res.body)};};
 try{
  for(const sub of ['alice','bob'])db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(sub,JSON.stringify({user:{sub,name:sub+'名称'},csrf:'csrf'}),Date.now()+60000);
  assert.equal((await call('/api/team','POST',{name:'团队'})).status,201);
  assert.equal((await call('/api/team/members','POST',{sub:'bob',role:'editor',active:1})).status,200);
  const a=await call('/api/products','POST',{source_url:'https://detail.1688.com/offer/1.html',title:'我的商品',collected_by:'bob'});assert.equal(a.status,201);
  const b=await call('/api/import','POST',{products:[{source_url:'https://detail.1688.com/offer/2.html',title:'同事商品'}]},'bob');assert.equal(b.data.results[0].ok,true);
  const mine=await call('/api/state?collection_scope=mine');assert.equal(mine.data.products.length,1);assert.equal(mine.data.products[0].collected_by,'alice');assert.equal(mine.data.products[0].collector_name,'alice名称');
  const colleague=await call('/api/state?collection_scope=mine','GET',{},'bob');assert.equal(colleague.data.products.length,1);assert.equal(colleague.data.products[0].collected_by,'bob');
  assert.equal((await call('/api/state?collection_scope=all')).data.products.length,2);
 }finally{closeStore();db.close();await rm(dir,{recursive:true,force:true});}
});
