import {buildOfficialProduct,verifyOfficialProduct} from './crmeb-official.mjs';
// Allowlist transcribed from the deployed MULTI 4.2 Product::productSave supplied by the operator.
export const STORE_FIELDS=['product_type','supplier_id','cate_id','store_name','store_info','keyword','unit_name','recommend_image','slider_image','is_sub','sort','sales','ficti','give_integral','is_show','is_good','is_picks','description','spec_type','video_open','video_link','items','attrs','recommend','activity','coupon_ids','label_id','command_word','tao_words','type','delivery_type','freight','postage','temp_id','recommend_list','brand_id','soure_link','bar_code','code','is_support_refund','is_presale_product','presale_time','presale_day','is_vip_product','auto_on_time','auto_off_time','custom_form','store_label_id','ensure_id','specs','specs_id','is_limit','limit_type','limit_num'];
export function requireStoreToken(response){
 if(response?.status!==undefined&&Number(response.status)!==200)throw Error('多门店授权失败，请核对独立凭据');
 const data=response?.data||response,token=data?.token||data?.access_token;
 if(typeof token!=='string'||!token)throw Error('多门店未返回有效 token');return token;
}
export function storeLease(lease){
 const p=lease?.product;
 if(p?.catalog_target!=='crmeb-store'||!Number.isSafeInteger(p.category_id)||p.category_id<=0)throw Error('请从多门店的分类列表选择分类，不能使用会员商城分类');
 if(!Array.isArray(p.skus))throw Error('缺少 SKU');
 return {...lease,product:{...p,skus:p.skus.map(s=>({...s,spec:p.skus.length===1&&!String(s.spec||'').trim()?'默认':s.spec}))}};
}
export function buildStoreProduct(lease,config){
 const payload=buildOfficialProduct(storeLease(lease),{...config,forceMulti:true});payload.type=0;
 return Object.fromEntries(STORE_FIELDS.map(key=>[key,payload[key]]));
}
export function verifyStoreProduct(response,lease,config){
 const d=response?.data?.productInfo||response?.data;
 if(d&&d.product_type!==undefined&&Number(d.product_type)!==0)return {status:'awaiting_review',message:'多门店商品类型不是普通实物，未确认成功'};
 return verifyOfficialProduct(response,storeLease(lease),{...config,forceMulti:true});
}
