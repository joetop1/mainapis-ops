const paths={'crmeb-pro':'/webhook/ops-crmeb-official','crmeb-store':'/webhook/ops-crmeb-store'};
export function validateCrmebWebhook(target,url,token){
 const path=paths[target];if(!path)throw Error('无效商城');
 let u;try{u=new URL(String(url));}catch{throw Error('请填写有效生产 Webhook 地址');}
 if(u.origin!=='https://n8n.mainapis.com'||u.pathname!==path||u.search||u.hash||u.username||u.password)throw Error('请使用对应商城的生产地址：https://n8n.mainapis.com'+path);
 if(typeof token!=='string'||token.length<32||token.length>1000||/[\u0000-\u0020\u007f]/.test(token))throw Error('Webhook 密钥至少 32 个字符，不含空格或换行；应与 n8n 的 X-Ops-Token 完全一致');
 return {url:u.href,token};
}
export async function testCrmebWebhook(connection,fetcher=fetch){
 try{
  const r=await fetcher(connection.url,{method:'POST',headers:{'Content-Type':'application/json','X-Ops-Token':connection.token},body:JSON.stringify({action:'ops_connection_test'}),redirect:'manual',signal:AbortSignal.timeout(15000)});
  const status=r.status;
  const ok=status>=200&&status<300;
  return {ok,httpStatus:status,message:ok?'Webhook 入口已通过鉴权。n8n 中可能出现一条参数校验失败的测试记录，这是预期结果；不会创建商品，也不代表商城入库已验证。':status===401||status===403?'入口鉴权失败：此密钥与 n8n Webhook 的 X-Ops-Token 不一致，或请求被网关拒绝。':status===404?'生产 Webhook 未找到，请检查工作流是否已 Publish。':status>=300&&status<400?'入口发生重定向，未向跳转地址发送密钥。':'入口返回 HTTP '+status+'，请检查 n8n 工作流与网关。'};
 }catch{return {ok:false,httpStatus:null,message:'入口连接超时或网络失败，请检查 n8n 服务；测试不会自动重发。'};}
}
