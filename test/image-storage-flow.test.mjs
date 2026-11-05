import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {setTimeout as delay} from 'node:timers/promises';
import {openStore} from '../core.mjs';
import {connectionStore} from '../connection-store.mjs';
const config={enabled:true,bucket:'examplebucket',region:'cn-hangzhou',publicOrigin:'https://images.example.com',allowedOrigins:['https://xlupw.com'],accessKeyId:'exampleAccessKeyID',accessKeySecret:'exampleSecretForTestsOnly'};
test('共享存储系统管理员和CSRF隔离，默认不下载；失败不调用发布入口，原任务恢复后使用转存快照',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ops-images-flow-'));Object.assign(process.env,{DATA_DIR:dir,APP_ORIGIN:'https://ops.mainapis.com',DEMO_MODE:'false',ALLOWED_SUBJECTS:'root,alice',SYSTEM_ADMIN_SUBJECTS:'root'});
 const originalFetch=globalThis.fetch,requests=[],objects=new Map();let fail=true;
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhWQAAAAASUVORK5CYII=','base64');
 globalThis.fetch=async(url,options={})=>{requests.push({url:String(url),options});if(String(url).startsWith('https://hooks.example.com/'))return new Response('{}');if(options.method==='PUT'){objects.set(new URL(url).pathname,Buffer.from(options.body));return new Response('');}if(String(url).startsWith(config.publicOrigin))return new Response(objects.get(new URL(url).pathname));if(String(url).startsWith('https://source.example.com/'))return new Response(fail?'unavailable':png,{status:fail?403:200});throw Error('unexpected network request');};
 const {handler,closeStore}=await import('../server.mjs'),db=openStore(join(dir,'ops.sqlite'));
 for(const sub of ['root','alice'])db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(sub,JSON.stringify({user:{sub},csrf:'csrf'}),Date.now()+60000);
 const call=async(path,method='GET',body={},sub='alice',headers={})=>{const req=Readable.from(method==='GET'?[]:[Buffer.from(JSON.stringify(body))]);Object.assign(req,{url:path,method,headers:{...(sub?{cookie:'ops_session='+sub}:{}),origin:'https://ops.mainapis.com','x-csrf-token':'csrf','content-type':'application/json',...headers}});const res={status:200,setHeader(){},writeHead(s){this.status=s;},end(v){this.body=v;}};await handler(req,res);return {status:res.status,data:JSON.parse(res.body)};};
 try{
  assert.equal((await call('/api/image-storage','GET',{},'')).status,401);assert.equal((await call('/api/image-storage','GET')).status,403);assert.equal((await call('/api/image-storage','POST',config,'root',{'x-csrf-token':'wrong'})).status,403);assert.equal((await call('/api/image-storage','POST',config,'root')).status,200);
  assert.equal(JSON.stringify((await call('/api/image-storage','GET',{},'root')).data).includes(config.accessKeyId),false);assert.equal(db.prepare('SELECT encrypted FROM connections_images').get().encrypted.includes(config.accessKeySecret),false);
  const state=(await call('/api/state')).data,mall=state.malls.find(m=>m.type==='crmeb-pro'&&m.legacy);
  (await connectionStore(db,dir,'crmeb-pro')).set('alice',{webhookUrl:'https://hooks.example.com/member',webhookToken:'h'.repeat(40)});
  assert.equal((await call('/api/image-storage/availability')).data.malls.find(m=>m.id===mall.id).available,true);
  const product={source_url:'https://detail.1688.com/offer/811.html',title:'测试',category:'旧分类',images:['https://source.example.com/main.jpg'],skus:[{sku:'A',spec:'红',cost:2,price:10,stock:10}]};
  const make=async(n,flag)=>{const made=await call('/api/products','POST',{...product,source_url:'https://detail.1688.com/offer/'+n+'.html'});assert.equal(made.status,201);await call('/api/products/'+made.data.id+'/approve','POST',{revision:1});const result=await call('/api/products/'+made.data.id+'/publish','POST',{revision:1,target:'crmeb-pro',connection_id:mall.id,...(flag===undefined?{}:{import_images:flag})});return {result,id:made.data.id};};
  const plain=await make(811);assert.equal(plain.result.status,202);assert.equal(requests.length,1);assert.ok(requests[0].url.startsWith('https://hooks.example.com/'));assert.equal(db.prepare('SELECT COUNT(*) n FROM image_transfer_jobs').get().n,0);
  const selected=await make(812,true);assert.equal(selected.result.status,202);await delay(30);const job=db.prepare('SELECT * FROM jobs WHERE id=?').get(selected.result.data.id);assert.equal(job.status,'unknown');assert.match(job.message,/图片转存未完成/);assert.equal(requests.filter(r=>r.url.startsWith('https://hooks.example.com/')).length,1);
  const snap=db.prepare('SELECT * FROM job_snapshots WHERE job_id=?').get(job.id);assert.equal(snap.claimed,0);assert.equal(JSON.parse(snap.product).images[0],product.images[0]);
  const claim=await call('/api/callback/'+job.id+'/claim','POST',{action:'publish_draft'},'',{authorization:'Bearer '+job.token});assert.equal(claim.status,409);
  fail=false;assert.equal((await call('/api/jobs/'+job.id+'/retry','POST')).status,202);await delay(30);assert.equal(db.prepare('SELECT status FROM jobs WHERE id=?').get(job.id).status,'accepted');const final=JSON.parse(db.prepare('SELECT product FROM job_snapshots WHERE job_id=?').get(job.id).product);assert.ok(final.images[0].startsWith(config.publicOrigin+'/ops/'));assert.equal(JSON.parse(db.prepare('SELECT data FROM products WHERE id=?').get(selected.id).data).images[0],product.images[0]);const payload=JSON.parse(requests.filter(r=>r.url.startsWith('https://hooks.example.com/')).at(-1).options.body);assert.equal(payload.product.images[0],final.images[0]);
  const bad=await make(813,'true');assert.equal(bad.result.status,400);
 }finally{globalThis.fetch=originalFetch;db.close();closeStore();await rm(dir,{recursive:true,force:true});}
});
