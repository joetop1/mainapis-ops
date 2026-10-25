import {randomUUID} from 'node:crypto';
import {createTigshopClient,tigshopShipping} from './tigshop-client.mjs';
import {buildTigshopProduct,verifyTigshopProduct} from './tigshop.mjs';

export function createTigshopRunner({db,getConnection,audit,fetcher=fetch}){
 const stamp=()=>new Date().toISOString();
 const update=(job,status,message,remoteId='')=>{
  db.prepare('UPDATE jobs SET status=?,message=?,remote_id=?,updated=? WHERE id=?').run(status,message.slice(0,500),remoteId,stamp(),job.id);
  audit(job.owner,'job.'+status,job.id);
 };
 const leaseFor=job=>{
  const s=db.prepare('SELECT * FROM job_snapshots WHERE job_id=?').get(job.id);
  if(!s)throw Error('任务缺少可信快照');
  return {snapshot:s,lease:{product:JSON.parse(s.product),marker:'OPS-'+job.id.replaceAll('-',''),candidate_id:s.candidate_id}};
 };
 async function verify(job,client,lease,nonce){
  const result=verifyTigshopProduct(await client('product/detail?id='+lease.candidate_id),lease,lease.product.tigshop.fx,lease.product.tigshop.shipping);
  const s=db.prepare('SELECT verification_nonce FROM job_snapshots WHERE job_id=?').get(job.id);
  if(s?.verification_nonce!==nonce)return;
  update(job,result.status,result.message+(result.status==='succeeded'?'；汇率日期 '+lease.product.tigshop.fx.rateDate:''),result.remote_id||'');
 }
 return async(job,action='publish_draft')=>{
  let writing=false,verifying=action==='verify_draft';
  try{
   const connection=getConnection(job.owner);if(!connection?.token)throw Error('请先在连接设置填写 Tigshop API Token');
   const client=createTigshopClient(connection.token,fetcher);
   const {snapshot,lease}=leaseFor(job);
   if(verifying){await verify(job,client,lease,snapshot.verification_nonce);return;}
   if(snapshot.claimed)throw Error('此任务已领取创建操作，请核对商品 ID');
   const templates=await tigshopShipping(client);
   if(!templates.some(t=>t.id===lease.product.tigshop?.shipping?.templateId))throw Error('任务中使用的运费模板已不可用，请核对连接设置');
   const payload=buildTigshopProduct(lease,lease.product.tigshop?.fx,lease.product.tigshop?.shipping);
   // Search before claiming to detect a previously saved item without another POST.
   const list=await client('product/list?page=1&size=100&keyword='+lease.marker);
   if(!Array.isArray(list.data?.records))throw Error('Tigshop 商品列表格式无效');
   const matches=list.data.records.filter(p=>p.productSn===lease.marker&&p.shopId===0);
   // Atomic guard is shared with the old n8n workflow and concurrent retries.
   const claimed=db.prepare('UPDATE job_snapshots SET claimed=1 WHERE job_id=? AND claimed=0').run(job.id);
   if(!claimed.changes)return;
   writing=true;audit(job.owner,'job.claim_create',job.id);
   update(job,'accepted','正在提交 Tigshop 自营下架商品');
   if(matches.length>0){update(job,'awaiting_review','商城已有同任务货号记录，未重复创建；请填写商品 ID 核对');return;}
   await client('product/create',payload);
   update(job,'awaiting_review','Tigshop 已返回成功，正在查找任务货号核对');
   const after=await client('product/list?page=1&size=100&keyword='+lease.marker);
   const found=after.data?.records?.filter(p=>p.productSn===lease.marker&&p.shopId===0)||[];
   if(found.length!==1){update(job,'awaiting_review','Tigshop 已返回成功，请在商城按任务货号查找商品，填写 ID 核对');return;}
   const candidate=String(found[0].productId);
   if(!/^[1-9][0-9]{0,14}$/.test(candidate))throw Error('商城未返回有效商品 ID，请人工核对');
   const nonce=randomUUID();
   db.prepare('UPDATE job_snapshots SET candidate_id=?,verification_nonce=? WHERE job_id=?').run(candidate,nonce,job.id);
   update(job,'verifying','正在核对 Tigshop 实际入库结果');
   await verify(job,client,{...lease,candidate_id:candidate},nonce);
  }catch(e){
   const latest=db.prepare('SELECT status FROM jobs WHERE id=?').get(job.id);
   if(latest?.status==='succeeded')return;
   const claimed=db.prepare('SELECT claimed FROM job_snapshots WHERE job_id=?').get(job.id)?.claimed;
   // Concurrent losing retries must never overwrite the active creation result.
   if(claimed&&!writing&&!verifying)return;
   update(job,verifying?'awaiting_review':'unknown',(writing?'创建请求可能已执行，请先核对商城，禁止重复创建。':verifying?'核对未完成：':'创建前检查失败，未请求新增接口：')+e.message);
  }
 };
}
