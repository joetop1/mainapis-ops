import {now} from './core.mjs';
import {createYunzhongBridge} from './yunzhong-bridge.mjs';
// This operation only restores the original frozen task after a signed, full marker absence check.
export async function recoverYunzhongUncreated({db,owner,id,getConnection,fetcher=fetch}){
 function inspect(){
  const job=db.prepare('SELECT * FROM jobs WHERE id=? AND owner=?').get(id,owner),snapshot=db.prepare('SELECT * FROM job_snapshots WHERE job_id=?').get(id);
  if(!job||job.target!=='yunzhong'||job.status!=='unknown'||job.remote_id||!snapshot?.claimed||snapshot.candidate_id||snapshot.verification_nonce||!job.message.includes('兼容扩展返回 HTTP 400'))throw Error('任务状态不符合已拒绝创建的恢复条件，未修改');
  const plan=JSON.parse(snapshot.product);
  if(plan.yunzhong?.mode!=='bridge'||!db.prepare("SELECT 1 FROM job_transports WHERE job_id=? AND mode='direct'").get(id))throw Error('不是独立入口直连任务，未修改');
  return {job,snapshot};
 }
 const original=inspect(),connection=getConnection(owner);
 if(connection?.mode!=='bridge'||!connection.publishingReady)throw Error('请先测试并保存独立入口连接');
 const client=createYunzhongBridge(connection,fetcher),capabilities=await client('capabilities');
 if(capabilities.contract!=='mainapis-yunzhong-2'||!capabilities.features?.includes('safe_absence_check'))throw Error('请先更新商城独立入口，再核对未入库任务');
 const marker='OPS-'+id.replaceAll('-',''),proof=await client('check_absent',{marker});
 if(proof.marker!==marker||proof.absent!==true||proof.goods_count!==0||proof.receipt_count!==0)throw Error('商城没有确认商品和回执均不存在，未解除领取锁');
 const latestConnection=getConnection(owner);
 if(latestConnection?.appid!==connection.appid||latestConnection?.appsecret!==connection.appsecret||latestConnection?.mode!=='bridge'||!latestConnection?.publishingReady)throw Error('核对期间连接发生变化，请重新核对');
 db.exec('BEGIN IMMEDIATE');
 try{
  const current=inspect();if(current.job.updated!==original.job.updated||current.snapshot.product!==original.snapshot.product)throw Error('核对期间任务发生变化，未恢复');
  const released=db.prepare('UPDATE job_snapshots SET claimed=0 WHERE job_id=? AND claimed=1').run(id);if(released.changes!==1)throw Error('任务领取状态已变化');
  db.prepare("UPDATE jobs SET status='accepted',message=?,updated=? WHERE id=? AND owner=?").run('已在线核对商品和回执均不存在；原任务已恢复，可重发同一任务编码。未创建商品。',now(),id,owner);
  db.exec('COMMIT');
 }catch(error){db.exec('ROLLBACK');throw error;}
 return {ok:true,id,message:'已核对未入库并恢复原任务，请点击“重发未领取任务”。本次没有创建商品。'};
}
