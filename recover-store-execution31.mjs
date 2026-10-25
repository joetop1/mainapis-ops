// One-off operator recovery after execution 31's 502, settled empty merchant
// query and server restart. A 502 alone never proves that a write did not commit.
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {openStore,uid,now} from './core.mjs';
import {JSON_BODY_JOB as JOB} from './recover-store-json-body.mjs';
export function recoverExecution31(db,{merchantEmptyAfterRestart=false,execution31Finished=false}={}){
 if(!merchantEmptyAfterRestart||!execution31Finished)throw Error('必须确认执行31已结束，且商城重启后按任务编码查询无商品');
 db.exec('BEGIN IMMEDIATE');
 try{
  const j=db.prepare('SELECT * FROM jobs WHERE id=?').get(JOB),s=db.prepare('SELECT * FROM job_snapshots WHERE job_id=?').get(JOB);
  const previous=db.prepare("SELECT created FROM audit WHERE object_id=? AND action='job.recover_execution30_json_body'").all(JOB);
  const claims=db.prepare("SELECT created FROM audit WHERE object_id=? AND action='job.claim_create' ORDER BY created").all(JOB);
  const used=db.prepare("SELECT id FROM audit WHERE object_id=? AND action='job.recover_execution31_after_empty_check'").get(JOB);
  if(used||previous.length!==1||claims.length!==2||claims[1].created<=previous[0].created||!j||j.target!=='crmeb-store'||j.revision!==2||!['accepted','unknown'].includes(j.status)||j.remote_id||s?.claimed!==1||s.candidate_id||s.verification_nonce)throw Error('记录不匹配已核对的执行31，未解除保护');
  const p=JSON.parse(s.product);
  if(p.catalog_target!=='crmeb-store'||p.source_url!=='https://detail.1688.com/offer/1084174064750.html'||!String(p.title).startsWith('TENGA LOTION'))throw Error('商品快照不匹配，未修改数据');
  const t=now();
  db.prepare('UPDATE job_snapshots SET claimed=0 WHERE job_id=?').run(JOB);
  db.prepare("UPDATE jobs SET status='unknown',message=?,updated=? WHERE id=?").run('执行31返回502；操作员已于商城重启后确认无对应商品，允许原任务重发一次',t,JOB);
  db.prepare('INSERT INTO audit VALUES(?,?,?,?,?)').run(uid(),j.owner,'job.recover_execution31_after_empty_check',JOB,t);
  db.exec('COMMIT');return {job_id:JOB,status:'unknown',message:'已恢复原任务。请在 OPS 点击一次重发未领取任务；脚本未请求商城，未修改商品快照、价格或库存。'};
 }catch(e){db.exec('ROLLBACK');throw e;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const db=openStore(join(process.env.DATA_DIR||'./data','ops.sqlite'));
 try{console.log(JSON.stringify(recoverExecution31(db,{merchantEmptyAfterRestart:process.argv.includes('--merchant-empty-after-restart'),execution31Finished:process.argv.includes('--execution-31-finished')}),null,2));}catch(e){console.error(e.message);process.exitCode=1;}finally{db.close();}
}
