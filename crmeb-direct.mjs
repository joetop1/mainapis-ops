import {fetchCrmebToken} from './crmeb-auth.mjs';
import {buildOfficialProduct,officialCreateReceipt,verifyOfficialProduct} from './crmeb-official.mjs';
import {buildStoreProduct,verifyStoreProduct} from './crmeb-store.mjs';
import {mallOrigin,mallDispatcher} from './mall-address.mjs';
export function createCrmebRunner({db,getConnection,audit,fetcher=fetch}){
 const update=(job,status,message,remote='')=>{db.prepare('UPDATE jobs SET status=?,message=?,remote_id=?,updated=? WHERE id=?').run(status,message.slice(0,500),remote,new Date().toISOString(),job.id);audit(job.owner,'job.'+status,job.id);};
 return async(job,action='publish_draft')=>{
  let writing=false,verificationNonce;
  try{
   const connection=getConnection(job),snapshot=db.prepare('SELECT * FROM job_snapshots WHERE job_id=?').get(job.id);if(!snapshot)throw Error('缺少任务快照');
   verificationNonce=snapshot.verification_nonce;
   const product=JSON.parse(snapshot.product),config=product.crmeb;
   if(!config||mallOrigin(config.origin)!==mallOrigin(connection.url))throw Error('商城地址与任务快照不一致');
   const lease={product,marker:'OPS-'+job.id.replaceAll('-',''),candidate_id:snapshot.candidate_id};
   const token=await fetchCrmebToken(job.target,connection,fetcher);
   const request=async(path,body)=>{
    const response=await fetcher(config.origin+path,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+token,'Authori-zation':'Bearer '+token,Accept:'application/json',...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:'error',dispatcher:mallDispatcher,signal:AbortSignal.timeout(30000)});
    const text=await response.text();if(!response.ok||text.length>2e6)throw Error('商城请求失败');return JSON.parse(text);
   };
   if(action==='verify_draft'){
    if(!/^[1-9][0-9]{0,14}$/.test(lease.candidate_id))throw Error('商品 ID 无效');
    const response=await request('/outapi/product/'+lease.candidate_id);
    if(db.prepare('SELECT verification_nonce FROM job_snapshots WHERE job_id=?').get(job.id)?.verification_nonce!==snapshot.verification_nonce)return;
    const result=(job.target==='crmeb-store'?verifyStoreProduct:verifyOfficialProduct)(response,lease,config);update(job,result.status,result.message,result.status==='succeeded'?lease.candidate_id:result.remote_id||lease.candidate_id);return;
   }
   if(snapshot.claimed)throw Error('创建操作已领取，请核对原商品，禁止重复创建');
   const payload=(job.target==='crmeb-store'?buildStoreProduct:buildOfficialProduct)(lease,config);
   if(job.target==='crmeb-store'){
    const checked=await request('/outapi/category/'+product.category_id);if(Number(checked.status)!==200||Number(checked.data?.id)!==product.category_id)throw Error('商城授权或分类校验失败，未创建商品');
   }
   if(!db.prepare('UPDATE job_snapshots SET claimed=1 WHERE job_id=? AND claimed=0').run(job.id).changes)return;
   writing=true;audit(job.owner,'job.claim_create',job.id);
   const result=officialCreateReceipt(await request('/outapi/product',payload));update(job,result.status,result.message);
  }catch(error){
   const verifying=action==='verify_draft';if(verifying&&db.prepare('SELECT verification_nonce FROM job_snapshots WHERE job_id=?').get(job.id)?.verification_nonce!==verificationNonce)return;
   update(job,writing?'unknown':verifying?'awaiting_review':'unknown',writing?'创建结果未确认，请按任务编码核对商城，禁止重复创建':String(error.message),verifying?db.prepare('SELECT candidate_id FROM job_snapshots WHERE job_id=?').get(job.id)?.candidate_id||'':'');
  }
 };
}
