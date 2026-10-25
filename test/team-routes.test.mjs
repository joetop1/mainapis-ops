import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {openStore} from '../core.mjs';
test('team members share data, server enforces roles, inactive sessions stop immediately, and audit names the actor',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ops-team-'));Object.assign(process.env,{DATA_DIR:dir,APP_ORIGIN:'https://ops.mainapis.com',DEMO_MODE:'false'});
 const {handler,closeStore}=await import('../server.mjs'),db=openStore(join(dir,'ops.sqlite'));
 for(const who of ['alice','bob','eve'])db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(who,JSON.stringify({user:{sub:who,name:who},csrf:'csrf'}),Date.now()+60000);
 const p={title:'共享商品',source_url:'https://detail.1688.com/offer/1.html',category:'测试',images:['https://example.com/a.jpg'],skus:[{sku:'a',spec:'红',price:10,cost:5,stock:2}]};db.prepare('INSERT INTO products VALUES(?,?,?,?,?,?,?,?)').run('p','alice',p.source_url,JSON.stringify(p),'draft',1,'now','now');
 const call=async(url,method='GET',body={},who='alice')=>{const req=Readable.from([Buffer.from(JSON.stringify(body))]);Object.assign(req,{url,method,headers:{cookie:'ops_session='+who,origin:'https://ops.mainapis.com','x-csrf-token':'csrf','content-type':'application/json'}});const res={status:200,setHeader(){},writeHead(s){this.status=s;},end(b){this.body=b;}};await handler(req,res);return {status:res.status,data:JSON.parse(res.body)};};
 try{
  assert.equal((await call('/api/team','POST',{name:'运营团队'})).status,201);
  assert.equal((await call('/api/team/members','POST',{sub:'bob',role:'editor'})).status,200);
  assert.equal((await call('/api/state','GET',{},'bob')).data.products[0].id,'p');assert.equal((await call('/api/state','GET',{},'eve')).data.products.length,0);
  assert.equal((await call('/api/products/p/approve','POST',{revision:1},'bob')).status,403);
  assert.equal((await call('/api/connections/tigshop','GET',{},'bob')).status,403);
  assert.equal((await call('/api/products/p','PUT',{...p,title:'同事编辑',revision:1},'bob')).status,200);
  let events=(await call('/api/team')).data.events;assert.ok(events.some(e=>e.actor==='bob'&&e.action==='product.edit'));
  assert.equal((await call('/api/team/members','POST',{sub:'bob',role:'reviewer'})).status,200);
  assert.equal((await call('/api/products/p/approve','POST',{revision:2},'bob')).status,200);
  assert.equal((await call('/api/team/members','POST',{sub:'bob',role:'reviewer',active:0})).status,200);
  assert.equal((await call('/api/state','GET',{},'bob')).status,403);
 }finally{db.close();closeStore();await rm(dir,{recursive:true,force:true});}
});
