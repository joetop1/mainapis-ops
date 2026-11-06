export function mergeUsages(products){
 const usage=new Map();const add=(source,target)=>{if(source===target.id)return;const rows=usage.get(source)||[];if(!rows.some(r=>r.id===target.id))rows.push(target);usage.set(source,rows);};
 for(const p of products){for(const target of p.merge_usage||[])add(p.id,target);for(const source of p.merge_sources||[])add(source.product_id,{id:p.id,title:p.title||'整理商品',kind:p.same_style?'same-style':'merge'});}
 return usage;
}
export function mergeStatusHTML(product,targets,esc){
 const badges=[];
 if(product.merge_sources?.length)badges.push('<span class="badge merge-result">'+(product.same_style?'同款整理成品':'合并成品')+'</span>');
 if(targets?.length){for(const kind of new Set(targets.map(t=>t.kind)))badges.push('<span class="badge merge-source">'+(kind==='same-style'?'已同款整理':'已合并')+'</span>');for(const target of targets)badges.push('<button type="button" class="text merge-result-link" data-open-merge="'+esc(target.id)+'" title="'+esc(target.title)+'">查看：'+esc(target.title)+'</button>');}
 return badges.length?'<div class="merge-status">'+badges.join('')+'</div>':'';
}
