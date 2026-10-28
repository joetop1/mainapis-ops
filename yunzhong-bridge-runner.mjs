import {mallOrigin,LEGACY_YUNZHONG_ORIGIN} from './mall-address.mjs';
import {randomUUID} from 'node:crypto';
import {createYunzhongBridge,yunzhongCatalog} from './yunzhong-bridge.mjs';
import {buildYunzhongProduct,verifyYunzhongProduct} from './yunzhong-product.mjs';
export function createYunzhongBridgeRunner({db,getConnection,audit,fetcher=fetch}){
 const update=(job,status,message,remote='')=>{db.prepare('UPDATE jobs SET status=?,message=?,remote_id=?,updated=? WHERE id=?').run(status,message.slice(0,500),remote,new Date().toISOString(),job.id);audit(job.owner,'job.'+status,job.id);};
 async function verify(job,client,lease,nonce){
  const actual=await client('detail',{marker:lease.marker,goods_id:lease.candidate_id});
  if(db.prepare('SELECT verification_nonce FROM job_snapshots WHERE job_id=?').get(job.id)?.verification_nonce!==nonce)return;
  const result=verifyYunzhongProduct(actual,lease,lease.product.yunzhong);update(job,result.status,result.message,result.remote_id||'');
 }
 return async(job,action='publish_draft')=>{
  let writing=false;const verifying=action==='verify_draft';
  try{
   const connection=getConnection(job.owner,job);if(connection?.mode!=='bridge'||!connection?.publishingReady)throw Error('请先测试并保存芸众兼容扩展连接');
   const client=createYunzhongBridge(connection,fetcher),snapshot=db.prepare('SELECT * FROM job_snapshots WHERE job_id=?').get(job.id);if(!snapshot)throw Error('缺少任务快照');
   const lease={product:JSON.parse(snapshot.product),marker:'OPS-'+job.id.replaceAll('-',''),candidate_id:snapshot.candidate_id};
   if(mallOrigin(lease.product.yunzhong?.origin||LEGACY_YUNZHONG_ORIGIN)!==mallOrigin(connection.url||LEGACY_YUNZHONG_ORIGIN))throw Error('商城地址与任务快照不一致，请使用原商城连接核对');
   if(verifying){await verify(job,client,lease,snapshot.verification_nonce);return;}
   if(snapshot.claimed)throw Error('创建操作已领取，不得重复创建');
   const catalog=yunzhongCatalog(await client('capabilities'));
   const expected=buildYunzhongProduct(lease,{...lease.product.yunzhong,compatibility:true});
   const category=catalog.categories.find(c=>c.id===lease.product.category_id);
   if(!category||JSON.stringify(category.ids)!==JSON.stringify(expected.category_ids)||catalog.categoryLevel!==lease.product.yunzhong.categoryLevel)throw Error('分类路径或层级已变化，请核对任务');
   const existing=await client('lookup',{marker:lease.marker});
   const claim=db.prepare('UPDATE job_snapshots SET claimed=1 WHERE job_id=? AND claimed=0').run(job.id);if(!claim.changes)return;
   writing=true;audit(job.owner,'job.claim_create',job.id);update(job,'accepted','正在提交芸众下架商品');
   let actual;if(existing.found===true)actual=existing.product;else if(existing.found===false)actual=await client('create',{product:expected});else throw Error('任务回执查询格式无效');
   const candidate=String(actual?.id||'');if(!/^[1-9][0-9]{0,14}$/.test(candidate)||actual?.marker!==lease.marker)throw Error('未取得匹配任务的商品ID');
   const nonce=randomUUID();db.prepare('UPDATE job_snapshots SET candidate_id=?,verification_nonce=? WHERE job_id=?').run(candidate,nonce,job.id);
   update(job,'verifying','芸众商品已保存，正在读取完整详情核对',candidate);
   await verify(job,client,{...lease,candidate_id:candidate},nonce);
  }catch(error){
   if(db.prepare('SELECT status FROM jobs WHERE id=?').get(job.id)?.status==='succeeded')return;
   const snapshot=db.prepare('SELECT claimed,candidate_id FROM job_snapshots WHERE job_id=?').get(job.id);const claimed=snapshot?.claimed;
   if(claimed&&!writing&&!verifying)return;
   update(job,verifying?'awaiting_review':'unknown',(writing?'创建可能已执行，请先核对任务货号，禁止重复创建。':verifying?'核对未完成：':'创建前检查未通过，未发送新增请求：')+error.message,snapshot?.candidate_id||'');
  }
 };
}
