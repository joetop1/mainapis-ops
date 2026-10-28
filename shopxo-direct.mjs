import {createShopxoClient} from './shopxo-client.mjs';
import {buildShopxoProduct,verifyShopxoProduct} from './shopxo-product.mjs';
import {mallOrigin} from './mall-address.mjs';
export function createShopxoRunner({db,getConnection,audit,fetcher=fetch}){
 const update=(job,status,message,remote='')=>{db.prepare('UPDATE jobs SET status=?,message=?,remote_id=?,updated=? WHERE id=?').run(status,message.slice(0,500),remote,new Date().toISOString(),job.id);audit(job.owner,'job.'+status,job.id);};
 return async(job,action='publish_draft')=>{
  let writing=false,nonce;
  try{
   const c=getConnection(job),snapshot=db.prepare('SELECT * FROM job_snapshots WHERE job_id=?').get(job.id);if(!snapshot)throw Error('缺少任务快照');nonce=snapshot.verification_nonce;
   const lease={product:JSON.parse(snapshot.product),marker:'OPS-'+job.id.replaceAll('-',''),candidate_id:snapshot.candidate_id};
   if(mallOrigin(lease.product.shopxo.origin)!==mallOrigin(c.url))throw Error('ShopXO地址与原任务不一致');
   const client=createShopxoClient(c,fetcher);
   let actual;
   if(action==='verify_draft'){actual=await client('detail',{marker:lease.marker,goods_id:Number(lease.candidate_id)});if(db.prepare('SELECT verification_nonce FROM job_snapshots WHERE job_id=?').get(job.id)?.verification_nonce!==nonce)return;}
   else{
    if(snapshot.claimed)throw Error('创建已领取，禁止重复创建');
    const plan=buildShopxoProduct(lease,lease.product.shopxo.warehouseId),found=await client('lookup',{marker:lease.marker});
    if(!db.prepare('UPDATE job_snapshots SET claimed=1 WHERE job_id=? AND claimed=0').run(job.id).changes)return;writing=true;audit(job.owner,'job.claim_create',job.id);
    if(found.found)actual=found.product;else{if(found.pending)throw Error('商城已存在待核对回执，禁止再次创建');actual=await client('create',{product:plan});}
    if(!/^[1-9][0-9]{0,14}$/.test(String(actual?.id)))throw Error('未获得可信商品ID');lease.candidate_id=String(actual.id);db.prepare('UPDATE job_snapshots SET candidate_id=? WHERE job_id=?').run(lease.candidate_id,job.id);
   }
   const result=verifyShopxoProduct(actual,lease);update(job,result.status,result.message,result.remote_id);
  }catch(error){if(action==='verify_draft'&&db.prepare('SELECT verification_nonce FROM job_snapshots WHERE job_id=?').get(job.id)?.verification_nonce!==nonce)return;const candidate=db.prepare('SELECT candidate_id FROM job_snapshots WHERE job_id=?').get(job.id)?.candidate_id||'';update(job,candidate?'awaiting_review':'unknown',(writing?'创建可能已执行，请核对任务货号，禁止重复创建。':'')+error.message,candidate);}
 };
}
