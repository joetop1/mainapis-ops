export function pageInfo(total,page=1,pageSize=20){
 const size=[20,50,100].includes(Number(pageSize))?Number(pageSize):20;
 const pages=Math.max(1,Math.ceil(total/size));
 const current=Math.min(pages,Math.max(1,Math.trunc(Number(page))||1));
 return {page:current,pageSize:size,pages,total,start:total?(current-1)*size+1:0,end:Math.min(current*size,total),offset:(current-1)*size};
}
export function publicationMalls(product,malls){
 return malls.filter(mall=>mall.configured||product.publications?.some(row=>row.mall_connection_id===mall.id||!row.mall_connection_id&&row.target===mall.type&&mall.legacy));
}
