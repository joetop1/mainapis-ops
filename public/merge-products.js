export function suggestedMergeRows(products){
 const used=new Set();return products.flatMap((p,i)=>p.skus.map((s,j)=>{
  let code=/^[A-Za-z0-9_.-]{1,64}$/.test(s.sku)&&!used.has(s.sku)?s.sku:'MERGE-'+(i+1)+'-'+(j+1);while(used.has(code))code+='x';used.add(code);
  return {product_id:p.id,original_sku:s.sku,sku:code,value:('款式'+(i+1)+(p.skus.length>1?' · '+(s.spec||'规格'+(j+1)):'')).slice(0,100)};
 }));
}
export function mergeSelection(products,selected){
 const list=[...selected].map(id=>products.find(p=>p.id===id));if(list.length<2||list.length>20||list.some(p=>!p))throw Error('请选择2至20条仍在采集箱中的商品');
 if(list.some(p=>!p.skus?.length))throw Error('所选商品尚未录入SKU，请先补齐');if(list.reduce((n,p)=>n+p.skus.length,0)>500)throw Error('合并后最多500个SKU');return list;
}
