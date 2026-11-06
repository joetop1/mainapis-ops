// Owner-scoped history, independent of current collector filter and loaded page.
export function productMergeUsage(db,owner){
 const usage=new Map();
 const rows=db.prepare(`SELECT p.id,json_extract(p.data,'$.title') title,json_extract(p.data,'$.merge_sources') sources,json_type(p.data,'$.same_style') style FROM product_merge_requests r JOIN products p ON p.id=r.product_id WHERE r.owner=? AND p.owner=?`).all(owner,owner);
 for(const row of rows){const kind=row.style==='object'?'same-style':'merge';for(const id of new Set((JSON.parse(row.sources||'[]')).map(r=>r.product_id))){if(id===row.id)continue;const targets=usage.get(id)||[];if(!targets.some(t=>t.id===row.id))targets.push({id:row.id,title:row.title||'整理商品',kind});usage.set(id,targets);}}
 return usage;
}
