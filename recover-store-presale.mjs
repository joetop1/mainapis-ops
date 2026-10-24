// Specific recovery for execution 13: presale_status at line 1022 raised before
// the save transaction at line 1221 and insert at line 1263 (operator supplied source).
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {openStore,uid,now} from './core.mjs';
import {REJECTED_JOB} from './recover-store-auth.mjs';
export const PRESALE_CLAIM_TIME='2026-10-24T14:52:02.259Z';
export function recoverKnownPresaleRejection(db){
 db.exec('BEGIN IMMEDIATE');
 try{
  const job=db.prepare('SELECT * FROM jobs WHERE id=?').get(REJECTED_JOB);
  const snapshot=db.prepare('SELECT * FROM job_snapshots WHERE job_id=?').get(REJECTED_JOB);
  const lastClaim=db.prepare('SELECT created FROM audit WHERE object_id=? AND action=? ORDER BY created DESC LIMIT 1').get(REJECTED_JOB,'job.claim_create');
  const authRecovery=db.prepare('SELECT id FROM audit WHERE object_id=? AND action=?').get(REJECTED_JOB,'job.recover_known_auth_rejection');
  const already=db.prepare('SELECT id FROM audit WHERE object_id=? AND action=?').get(REJECTED_JOB,'job.recover_known_presale_rejection');
  if(already)throw Error('这次缺字段失败已恢复过，禁止重复恢复');
  if(!job||job.target!=='crmeb-store'||job.status!=='unknown'||job.remote_id||!snapshot?.claimed||snapshot.candidate_id||snapshot.verification_nonce||!authRecovery||lastClaim?.created!==PRESALE_CLAIM_TIME||job.message!=='已确认本次请求在多门店鉴权中间件被拒绝；修正请求头后可重发同一任务')throw Error('当前记录不匹配已确认的执行 13，未修改任何数据');
  const p=JSON.parse(snapshot.product);
  if(p.catalog_target!=='crmeb-store'||p.source_url!=='https://detail.1688.com/offer/755369163302.html')throw Error('任务商品来源不匹配');
  db.prepare('UPDATE job_snapshots SET claimed=0 WHERE job_id=?').run(REJECTED_JOB);
  db.prepare('UPDATE jobs SET message=?,updated=? WHERE id=?').run('已确认执行13因 presale_status 缺失在保存事务前失败；商城修复后可重发同一任务',now(),REJECTED_JOB);
  db.prepare('INSERT INTO audit VALUES(?,?,?,?,?)').run(uid(),job.owner,'job.recover_known_presale_rejection',REJECTED_JOB,now());
  db.exec('COMMIT');return {job_id:REJECTED_JOB,status:'unknown',message:'已恢复本次已确认的保存前缺字段失败。商品快照、售价和库存均未修改。请从 OPS 重发未领取任务，不要单独执行新增节点。'};
 }catch(e){db.exec('ROLLBACK');throw e;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const db=openStore(join(process.env.DATA_DIR||'./data','ops.sqlite'));
 try{process.stdout.write(JSON.stringify(recoverKnownPresaleRejection(db),null,2)+'\n');}catch(e){process.stderr.write(e.message+'\n');process.exitCode=1;}finally{db.close();}
}
