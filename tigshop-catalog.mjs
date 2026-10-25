export function createTigshopCatalog(fetchJSON,token){
 let cache;
 return async(force=false)=>{
  if(!token)throw Error('请配置 Tigshop 分类品牌读取凭据');
  if(!force&&cache&&Date.now()-cache.time<300000)return cache.value;
  const get=async path=>{const r=await fetchJSON('https://xiaolango.com/adminapi/product/'+path,{headers:{'X-Api-Token':token,'X-ADMIN-TYPE':'admin'}});if(r.code!==0)throw Error('Tigshop 列表读取失败');return r.data;};
  const [cats,brands]=await Promise.all([get('category/getAllCategory'),get('brand/search')]);
  const categories=[],seen=new Set();
  const walk=(rows,names=[],ids=[],depth=0)=>{if(!Array.isArray(rows)||depth>10)throw Error('Tigshop 分类格式错误');for(const r of rows){const id=Number(r.categoryId),name=String(r.categoryName||'').trim();if(!Number.isSafeInteger(id)||id<=0||!name||seen.has(id)||seen.size>5000)throw Error('Tigshop 分类无效');seen.add(id);const path=[...names,name],pathIds=[...ids,id];categories.push({id,name,label:path.join(' / '),ids:pathIds});if(r.children?.length)walk(r.children,path,pathIds,depth+1);}};
  walk(cats);
  if(!Array.isArray(brands.brandList))throw Error('Tigshop 品牌格式错误');
  const brandRows=brands.brandList.map(r=>{const id=Number(r.brandId),name=String(r.brandName||'').trim();if(!Number.isSafeInteger(id)||id<=0||!name)throw Error('Tigshop 品牌无效');return {id,name,label:name,ids:[id]};});
  const value={target:'tigshop',categories,brands:brandRows,categoryError:'',brandError:'',notice:'平台自营分类与品牌，价格发布时由人民币换算为欧元。',fetched_at:new Date().toISOString()};cache={time:Date.now(),value};return value;
 };
}
