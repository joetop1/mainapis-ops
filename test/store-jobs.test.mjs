import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {openStore} from '../core.mjs';
test('多门店任务全链路：独立Webhook、跨商城拒绝、一次领取、核验回调',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ops-store-'));
 Object.assign(process.env,{DATA_DIR:dir,APP_ORIGIN:'https://ops.mainapis.com',DEMO_MODE:'false',N8N_WEBHOOK_URL:'https://n8n.mainapis.com/webhook/member',N8N_WEBHOOK_TOKEN:'member-token',N8N_STORE_WEBHOOK_URL:'https://n8n.mainapis.com/webhook/store',N8N_STORE_WEBHOOK_TOKEN:'store-token'});
 const oldFetch=globalThis.fetch,out=[];
 globalThis.fetch=async(url,options)=>{
  if(String(url).startsWith('https://www.xlyp.cc/api/'))return {ok:true,text:async()=>JSON.stringify({status:200,data:String(url).endsWith('category')?[{id:91,cate_name:'袜子'}]:[]})};
  out.push({url,headers:options.headers,body:JSON.parse(options.body)});return {ok:true};
 };
 const {handler,closeStore}=await import('../server.mjs');const db=openStore(join(dir,'ops.sqlite'));
 const p={catalog_target:'crmeb-store',category_id:91,category:'袜子',title:'测试',source_url:'https://detail.1688.com/offer/123.html',images:['https://example.com/a.jpg'],skus:[{sku:'A',spec:'均码',price:10,cost:5,stock:2}]};
 db.prepare('INSERT INTO products VALUES(?,?,?,?,?,?,?,?)').run('p','alice',p.source_url,JSON.stringify(p),'approved',1,'now','now');db.prepare('INSERT INTO sessions VALUES(?,?,?)').run('session',JSON.stringify({user:{sub:'alice'},csrf:'csrf'}),Date.now()+60000);
 async function call(url,body,token=''){
  const req=Readable.from([Buffer.from(JSON.stringify(body))]);Object.assign(req,{url,method:'POST',headers:{'content-type':'application/json',cookie:'ops_session=session',origin:'https://ops.mainapis.com','x-csrf-token':'csrf',authorization:'Bearer '+token}});
  const res={status:200,setHeader(){},writeHead(s){this.status=s;},end(b){this.body=b;}};await handler(req,res);return {status:res.status,data:JSON.parse(res.body)};
 }
 try{
  assert.equal((await call('/api/products/p/publish',{target:'crmeb-pro',revision:1})).status,400);assert.equal(out.length,0);
  const r=await call('/api/products/p/publish',{target:'crmeb-store',revision:1});assert.equal(r.status,202);const id=r.data.id,token=out[0].body.callback.token;
  assert.equal(out[0].url,'https://n8n.mainapis.com/webhook/store');assert.equal(out[0].headers['X-Ops-Token'],'store-token');assert.equal(out[0].body.target,'crmeb-store');
  const callback='/api/callback/'+id;assert.equal((await call(callback+'/claim',{action:'inspect_publish'},token)).status,200);
  assert.equal((await call(callback+'/claim',{action:'publish_draft'},token)).status,200);assert.equal((await call(callback+'/claim',{action:'publish_draft'},token)).status,409);
  assert.equal((await call(callback,{status:'awaiting_review'},token)).status,200);
  assert.equal((await call('/api/jobs/'+id+'/verify',{remote_id:'8'})).status,202);const verification=out.at(-1).body;assert.equal(out.at(-1).url,'https://n8n.mainapis.com/webhook/store');
  assert.equal((await call(callback,{status:'succeeded',remote_id:'8',verification_nonce:verification.verification_nonce},token)).status,200);
  assert.equal((await call('/api/products/p/publish',{target:'crmeb-store',revision:1})).status,409);
 }finally{globalThis.fetch=oldFetch;db.close();closeStore();await rm(dir,{recursive:true,force:true});}
});
