// Merchant secrets stay in OPS. Workflows receive only a short-lived access token.
const sites={'crmeb-pro':['https://xlupw.com','/outapi/access_token'],'crmeb-store':['https://www.xlyp.cc','/outapi/get_token']};
export async function fetchCrmebToken(target,credentials,fetcher=fetch){
 const site=sites[target];if(!site)throw Error('不支持的 CRMEB 商城');
 const {appid,appsecret}=credentials||{};
 if(typeof appid!=='string'||!appid.trim()||appid.length>200||typeof appsecret!=='string'||!appsecret||appsecret.length>1000||/[\r\n]/.test(appsecret))throw Error('请在 OPS 连接与配置中保存此商城的 AppID 和 AppSecret');
 let r,data;
 try{
  r=await fetcher(site[0]+site[1],{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({appid:appid.trim(),appsecret}),redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!r.ok)throw Error();
  const text=await r.text();if(text.length>2e6)throw Error();data=JSON.parse(text);
 }catch{throw Error('商城授权请求未完成，请检查网络与接口配置');}
 if(Number(data?.status)!==200){
  const raw=String(data?.msg||''),hint=['appid或appsecret错误','账号不存在','账号已禁用','接口未开启'].find(x=>raw.includes(x));
  throw Error('商城授权失败'+(hint?'：'+hint:'，请检查前端保存的凭证与权限'));
 }
 const token=data.data?.access_token||data.data?.token||data.access_token||data.token;
 if(typeof token!=='string'||!token||token.length>10000||/[\u0000-\u0020]/.test(token))throw Error('商城未返回有效访问 Token');
 return token;
}
