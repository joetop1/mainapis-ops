// Execution 30 was rejected by n8n JSON-body parsing before its HTTP request.
// Only for the exact task independently checked empty by the operator.
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {openStore,uid,now} from './core.mjs';
export const JSON_BODY_JOB='968140ec-5c8d-4672-a039-27cdcad7fa51';
export function recoverKnownJsonBodyFailure(db,{merchantEmptyConfirmed=false,execution30Confirmed=false}={}){
 if(!merchantEmptyConfirmed||!execution30Confirmed)throw Error('需确认执行30在发送前因 JSON Body 无效失败，且按任务编码核对商城无商品');
 db.exec('BEGIN IMMEDIATE');
 try{
  const j=db.prepare('SELECT * FROM jobs WHERE id=?').get(JSON_BODY_JOB),s=db.prepare('SELECT * FROM job_snapshots WHERE job_id=?').get(JSON_BODY_JOB);
  const used=db.prepare("SELECT id FROM audit WHERE object_id=? AND action='job.recover_execution30_json_body'").get(JSON_BODY_JOB);
  const claims=db.prepare("SELECT COUNT(*) n FROM audit WHERE object_id=? AND action='job.claim_create'").get(JSON_BODY_JOB).n;
  if(used||!j||j.target!=='crmeb-store'||j.revision!==2||!['accepted','unknown'].includes(j.status)||j.remote_id||s?.claimed!==1||s.candidate_id||s.verification_nonce||claims!==1)throw Error('任务不符合执行30的一次创建前失败，未修改数据');
  const p=JSON.parse(s.product);
  if(p.catalog_target!=='crmeb-store'||!String(p.title).includes('TENGA LOTION'))throw Error('商品快照不匹配，未修改数据');
  const t=now();
  db.prepare('UPDATE job_snapshots SET claimed=0 WHERE job_id=?').run(JSON_BODY_JOB);
  db.prepare("UPDATE jobs SET status='unknown',message=?,updated=? WHERE id=?").run('已确认执行30因 JSON Body 无效未发送商城请求，且商城无记录；修复后可重发原任务',t,JSON_BODY_JOB);
  db.prepare('INSERT INTO audit VALUES(?,?,?,?,?)').run(uid(),j.owner,'job.recover_execution30_json_body',JSON_BODY_JOB,t);
  db.exec('COMMIT');return {job_id:JSON_BODY_JOB,status:'unknown',message:'已恢复原任务，请从 OPS 点击重发未领取任务；商品快照、价格和库存未修改。'};
 }catch(e){db.exec('ROLLBACK');throw e;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const db=openStore(join(process.env.DATA_DIR||'./data','ops.sqlite'));
 try{console.log(JSON.stringify(recoverKnownJsonBodyFailure(db,{merchantEmptyConfirmed:process.argv.includes('--merchant-empty-confirmed'),execution30Confirmed:process.argv.includes('--execution-30-confirmed')}),null,2));}catch(e){console.error(e.message);process.exitCode=1;}finally{db.close();}
}
