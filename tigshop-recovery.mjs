import {uid,now} from './core.mjs';
import {createTigshopClient} from './tigshop-client.mjs';
export async function recoverTigshopZeroStock(db,owner,getConnection){
const id='650b74d9-6d5e-4174-9245-4d45163e3699';
const marker='OPS-'+id.replaceAll('-','');
function inspect(){
 const j=db.prepare('SELECT * FROM jobs WHERE id=?').get(id),s=db.prepare('SELECT * FROM job_snapshots WHERE job_id=?').get(id);
 if(!j||j.target!=='tigshop'||j.status!=='unknown'||j.remote_id||!s?.claimed||s.candidate_id||s.verification_nonce)throw Error('任务状态不符合这次恢复条件，未修改');
 if(j.message!=='创建请求可能已执行，请先核对商城，禁止重复创建。Tigshop：商品总库存必须大于0')throw Error('不是已确认的零库存保存前拒绝，未修改');
 if(!db.prepare("SELECT 1 FROM job_transports WHERE job_id=? AND mode='direct'").get(id))throw Error('不是直连任务');
 if(db.prepare("SELECT 1 FROM audit WHERE object_id=? AND action='job.recover_tigshop_zero_stock'").get(id))throw Error('已恢复过，禁止重复执行');
 const p=JSON.parse(s.product);
 if(!p.skus?.length||p.skus.some(x=>x.stock!==0))throw Error('任务快照并非全部零库存');
 return j;
}
 const job=inspect();if(job.owner!==owner)throw Error('任务不存在');const connection=getConnection(owner);
 const client=createTigshopClient(connection?.token);
 const r=await client('product/list?page=1&size=100&keyword='+marker);
 if(!Array.isArray(r.data?.records)||Number(r.data.total)!==0||r.data.records.length!==0)throw Error('商城未确认任务货号记录为空，未解除领取锁');
 db.exec('BEGIN IMMEDIATE');
 try{inspect();db.prepare('UPDATE job_snapshots SET claimed=0 WHERE job_id=?').run(id);db.prepare("UPDATE jobs SET status='failed',message=?,updated=? WHERE id=?").run('已确认零库存校验在保存前拒绝，且商城查无该任务货号。请编辑实际库存、重新审核后发布新版本。',now(),id);db.prepare('INSERT INTO audit VALUES(?,?,?,?,?)').run(uid(),job.owner,'job.recover_tigshop_zero_stock',id,now());db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
 return {job_id:id,status:'failed',message:'已核对商城无此任务记录并解除本次已确认拒绝的领取锁；未新增商品。请编辑实际库存后重新审核发布。'};
}
