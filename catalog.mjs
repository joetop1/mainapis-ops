// Read-only, fixed upstreams. Credentials and user-supplied URLs are never accepted.
const base='https://xlupw.com';
function options(response,kind){
 if(Number(response?.status)!==200)throw Error('商城返回失败');
 const rows=Array.isArray(response.data)?response.data:response.data?.list;
 if(!Array.isArray(rows))throw Error('商城列表格式不匹配');
 const result=[],seen=new Set();
 const walk=(nodes,names=[],ids=[],depth=0)=>{
  if(depth>10||result.length>5000)throw Error('商城列表过大');
  for(const row of nodes){
   const id=Number(row.id),name=String(row[kind==='category'?'cate_name':'brand_name']||'').trim();
   if(!Number.isSafeInteger(id)||id<=0||!name||seen.has(id))throw Error('商城列表 ID 或名称无效');
   seen.add(id);const path=[...names,name],pathIds=[...ids,id];
   result.push({id,name,label:path.join(' / '),ids:pathIds});
   if(Array.isArray(row.children))walk(row.children,path,pathIds,depth+1);
  }
 };walk(rows);return result;
}
export function createCatalogLoader(fetchJSON){
 let cache=null,pending=null;
 return async(force=false)=>{
  if(!force&&cache&&Date.now()-cache.time<300000)return cache.value;
  if(pending)return pending;
  pending=(async()=>{
   const responses=await Promise.allSettled(['/api/category','/api/brand'].map(path=>fetchJSON(base+path)));
   const value={target:'crmeb-pro',categories:[],brands:[],categoryError:'',brandError:'',fetched_at:new Date().toISOString(),notice:'分类为商城前台可见分类；品牌为当前上架商品使用的可见品牌，暂不包含全部后台品牌。'};
   for(const [i,kind]of ['category','brand'].entries()){
    try{if(responses[i].status!=='fulfilled')throw Error();value[kind==='category'?'categories':'brands']=options(responses[i].value,kind);}
    catch{value[kind+'Error']='读取商城'+(kind==='category'?'分类':'品牌')+'失败，请稍后刷新；不会使用手工填写的 ID';}
   }
   if(!value.categoryError&&!value.brandError)cache={time:Date.now(),value};
   return value;
  })();try{return await pending;}finally{pending=null;}
 };
}
export function applyCatalog(product,catalog){
 if(product.category_id){
  if(catalog.categoryError)throw Error(catalog.categoryError);
  const category=catalog.categories.find(x=>x.id===product.category_id);
  if(!category)throw Error('所选商城分类已不可用，请刷新分类重新选择');
  product.category=category.label;product.catalog_target='crmeb-pro';
 }
 if(product.brand_ids?.length){
  if(catalog.brandError)throw Error(catalog.brandError);
  const brand=catalog.brands.find(x=>x.id===product.brand_ids.at(-1));
  if(!brand||JSON.stringify(brand.ids)!==JSON.stringify(product.brand_ids))throw Error('所选商城品牌已不可用，请刷新品牌重新选择');
 }
 return product;
}
