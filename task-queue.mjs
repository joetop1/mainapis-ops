import {randomUUID} from 'node:crypto';
export const WORKER_LEASE_MS=120000;
export function taskQueue(db,{clock=()=>Date.now()}={}){
 db.exec(`CREATE TABLE IF NOT EXISTS publication_queue(id INTEGER PRIMARY KEY AUTOINCREMENT,job_id TEXT NOT NULL REFERENCES jobs(id),action TEXT NOT NULL CHECK(action IN ('publish_draft','verify_draft')),nonce TEXT NOT NULL DEFAULT '',verification TEXT NOT NULL DEFAULT '{}',state TEXT NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','running','done','interrupted')),worker TEXT NOT NULL DEFAULT '',created INTEGER NOT NULL,updated INTEGER NOT NULL,UNIQUE(job_id,action,nonce));
 CREATE INDEX IF NOT EXISTS publication_queue_pending ON publication_queue(state,id);
 CREATE TABLE IF NOT EXISTS publication_worker(id INTEGER PRIMARY KEY CHECK(id=1),owner TEXT NOT NULL DEFAULT '',heartbeat INTEGER NOT NULL DEFAULT 0);
 INSERT OR IGNORE INTO publication_worker(id) VALUES(1);`);
 const interrupted=(row,message)=>{
  const job=db.prepare('SELECT status FROM jobs WHERE id=?').get(row.job_id),snap=db.prepare('SELECT verification_nonce FROM job_snapshots WHERE job_id=?').get(row.job_id);
  if(job&&!['succeeded','failed'].includes(job.status)&&(row.action==='publish_draft'||snap?.verification_nonce===row.nonce))db.prepare('UPDATE jobs SET status=?,message=?,updated=? WHERE id=?').run(row.action==='verify_draft'?'awaiting_review':'unknown',message,new Date(clock()).toISOString(),row.job_id);
 };
 return {
  enqueue(jobId,action='publish_draft',verification={}){
   if(!['publish_draft','verify_draft'].includes(action))throw Error('后台任务类型无效');
   const job=db.prepare('SELECT status,remote_id FROM jobs WHERE id=?').get(jobId),snap=db.prepare('SELECT * FROM job_snapshots WHERE job_id=?').get(jobId);
   if(!job||!snap||['succeeded','failed'].includes(job.status))throw Error('任务已结束或缺少快照，不能入队');
   if(action==='publish_draft'&&(snap.claimed||snap.candidate_id||snap.verification_nonce||job.remote_id||job.status!=='dispatching'))throw Error('任务不可重新创建，请先核对商城');
   const nonce=action==='verify_draft'?verification.verification_nonce||'':'';
   if(action==='verify_draft'&&(!nonce||nonce!==snap.verification_nonce||verification.remote_id!==snap.candidate_id||job.status!=='verifying'))throw Error('核对请求已变化');
   if(db.prepare("SELECT 1 FROM publication_queue WHERE job_id=? AND state='running'").get(jobId))throw Object.assign(Error('此任务仍由Worker执行，请稍后核对'),{httpStatus:409});
   if(action==='verify_draft')db.prepare("UPDATE publication_queue SET state='done',updated=? WHERE job_id=? AND state='queued' AND action='verify_draft' AND nonce<>?").run(clock(),jobId,nonce);
   const now=clock(),r=db.prepare(`INSERT INTO publication_queue(job_id,action,nonce,verification,created,updated) VALUES(?,?,?,?,?,?) ON CONFLICT(job_id,action,nonce) DO UPDATE SET verification=excluded.verification,state='queued',worker='',updated=excluded.updated WHERE publication_queue.state<>'running'`).run(jobId,action,nonce,JSON.stringify(verification),now,now);if(!r.changes)throw Error('任务正在执行，未重复入队');
  },
  heartbeat(owner){return db.prepare('UPDATE publication_worker SET heartbeat=? WHERE id=1 AND owner=?').run(clock(),owner).changes===1;},
  release(owner){db.prepare("UPDATE publication_worker SET owner='',heartbeat=0 WHERE id=1 AND owner=?").run(owner);},
  take(owner){
   db.exec('BEGIN IMMEDIATE');try{
    const acquired=db.prepare("UPDATE publication_worker SET owner=?,heartbeat=? WHERE id=1 AND (owner='' OR owner=? OR heartbeat<?)").run(owner,clock(),owner,clock()-WORKER_LEASE_MS).changes;
    if(!acquired){db.exec('COMMIT');return null;}
    for(const row of db.prepare("SELECT * FROM publication_queue WHERE state='running' AND worker<>?").all(owner)){interrupted(row,'Worker执行中断，请先核对商城或原工作流记录；未自动重发创建。');db.prepare("UPDATE publication_queue SET state='interrupted',updated=? WHERE id=?").run(clock(),row.id);}
    let result=null;
    for(let n=0;n<25;n++){
     const row=db.prepare("SELECT * FROM publication_queue WHERE state='queued' ORDER BY id LIMIT 1").get();if(!row)break;
     const job=db.prepare('SELECT * FROM jobs WHERE id=?').get(row.job_id),snapshot=db.prepare('SELECT * FROM job_snapshots WHERE job_id=?').get(row.job_id);
     const terminal=job&&['succeeded','failed'].includes(job.status),eligible=job&&snapshot&&!terminal&&(row.action==='publish_draft'?job.status==='dispatching'&&!snapshot.claimed&&!snapshot.candidate_id&&!snapshot.verification_nonce&&!job.remote_id:job.status==='verifying'&&snapshot.verification_nonce===row.nonce);
     if(!eligible){if(!terminal&&row.action==='publish_draft'&&snapshot?.claimed)interrupted(row,'创建操作已领取，请核对商城商品；Worker未再次创建。');db.prepare("UPDATE publication_queue SET state=?,updated=? WHERE id=?").run(terminal?'done':'interrupted',clock(),row.id);continue;}
     db.prepare("UPDATE publication_queue SET state='running',worker=?,updated=? WHERE id=? AND state='queued'").run(owner,clock(),row.id);result={...row,worker:owner,job,snapshot};break;
    }
    db.exec('COMMIT');return result;
   }catch(e){db.exec('ROLLBACK');throw e;}
  },
  finish(row,error=false){
   const current=db.prepare("SELECT 1 FROM publication_queue WHERE id=? AND worker=? AND state='running'").get(row.id,row.worker);if(!current)return;
   if(error)interrupted(row,'Worker执行异常，结果需人工核对；未自动重发创建。');
   db.prepare('UPDATE publication_queue SET state=?,updated=? WHERE id=? AND worker=?').run(error?'interrupted':'done',clock(),row.id,row.worker);
  }
 };
}
export function queueStatus(db,enabled,{clock=()=>Date.now()}={}){
 if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='publication_worker'").get())return {enabled,online:false,lastHeartbeat:null,queued:0,running:0,interrupted:0};
 const worker=db.prepare('SELECT heartbeat,owner FROM publication_worker WHERE id=1').get();
 const counts=db.prepare(`SELECT COALESCE(SUM(q.state='queued'),0) queued,COALESCE(SUM(q.state='running'),0) running,COALESCE(COUNT(DISTINCT CASE WHEN q.state='interrupted' AND j.status IN ('unknown','awaiting_review') THEN q.job_id END),0) interrupted FROM publication_queue q JOIN jobs j ON j.id=q.job_id`).get();
 return {enabled,online:!!worker?.owner&&worker.heartbeat>clock()-30000,lastHeartbeat:worker?.heartbeat?new Date(worker.heartbeat).toISOString():null,...counts};
}
export function queueWorker({queue,dispatch,onError=()=>{}}){
 const owner=randomUUID();let active=null,stopping=false;
 const tick=async()=>{if(active||stopping)return;active=(async()=>{let row;try{row=queue.take(owner);if(!row)return;await dispatch(row.job,JSON.parse(row.snapshot.product),row.action,JSON.parse(row.verification));queue.finish(row);}catch(e){if(row)queue.finish(row,true);onError(e);}})();try{await active;}finally{active=null;}};
 return {tick,heartbeat:()=>queue.heartbeat(owner),async stop(){stopping=true;await active;queue.release(owner);}};
}
