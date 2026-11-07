import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openStore} from '../core.mjs';
import {taskQueue,queueWorker,queueStatus,WORKER_LEASE_MS} from '../task-queue.mjs';
function add(db,id,revision=1){db.prepare('INSERT OR IGNORE INTO products VALUES(?,?,?,?,?,?,?,?)').run('p','alice','url','{}','approved',1,'now','now');db.prepare('INSERT INTO jobs(id,owner,product_id,revision,target,status,token,created,updated) VALUES(?,?,?,?,?,?,?,?,?)').run(id,'alice','p',revision,'crmeb-pro','dispatching','t','now','now');db.prepare('INSERT INTO job_snapshots(job_id,product) VALUES(?,?)').run(id,JSON.stringify({title:id}));}
test('发布快照和队列事务一致，待执行任务可跨数据库重开恢复',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ops-durable-'));let db=openStore(join(dir,'ops.sqlite'));try{let queue=taskQueue(db);db.exec('BEGIN');add(db,'rolled');queue.enqueue('rolled');db.exec('ROLLBACK');assert.equal(db.prepare('SELECT count(*) n FROM publication_queue').get().n,0);assert.equal(db.prepare('SELECT count(*) n FROM jobs').get().n,0);
 db.exec('BEGIN');add(db,'saved');queue.enqueue('saved');db.exec('COMMIT');db.close();db=openStore(join(dir,'ops.sqlite'));queue=taskQueue(db);const row=queue.take('worker');assert.equal(row.job_id,'saved');assert.equal(row.snapshot.claimed,0);queue.finish(row);assert.equal(db.prepare('SELECT state FROM publication_queue').get().state,'done');
 }finally{db.close();await rm(dir,{recursive:true,force:true});}
});
test('Worker租约保证单执行者，旧执行中任务只标核对且不释放创建锁',()=>{
 const db=openStore(':memory:');let now=1000000;const queue=taskQueue(db,{clock:()=>now});add(db,'inflight',1);add(db,'waiting',2);queue.enqueue('inflight');queue.enqueue('waiting');const row=queue.take('old');db.prepare("UPDATE job_snapshots SET claimed=1 WHERE job_id='inflight'").run();assert.equal(queue.take('other'),null);
 now+=WORKER_LEASE_MS+1;const next=queue.take('new');assert.equal(next.job_id,'waiting');assert.equal(db.prepare("SELECT status FROM jobs WHERE id='inflight'").get().status,'unknown');assert.equal(db.prepare("SELECT claimed FROM job_snapshots WHERE job_id='inflight'").get().claimed,1);assert.equal(db.prepare("SELECT state FROM publication_queue WHERE job_id='inflight'").get().state,'interrupted');queue.finish(row);assert.equal(queueStatus(db,true,{clock:()=>now}).interrupted,1);queue.finish(next);queue.release('new');assert.equal(queue.take('third'),null);db.close();
});
test('已领取和已成功的任务不重建，确认旧执行完成后不覆盖成功结果',()=>{
 const db=openStore(':memory:');let now=1000000;const queue=taskQueue(db,{clock:()=>now});add(db,'claimed');queue.enqueue('claimed');db.prepare("UPDATE job_snapshots SET claimed=1 WHERE job_id='claimed'").run();assert.equal(queue.take('a'),null);assert.equal(db.prepare('SELECT status FROM jobs').get().status,'unknown');assert.throws(()=>queue.enqueue('claimed'),/不可重新创建/);
 add(db,'done',2);queue.enqueue('done');queue.take('a');db.prepare("UPDATE jobs SET status='succeeded',remote_id='18' WHERE id='done'").run();now+=WORKER_LEASE_MS+1;assert.equal(queue.take('b'),null);assert.equal(db.prepare("SELECT status FROM jobs WHERE id='done'").get().status,'succeeded');assert.throws(()=>queue.enqueue('done'),/已结束/);db.close();
});
test('核对请求nonce隔离，入队冲突可回滚，旧核对不覆盖新请求',()=>{
 const db=openStore(':memory:'),queue=taskQueue(db);add(db,'j');db.prepare("UPDATE jobs SET status='verifying' WHERE id='j'").run();db.prepare("UPDATE job_snapshots SET claimed=1,candidate_id='18',verification_nonce='first' WHERE job_id='j'").run();queue.enqueue('j','verify_draft',{remote_id:'18',verification_nonce:'first'});
 db.prepare("UPDATE job_snapshots SET candidate_id='19',verification_nonce='second' WHERE job_id='j'").run();queue.enqueue('j','verify_draft',{remote_id:'19',verification_nonce:'second'});const row=queue.take('w');assert.equal(row.nonce,'second');assert.equal(JSON.parse(row.verification).remote_id,'19');db.exec('BEGIN');db.prepare("UPDATE job_snapshots SET verification_nonce='third' WHERE job_id='j'").run();assert.throws(()=>queue.enqueue('j','verify_draft',{remote_id:'19',verification_nonce:'third'}),/仍由Worker/);db.exec('ROLLBACK');assert.equal(db.prepare('SELECT verification_nonce FROM job_snapshots').get().verification_nonce,'second');queue.finish(row);db.close();
});
test('重复tick和两个Worker不会重复派发，异常中断不自动重试',async()=>{
 const db=openStore(':memory:'),queue=taskQueue(db);add(db,'one');queue.enqueue('one');let calls=0,release;const wait=new Promise(r=>release=r);const dispatch=async()=>{calls++;await wait;db.prepare("UPDATE jobs SET status='succeeded' WHERE id='one'").run();};const a=queueWorker({queue,dispatch}),b=queueWorker({queue,dispatch});const pending=a.tick();await b.tick();await a.tick();assert.equal(calls,1);release();await pending;await a.stop();await b.stop();
 add(db,'bad',2);queue.enqueue('bad');const fail=queueWorker({queue,dispatch:async()=>{throw Error('network');}});await fail.tick();await fail.tick();assert.equal(db.prepare("SELECT status FROM jobs WHERE id='bad'").get().status,'unknown');assert.equal(db.prepare("SELECT state FROM publication_queue WHERE job_id='bad'").get().state,'interrupted');await fail.stop();db.close();
});
