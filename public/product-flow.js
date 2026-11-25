// Use authoritative mutation receipts immediately; list refreshes are secondary.
export function replaceProduct(products,product){
 if(!product?.id||!Number.isSafeInteger(product.revision))throw Error('商品回执缺少版本，请刷新后核对');
 const index=products.findIndex(p=>p.id===product.id),previous=products[index];
 if(previous&&previous.revision>product.revision)return products;
 const next={...previous,...product};
 return index<0?[next,...products]:products.map((p,i)=>i===index?next:p);
}

export async function openMergedProduct(id,{api,apply,edit,refresh,notify}){
 // The result may be absent from the active collector filter, or a list request
 // may be superseded. Fetch this exact product rather than waiting for a list.
 try{const product=await api('/api/products/'+encodeURIComponent(id));apply(product);edit(product);}
 catch(error){notify('商品已生成，读取编辑资料失败，请从列表打开：'+error.message);}
 void refresh().catch(()=>notify('商品已生成，列表刷新失败，请手动刷新。'));
}

export function publicationActivity(){
 const products=new Map();
 return {
  start(id,malls,records=[]){const rows=new Map(malls.map(mall=>[mall,{status:'submitting',message:'正在提交发布请求',previous:JSON.stringify(records.find(r=>r.mall_connection_id===mall))}]));products.set(id,rows);},
  clear(id){products.delete(id);},
  uncertain(id){for(const row of products.get(id)?.values()||[])Object.assign(row,{status:'unknown',message:'提交结果未确认，请核对发布记录'});},
  record(id,mall,record){return products.get(id)?.get(mall)||record;},
  has(id){return products.has(id);},
  reconcile(items){for(const product of items){const rows=products.get(product.id);if(!rows)continue;for(const record of product.publications||[]){const pending=rows.get(record.mall_connection_id);if(pending?.status==='unknown'&&JSON.stringify(record)!==pending.previous)rows.delete(record.mall_connection_id);}if(!rows.size)products.delete(product.id);}}
 };
}

// Read receipts only: an absent row never proves that a concurrent POST failed.
export async function recoverPublicationReceipt({api,productId,requestId,destinations,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),attempts=6}){
 for(let i=0;i<attempts;i++){
  try{const receipt=await api('/api/products/'+encodeURIComponent(productId)+'/publish?request_id='+encodeURIComponent(requestId),'GET',undefined,AbortSignal.timeout(5000));
   const rows=receipt?.results;
   if(Array.isArray(rows)&&rows.length===destinations.length&&new Set(rows.map(r=>r.connection_id)).size===destinations.length&&rows.every(r=>r.ok===true&&typeof r.id==='string'&&destinations.some(d=>d.connection_id===r.connection_id&&d.target===r.target)))return receipt;
  }catch{}
  if(i+1<attempts)await wait(2000);
 }
 return null;
}
