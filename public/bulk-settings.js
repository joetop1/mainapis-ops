import {productMallMappings,normalizeMallMappings} from './mall-mappings.js';
export function applyBulkMapping(product,mapping,mode='fill'){
 if(!['fill','overwrite'].includes(mode))throw Error('批量设置模式无效');
 const [checked]=normalizeMallMappings([mapping]),p=structuredClone(product),rows=productMallMappings(p),old=rows.find(r=>r.catalog_connection_id===checked.catalog_connection_id);
 const next=old?{...old}:{catalog_connection_id:checked.catalog_connection_id,catalog_target:checked.catalog_target,category_id:0,category:'',brand_ids:[],tag_ids:[],...(checked.catalog_target==='crmeb-store'?{applicable_type:0}:{})};
 if(checked.category_id&&(mode==='overwrite'||!next.category_id)){next.category_id=checked.category_id;next.category=checked.category;}
 if(checked.brand_ids.length&&(mode==='overwrite'||!next.brand_ids?.length))next.brand_ids=[...checked.brand_ids];
 if(old)rows[rows.indexOf(old)]=next;else rows.push(next);
 p.mall_mappings=normalizeMallMappings(rows);
 if(!p.catalog_connection_id||p.catalog_connection_id===next.catalog_connection_id)Object.assign(p,next);
 return p;
}
