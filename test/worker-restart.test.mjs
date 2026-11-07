import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {once} from 'node:events';
import {openStore} from '../core.mjs';
import {taskQueue} from '../task-queue.mjs';
const execute=promisify(execFile);
test('API启动不打断队列中任务；真实Worker进程具备心跳、健康检查和安全退出',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ops-worker-restart-')),db=openStore(join(dir,'ops.sqlite')),queue=taskQueue(db);let child,closeStore;
 Object.assign(process.env,{DATA_DIR:dir,APP_ORIGIN:'https://ops.mainapis.com',DEMO_MODE:'false',OPS_DURABLE_QUEUE:'true'});
 db.prepare('INSERT INTO products VALUES(?,?,?,?,?,?,?,?)').run('p','alice','url','{}','approved',1,'now','now');
 for(const [id,revision] of [['waiting',1],['running',2],['legacy',3]]){db.prepare('INSERT INTO jobs(id,owner,product_id,revision,target,status,token,created,updated) VALUES(?,?,?,?,?,?,?,?,?)').run(id,'alice','p',revision,'crmeb-pro','dispatching','t','now','now');db.prepare('INSERT INTO job_snapshots(job_id,product) VALUES(?,?)').run(id,'{}');if(id!=='legacy')queue.enqueue(id);}
 db.exec("CREATE TABLE job_transports(job_id TEXT PRIMARY KEY,mode TEXT);INSERT INTO job_transports VALUES('legacy','direct');UPDATE jobs SET status='accepted' WHERE id='legacy';UPDATE publication_queue SET state='running',worker='interrupted' WHERE job_id='running';UPDATE publication_worker SET owner='interrupted',heartbeat=1;");
 try{
 ({closeStore}=await import('../server.mjs'));assert.equal(db.prepare("SELECT status FROM jobs WHERE id='waiting'").get().status,'dispatching');assert.equal(db.prepare("SELECT state FROM publication_queue WHERE job_id='running'").get().state,'running');assert.equal(db.prepare("SELECT status FROM jobs WHERE id='legacy'").get().status,'unknown');
 // Claimed queued creation must be inspected and never dispatched to a live mall.
 db.prepare("UPDATE job_snapshots SET claimed=1 WHERE job_id='waiting'").run();
 child=spawn(process.execPath,['worker.mjs'],{cwd:new URL('../',import.meta.url).pathname,env:{...process.env},stdio:['ignore','ignore','pipe']});let error='';child.stderr.on('data',chunk=>{error=(error+chunk).slice(-4000);});
 for(let n=0;n<150;n++){if(db.prepare('SELECT heartbeat FROM publication_worker').get().heartbeat>Date.now()-30000&&db.prepare("SELECT state FROM publication_queue WHERE job_id='waiting'").get().state==='interrupted')break;if(child.exitCode!==null)throw Error(error);await new Promise(r=>setTimeout(r,20));}
 assert.equal(db.prepare("SELECT status FROM jobs WHERE id='waiting'").get().status,'unknown');assert.equal(db.prepare("SELECT claimed FROM job_snapshots WHERE job_id='waiting'").get().claimed,1);assert.equal(db.prepare("SELECT state FROM publication_queue WHERE job_id='running'").get().state,'interrupted');
 await execute(process.execPath,['worker.mjs','--check'],{cwd:new URL('../',import.meta.url).pathname,env:{...process.env}});
 const exit=once(child,'exit');child.kill('SIGTERM');assert.equal((await exit)[0],0);assert.equal(db.prepare('SELECT owner FROM publication_worker').get().owner,'');
 }finally{if(child&&child.exitCode===null){const exit=once(child,'exit');child.kill('SIGKILL');await exit;}closeStore?.();db.close();await rm(dir,{recursive:true,force:true});}
});

test('暂停模式不打开数据库、不领取任务，健康检查可用',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ops-worker-paused-'));
 const options={cwd:new URL('../',import.meta.url).pathname,env:{...process.env,DATA_DIR:dir,DEMO_MODE:'false',OPS_WORKER_PAUSED:'true'}};
 let child;
 try{
  await execute(process.execPath,['worker.mjs','--check'],options);
  child=spawn(process.execPath,['worker.mjs'],{...options,stdio:'ignore'});
  await new Promise(r=>setTimeout(r,150));assert.equal(child.exitCode,null);
  const {readdir}=await import('node:fs/promises');assert.deepEqual(await readdir(dir),[]);
 }finally{if(child&&child.exitCode===null){const exit=once(child,'exit');child.kill('SIGTERM');await exit;}await rm(dir,{recursive:true,force:true});}
});
