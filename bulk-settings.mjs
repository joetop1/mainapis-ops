import {applyBulkMapping} from './public/bulk-settings.js';
import {decodeProduct} from './core.mjs';
export async function bulkProductSettings({db,owner,input,validateMapping,audit}){
 if(!Array.isArray(input.products)||!input.products.length||input.products.length>100||new Set(input.products.map(x=>x.id)).size!==input.products.length)throw Error('请选择1至100件不重复的商品');
 const mapping=await validateMapping(input.mapping),results=[];
 for(const selected of input.products){try{
  const row=db.prepare('SELECT * FROM products WHERE id=? AND owner=?').get(selected.id,owner);if(!row)throw Error('商品不存在或不属于当前空间');if(row.revision!==selected.revision)throw Error('商品版本已变化，请刷新后重试');
  const product=decodeProduct(row),next=applyBulkMapping(product,mapping,input.mode);
  // decodeProduct includes derived database fields; only persist the JSON document.
  const data={...JSON.parse(row.data),mall_mappings:next.mall_mappings};if(!product.catalog_connection_id||product.catalog_connection_id===mapping.catalog_connection_id){for(const k of ['catalog_connection_id','catalog_target','category_id','category','brand_ids','tag_ids','applicable_type'])if(next[k]!==undefined)data[k]=next[k];}
  if(JSON.stringify(JSON.parse(row.data))===JSON.stringify(data)){results.push({id:row.id,ok:true,unchanged:true});continue;}
  db.exec('BEGIN IMMEDIATE');try{const result=db.prepare("UPDATE products SET data=?,status='draft',revision=revision+1,updated=? WHERE id=? AND owner=? AND revision=?").run(JSON.stringify(data),new Date().toISOString(),row.id,owner,selected.revision);if(!result.changes)throw Error('商品版本已变化');audit(owner,'product.bulk_mapping',row.id);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
  results.push({id:row.id,ok:true});
 }catch(e){results.push({id:selected.id,ok:false,error:e.message});}}
 return {results};
}
