import test from 'node:test';
import assert from 'node:assert/strict';
import {openStore} from '../core.mjs';
import {recoverTigshopZeroStock} from '../tigshop-recovery.mjs';
const id='650b74d9-6d5e-4174-9245-4d45163e3699';
function setup(){const db=openStore(':memory:');db.exec('CREATE TABLE job_transports(job_id TEXT PRIMARY KEY,mode TEXT)');db.prepare('INSERT INTO products VALUES(?,?,?,?,?,?,?,?)').run('p','alice','source','{}','approved',10,'now','now');db.prepare('INSERT INTO jobs(id,owner,product_id,revision,target,status,token,message,remote_id,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,'alice','p',10,'tigshop','unknown','secret','创建请求可能已执行，请先核对商城，禁止重复创建。Tigshop：商品总库存必须大于0','','now','now');db.prepare('INSERT INTO job_snapshots(job_id,product,claimed) VALUES(?,?,1)').run(id,JSON.stringify({skus:[{stock:0}]}));db.prepare('INSERT INTO job_transports VALUES(?,?)').run(id,'direct');return db;}
test('known zero-stock rejection only releases after an empty remote query and cannot run twice',async()=>{
 const db=setup(),old=globalThis.fetch;let calls=0;
 globalThis.fetch=async(url,options)=>{calls++;assert.equal(options.method,'GET');assert.ok(String(url).endsWith('keyword=OPS-'+id.replaceAll('-','')));return {ok:true,status:200,text:async()=>JSON.stringify({code:0,data:{total:0,records:[]}})};};
 try{await assert.rejects(()=>recoverTigshopZeroStock(db,'bob',()=>({token:'a'.repeat(32)})));assert.equal(calls,0);await recoverTigshopZeroStock(db,'alice',()=>({token:'a'.repeat(32)}));assert.equal(calls,1);assert.equal(db.prepare('SELECT claimed FROM job_snapshots').get().claimed,0);assert.equal(db.prepare('SELECT status FROM jobs').get().status,'failed');await assert.rejects(()=>recoverTigshopZeroStock(db,'alice',()=>({token:'a'.repeat(32)})));assert.equal(calls,1);}finally{globalThis.fetch=old;db.close();}
});
test('existing remote record or a changed failure never releases a create claim',async()=>{
 const db=setup(),old=globalThis.fetch;
 globalThis.fetch=async()=>({ok:true,status:200,text:async()=>JSON.stringify({code:0,data:{total:1,records:[{productId:1}]}})});
 try{await assert.rejects(()=>recoverTigshopZeroStock(db,'alice',()=>({token:'a'.repeat(32)})),/未解除/);assert.equal(db.prepare('SELECT claimed FROM job_snapshots').get().claimed,1);db.prepare("UPDATE jobs SET message='timeout'").run();await assert.rejects(()=>recoverTigshopZeroStock(db,'alice',()=>({token:'a'.repeat(32)})),/不是已确认/);assert.equal(db.prepare('SELECT claimed FROM job_snapshots').get().claimed,1);}finally{globalThis.fetch=old;db.close();}
});
