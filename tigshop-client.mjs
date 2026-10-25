const base='https://xiaolango.com/adminapi/product/';
export function requireTigshopToken(value){
 const token=String(value||'').trim();
 if(!/^[0-9a-f]{32}$/i.test(token))throw Error('请填写 Tigshop 后台生成的 32 位 API Token');
 return token;
}
export function createTigshopClient(token,fetcher=fetch){
 token=requireTigshopToken(token);
 return async(path,body)=>{
  // Fixed server-side endpoint allowlist. Credentials never follow redirects.
  if(!/^(product\/(shippingTplList|create|detail\?id=[1-9][0-9]{0,14}|list\?page=1&size=100&keyword=OPS-[0-9a-f]{32})|category\/getAllCategory|brand\/search)$/.test(path))throw Error('不支持的商城接口');
  try{
   const r=await fetcher(base+path,{method:body===undefined?'GET':'POST',headers:{'X-Api-Token':token,'X-ADMIN-TYPE':'admin',Accept:'application/json',...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:'error',signal:AbortSignal.timeout(15000)});
   if(r.status===401||r.status===403)throw Error('Tigshop 鉴权或权限检查失败，请检查 API Token');
   if(!r.ok)throw Error('Tigshop 返回 HTTP '+r.status);
   const text=await r.text();if(text.length>2e6)throw Error('商城响应过大');
   const result=JSON.parse(text);
   if(result.code!==0){
    if(Number(result.code)===401||Number(result.code)===403)throw Error('Tigshop 鉴权或权限检查失败，请检查 API Token');
    const message=String(result.message||'接口返回失败').replaceAll(token,'[已隐藏]').replace(/<[^>]*>/g,'').slice(0,200);
    throw Error('Tigshop：'+message);
   }
   return result;
  }catch(e){
   if(e.message.startsWith('Tigshop')||e.message==='商城响应过大')throw e;
   throw Error('Tigshop 请求未完成，请检查商城连接；不会自动重复创建');
  }
 };
}
export async function tigshopShipping(client){
 const r=await client('product/shippingTplList');
 if(!Array.isArray(r.data))throw Error('Tigshop 运费模板格式无效');
 const seen=new Set();
 return r.data.filter(x=>x.shopId===0).map(x=>{
  const id=Number(x.shippingTplId),name=String(x.shippingTplName||'').trim();
  if(!Number.isSafeInteger(id)||id<=0||!name||seen.has(id))throw Error('Tigshop 运费模板无效');seen.add(id);
  return {id,name,isDefault:x.isDefault===1};
 });
}
