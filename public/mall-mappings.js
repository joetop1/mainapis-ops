const systems=['crmeb-pro','crmeb-store','tigshop','yunzhong','shopxo'];
const ids=value=>{if(!Array.isArray(value)||value.length>50||value.some(id=>!Number.isSafeInteger(id)||id<=0)||new Set(value).size!==value.length)throw Error('商城映射中的品牌或标签ID无效');return [...value];};
export function normalizeMallMappings(value){
 if(!Array.isArray(value)||value.length>50)throw Error('商城映射必须是数组且最多50项');const seen=new Set();
 return value.map(row=>{if(!row||typeof row!=='object'||Array.isArray(row)||typeof row.catalog_connection_id!=='string'||!row.catalog_connection_id||row.catalog_connection_id.length>100||seen.has(row.catalog_connection_id)||!systems.includes(row.catalog_target)||!Number.isSafeInteger(row.category_id)||row.category_id<0)throw Error('商城映射连接、分类或系统无效或重复');seen.add(row.catalog_connection_id);
 const applicable=row.applicable_type??0;if(![0,1].includes(applicable))throw Error('商城映射的门店范围无效');
 return {catalog_connection_id:row.catalog_connection_id,catalog_target:row.catalog_target,category_id:row.category_id,category:String(row.category||'').slice(0,100),brand_ids:ids(row.brand_ids??[]),tag_ids:ids(row.tag_ids??[]),...(row.catalog_target==='crmeb-store'?{applicable_type:applicable}:{})};});
}
export function productMallMappings(p){
 if(p.mall_mappings!==undefined)return normalizeMallMappings(p.mall_mappings);
 if(!p.catalog_connection_id)return [];
 return normalizeMallMappings([{catalog_connection_id:p.catalog_connection_id,catalog_target:p.catalog_target||'crmeb-pro',category_id:p.category_id||0,category:p.category||'',brand_ids:p.brand_ids||[],tag_ids:p.tag_ids||[],applicable_type:p.applicable_type??0}]);
}
export function productForMall(p,id,target){
 const mapping=productMallMappings(p).find(m=>m.catalog_connection_id===id&&m.catalog_target===target);
 if(p.mall_mappings!==undefined&&!mapping)throw Error('此商城尚未设置分类和品牌，请在商品编辑页补充并重新审核');
 if(mapping){if(p.mall_mappings!==undefined&&!mapping.category_id)throw Error('此商城尚未选择有效分类，请补充并重新审核');const result={...p,...mapping};if(target!=='crmeb-store')delete result.applicable_type;delete result.mall_mappings;delete result.tigshop;delete result.crmeb;delete result.yunzhong;delete result.shopxo;return result;}
 // Legacy products retain the original single-mall publishing rules.
 if(p.category_id&&p.catalog_connection_id&&p.catalog_connection_id!==id)throw Error('分类品牌属于另一个商城连接，请在编辑页切换到目标商城重新选择并审核');
 if(p.category_id&&(p.catalog_target||'crmeb-pro')!==target)throw Error('分类和品牌属于另一商城，请在编辑页选择当前目标商城并重新审核');
 return {...p,catalog_connection_id:id};
}
