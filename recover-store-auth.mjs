// One-off recovery for the task whose captured response proves AuthTokenMiddleware
// rejected the request before Product::productSave. Never a general unlock command.
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {openStore,uid,now} from './core.mjs';
export const REJECTED_JOB='1bc58a43-d560-43be-bdbb-aed14c025f7a';
export function recoverKnownAuthorizationRejection(db){
 db.exec('BEGIN IMMEDIATE');
 try{
  const job=db.prepare('SELECT * FROM jobs WHERE id=?').get(REJECTED_JOB);
  const snapshot=db.prepare('SELECT * FROM job_snapshots WHERE job_id=?').get(REJECTED_JOB);
  if(!job||job.target!=='crmeb-store'||job.status!=='unknown'||job.remote_id||!snapshot?.claimed||snapshot.candidate_id||snapshot.verification_nonce||!job.message.startsWith('官方接口未返回明确成功'))throw Error('该记录不符合已确认的鉴权拒绝状态，未修改任何记录');
  if(db.prepare('SELECT id FROM audit WHERE action=? AND object_id=?').get('job.recover_known_auth_rejection',REJECTED_JOB))throw Error('此任务已恢复过一次，禁止再次解除创建保护');
  const product=JSON.parse(snapshot.product);
  if(product.catalog_target!=='crmeb-store'||product.source_url!=='https://detail.1688.com/offer/755369163302.html')throw Error('任务商品来源不匹配');
  db.prepare('UPDATE job_snapshots SET claimed=0 WHERE job_id=?').run(REJECTED_JOB);
  db.prepare('UPDATE jobs SET message=?,updated=? WHERE id=?').run('已确认本次请求在多门店鉴权中间件被拒绝；修正请求头后可重发同一任务',now(),REJECTED_JOB);
  db.prepare('INSERT INTO audit VALUES(?,?,?,?,?)').run(uid(),job.owner,'job.recover_known_auth_rejection',REJECTED_JOB,now());
  db.exec('COMMIT');return {job_id:REJECTED_JOB,status:'unknown',message:'只恢复了已确认鉴权失败的这一条任务。修正并发布工作流后，在 OPS 点击重发未领取任务。未请求商城，未创建商品。'};
 }catch(e){db.exec('ROLLBACK');throw e;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const db=openStore(join(process.env.DATA_DIR||'./data','ops.sqlite'));
 try{process.stdout.write(JSON.stringify(recoverKnownAuthorizationRejection(db),null,2)+'\n');}catch(e){process.stderr.write(e.message+'\n');process.exitCode=1;}finally{db.close();}
}
