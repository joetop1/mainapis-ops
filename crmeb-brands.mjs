// Read-only credentials; fixed upstreams, no arbitrary URLs and no product writes.
const sites={'crmeb-pro':{base:'https://xlupw.com',auth:'/outapi/access_token'},'crmeb-store':{base:'https://www.xlyp.cc',auth:'/outapi/get_token'}};
export function crmebBrandReader(target,credentials,fetcher=fetch){
 const site=sites[target];if(!site)throw Error('无效商城');
 const {appid,appsecret}=credentials||{};
 if(typeof appid!=='string'||!appid.trim()||appid.length>200||typeof appsecret!=='string'||!appsecret||appsecret.length>1000)throw Error('请填写商城对外接口 AppID 和 AppSecret');
 const request=async(path,options)=>{
  const stage=path===site.auth?'获取访问 Token':'读取后台品牌';
  try{
   const r=await fetcher(site.base+path,{...options,redirect:'error',signal:AbortSignal.timeout(15000)});
   if(r.status===404)throw Error('商城'+stage+'失败：HTTP 404，请检查对应接口是否存在');
   if(!r.ok)throw Error('商城'+stage+'失败：HTTP '+r.status);
   const text=await r.text();if(text.length>2e6)throw Error('品牌响应过大');
   const data=JSON.parse(text);if(Number(data.status)!==200){
    const raw=String(data.msg||data.message||'');
    const hints=['appid或appsecret错误','账号不存在','账号已禁用','请登录','接口未开启','暂无权限','接口不存在'];
    const hint=hints.find(x=>raw.includes(x));
    const status=Number.isFinite(Number(data.status))?Number(data.status):'格式异常';
    throw Error('商城'+stage+'失败（业务状态 '+status+'）'+(hint?'：'+hint:'；请核对对应接口配置'));
   }
   return data;
  }catch(e){if(e.message.startsWith('商城')||e.message==='品牌响应过大')throw e;throw Error('商城品牌接口未完成，请检查网络或只读接口配置');}
 };
 return async()=>{
  const auth=await request(site.auth,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({appid:appid.trim(),appsecret})});
  const token=auth.data?.access_token||auth.data?.token||auth.access_token||auth.token;
  if(typeof token!=='string'||!token||/[\r\n]/.test(token))throw Error('商城未返回有效访问 Token');
  return request('/outapi/brand/list',{method:'GET',headers:{Authorization:'Bearer '+token,'Authori-zation':'Bearer '+token}});
 };
}
