// One-off: operator observed SQL 1406 slider_image, fixed the request carousel,
// and queried the target merchant by this marker; the result was [].
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {openStore,uid,now} from './core.mjs';
import {REJECTED_JOB} from './recover-store-auth.mjs';
export function recoverKnownCarouselRejection(db,{merchantEmptyConfirmed=false}={}){
 if(!merchantEmptyConfirmed)throw Error('必须先在多门店按该任务编码确认没有商品记录');
 db.exec('BEGIN IMMEDIATE');
 try{
  const job=db.prepare('SELECT * FROM jobs WHERE id=?').get(REJECTED_JOB),snap=db.prepare('SELECT * FROM job_snapshots WHERE job_id=?').get(REJECTED_JOB);
  const previous=db.prepare('SELECT created FROM audit WHERE object_id=? AND action=?').get(REJECTED_JOB,'job.recover_known_presale_rejection');
  const used=db.prepare('SELECT id FROM audit WHERE object_id=? AND action=?').get(REJECTED_JOB,'job.recover_known_carousel_rejection');
  if(used)throw Error('本次轮播字段失败已恢复过，禁止重复解除创建保护');
  if(!job||job.target!=='crmeb-store'||job.status!=='unknown'||job.remote_id||!snap?.claimed||snap.candidate_id||snap.verification_nonce||!previous||job.message!=='已确认执行13因 presale_status 缺失在保存事务前失败；商城修复后可重发同一任务')throw Error('记录不符合本次已确认的轮播字段失败，未修改任何数据');
  const attempts=db.prepare('SELECT COUNT(*) n FROM audit WHERE object_id=? AND action=? AND created>?').get(REJECTED_JOB,'job.claim_create',previous.created).n;
  if(attempts!==1)throw Error('后续领取次数不符合已确认的一次失败，需重新核对');
  const p=JSON.parse(snap.product);
  if(p.catalog_target!=='crmeb-store'||p.source_url!=='https://detail.1688.com/offer/755369163302.html')throw Error('商品来源不匹配');
  db.prepare('UPDATE job_snapshots SET claimed=0 WHERE job_id=?').run(REJECTED_JOB);
  db.prepare('UPDATE jobs SET message=?,updated=? WHERE id=?').run('已核对本次轮播图字段超长失败且商城无对应商品；修复轮播后可重发原任务',now(),REJECTED_JOB);
  db.prepare('INSERT INTO audit VALUES(?,?,?,?,?)').run(uid(),job.owner,'job.recover_known_carousel_rejection',REJECTED_JOB,now());
  db.exec('COMMIT');return {job_id:REJECTED_JOB,status:'unknown',message:'已恢复这一次已核对的轮播字段失败。没有请求商城，没有修改原始商品、SKU 或价格库存。请确认工作流已 Publish，再从 OPS 重发同一任务。'};
 }catch(e){db.exec('ROLLBACK');throw e;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const db=openStore(join(process.env.DATA_DIR||'./data','ops.sqlite'));
 try{process.stdout.write(JSON.stringify(recoverKnownCarouselRejection(db,{merchantEmptyConfirmed:process.argv.includes('--merchant-empty-confirmed')}),null,2)+'\n');}catch(e){process.stderr.write(e.message+'\n');process.exitCode=1;}finally{db.close();}
}
