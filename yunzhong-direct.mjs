import {mallOrigin,LEGACY_YUNZHONG_ORIGIN} from './mall-address.mjs';
import {createYunzhongBridgeRunner} from './yunzhong-bridge-runner.mjs';
import {randomUUID} from 'node:crypto';
import {createYunzhongClient,loadYunzhongCategories,findYunzhongGoods} from './yunzhong-client.mjs';
import {buildYunzhongProduct,verifyYunzhongOfficialProduct} from './yunzhong-product.mjs';
export function createYunzhongRunner({db,getConnection,audit,fetcher=fetch}){
 const bridgeRunner=createYunzhongBridgeRunner({db,getConnection,audit,fetcher});
 const update=(job,status,message,remote='')=>{db.prepare('UPDATE jobs SET status=?,message=?,remote_id=?,updated=? WHERE id=?').run(status,message.slice(0,500),remote,new Date().toISOString(),job.id);audit(job.owner,'job.'+status,job.id);};
 async function verify(job,client,lease,nonce){
  const actual=await findYunzhongGoods(client,{marker:lease.marker,title:lease.product.title});
  if(!actual){if(db.prepare('SELECT verification_nonce FROM job_snapshots WHERE job_id=?').get(job.id)?.verification_nonce===nonce)update(job,'awaiting_review','尚未找到对应下架商品，请核对任务货号',lease.candidate_id);return;}
  const options=await client('goods/getOption',{goods_id:lease.candidate_id});
  if(db.prepare('SELECT verification_nonce FROM job_snapshots WHERE job_id=?').get(job.id)?.verification_nonce!==nonce)return;
  const result=verifyYunzhongOfficialProduct(actual,options.data,lease,lease.product.yunzhong);update(job,result.status,result.message,result.remote_id||'');
 }
 return async(job,action='publish_draft')=>{
  const plan=db.prepare('SELECT product FROM job_snapshots WHERE job_id=?').get(job.id);
  if(plan&&JSON.parse(plan.product).yunzhong?.mode==='bridge')return bridgeRunner(job,action);
  let writing=false;const verifying=action==='verify_draft';
  try{
   const connection=getConnection(job.owner);if(connection?.mode!=='official'||!connection?.publishingReady)throw Error('请先测试并保存芸众官方API连接');
   const client=createYunzhongClient(connection,fetcher),snapshot=db.prepare('SELECT * FROM job_snapshots WHERE job_id=?').get(job.id);if(!snapshot)throw Error('缺少任务快照');
   const lease={product:JSON.parse(snapshot.product),marker:'OPS-'+job.id.replaceAll('-',''),candidate_id:snapshot.candidate_id};
   if(mallOrigin(lease.product.yunzhong?.origin||LEGACY_YUNZHONG_ORIGIN)!==mallOrigin(connection.url||LEGACY_YUNZHONG_ORIGIN))throw Error('商城地址与任务快照不一致，请使用原商城连接核对');
   if(verifying){await verify(job,client,lease,snapshot.verification_nonce);return;}
   if(snapshot.claimed)throw Error('创建操作已领取，不得重复创建');
   const expected=buildYunzhongProduct(lease,lease.product.yunzhong),catalog=await loadYunzhongCategories(client);
   const category=catalog.categories.find(c=>c.id===lease.product.category_id);
   if(!category||JSON.stringify(category.ids)!==JSON.stringify(lease.product.yunzhong.categoryIds))throw Error('分类路径已变化，请核对任务');
   const existing=await findYunzhongGoods(client,{marker:lease.marker,title:lease.product.title});
   const claim=db.prepare('UPDATE job_snapshots SET claimed=1 WHERE job_id=? AND claimed=0').run(job.id);if(!claim.changes)return;
   writing=true;audit(job.owner,'job.claim_create',job.id);update(job,'accepted','正在提交芸众官方API下架商品');
   let candidate;
   if(existing)candidate=String(existing.id);
   else{
    const receipt=await client('goods/create',expected.base);candidate=String(receipt.data?.goods_id||'');
    if(!/^[1-9][0-9]{0,14}$/.test(candidate))throw Error('未取得有效商城商品ID');
    db.prepare('UPDATE job_snapshots SET candidate_id=? WHERE job_id=?').run(candidate,job.id);
    update(job,'accepted','基础商品已创建，正在保存SKU；禁止重复创建',candidate);
    await client('goods/createOption',{goods_id:Number(candidate),...expected.options});
   }
   if(!/^[1-9][0-9]{0,14}$/.test(candidate))throw Error('未取得有效商城商品ID');
   const nonce=randomUUID();db.prepare('UPDATE job_snapshots SET candidate_id=?,verification_nonce=? WHERE job_id=?').run(candidate,nonce,job.id);
   update(job,'verifying','正在读取官方API可提供的商品字段核对',candidate);
   await verify(job,client,{...lease,candidate_id:candidate},nonce);
  }catch(error){
   if(db.prepare('SELECT status FROM jobs WHERE id=?').get(job.id)?.status==='succeeded')return;
   const snapshot=db.prepare('SELECT claimed,candidate_id FROM job_snapshots WHERE job_id=?').get(job.id);
   if(snapshot?.claimed&&!writing&&!verifying)return;
   update(job,verifying?'awaiting_review':'unknown',(writing?'创建或SKU请求可能已执行，请先核对商城，禁止重复创建。':verifying?'核对未完成：':'创建前检查未通过，未发送新增请求：')+error.message,snapshot?.candidate_id||'');
  }
 };
}
