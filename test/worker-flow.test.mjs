import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {openStore} from '../core.mjs';
import {billingStore} from '../billing.mjs';
import {taskQueue} from '../task-queue.mjs';
test('持久队列模式：API只提交快照，Worker派发；核对仍使用原nonce和回调锁',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ops-worker-flow-'));Object.assign(process.env,{DATA_DIR:dir,APP_ORIGIN:'https://ops.mainapis.com',DEMO_MODE:'false',OPS_DURABLE_QUEUE:'true',N8N_WEBHOOK_URL:'https://n8n.mainapis.com/webhook/test',N8N_WEBHOOK_TOKEN:'test'});
 const original=globalThis.fetch,outbound=[];globalThis.fetch=async(_url,options)=>{outbound.push(JSON.parse(options.body));return {ok:true};};
 const {handler,closeStore,startPublicationWorker}=await import('../server.mjs'),db=openStore(join(dir,'ops.sqlite'));let worker;
 const p={title:'商品',category:'测试',source_url:'https://detail.1688.com/offer/123.html',images:['https://example.com/a.jpg'],skus:[{sku:'A',spec:'默认',price:10,cost:5,stock:3}]};db.prepare('INSERT INTO products VALUES(?,?,?,?,?,?,?,?)').run('p','alice',p.source_url,JSON.stringify(p),'approved',1,'now','now');for(const sub of ['alice','bob'])db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(sub,JSON.stringify({user:{sub},csrf:'csrf'}),Date.now()+60000);
 const billing=billingStore(db);const rate=billing.saveRates({actor:'root',collect:2,publish:5,revision:1});db.exec('UPDATE billing_settings SET enabled=1');billing.credit({owner:'alice',actor:'root',amount:30,key:'funds',reason:'test'});
 const call=async(url,body,user='alice',token='')=>{const req=Readable.from([Buffer.from(JSON.stringify(body))]);Object.assign(req,{url,method:'POST',headers:{'content-type':'application/json',cookie:'ops_session='+user,origin:'https://ops.mainapis.com','x-csrf-token':'csrf',authorization:'Bearer '+token}});const res={setHeader(){},writeHead(status){this.status=status;},end(data){this.body=data;}};await handler(req,res);return {status:res.status,data:JSON.parse(res.body)};};
 try{
 const created=await call('/api/products/p/publish',{target:'crmeb-pro',revision:1,billing_revision:rate.revision});assert.equal(created.status,202);assert.equal(outbound.length,0);assert.equal(billing.view('alice').account.frozen,5);const id=created.data.id;assert.equal(db.prepare('SELECT state FROM publication_queue WHERE job_id=?').get(id).state,'queued');assert.equal((await call('/api/products/p/publish',{target:'crmeb-pro',revision:1})).status,409);
 worker=startPublicationWorker();for(let n=0;n<100&&db.prepare('SELECT state FROM publication_queue WHERE job_id=?').get(id).state!=='done';n++)await new Promise(r=>setTimeout(r,10));assert.equal(outbound.length,1);assert.equal(outbound[0].job_id,id);assert.equal(db.prepare('SELECT status FROM jobs WHERE id=?').get(id).status,'accepted');
 const token=db.prepare('SELECT token FROM jobs WHERE id=?').get(id).token;assert.equal((await call('/api/callback/'+id+'/claim',{action:'publish_draft'},'alice',token)).status,200);assert.equal((await call('/api/callback/'+id+'/claim',{action:'publish_draft'},'alice',token)).status,409);await call('/api/callback/'+id,{status:'awaiting_review'},'alice',token);
 assert.equal((await call('/api/jobs/'+id+'/verify',{remote_id:'18'},'bob')).status,409);assert.equal((await call('/api/jobs/'+id+'/verify',{remote_id:'18'})).status,202);assert.equal(outbound.length,1);
 for(let n=0;n<250&&outbound.length<2;n++)await new Promise(r=>setTimeout(r,10));assert.equal(outbound.length,2);const request=outbound[1];assert.equal(request.action,'verify_draft');assert.equal(request.remote_id,'18');assert.ok(request.verification_nonce);assert.equal((await call('/api/callback/'+id,{status:'succeeded',remote_id:'18',verification_nonce:'old'},'alice',token)).status,409);assert.equal((await call('/api/callback/'+id,{status:'succeeded',remote_id:'18',verification_nonce:request.verification_nonce},'alice',token)).status,200);
 assert.equal(billing.view('alice').account.available,25);assert.equal(billing.view('alice').account.frozen,0);billing.reconcilePending();assert.equal(billing.view('alice').account.available,25);
 }finally{if(worker)await worker.stop();globalThis.fetch=original;db.close();closeStore();await rm(dir,{recursive:true,force:true});}
});
