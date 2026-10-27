import {createHmac} from 'node:crypto';
// Verified against OutsideController.php and NotifyService.php from asns.cc 2.3.700.
export const YUNZHONG_BASE='https://asns.cc/outside/1/';
export function requireYunzhongCredentials(value,previous=null){
 const appid=String(value?.appid||'').trim();
 if(!/^[0-9]{1,30}$/.test(appid))throw Error('请填写数字应用 APPID');
 const supplied=String(value?.appsecret||'').trim();
 if(!supplied&&previous?.appid!==appid)throw Error('首次配置或更换 APPID 时必须填写 APP_Secret');
 const appsecret=supplied||previous?.appsecret||'';
 if(!appsecret||appsecret.length>512||/[\u0000-\u0020\u007f]/.test(appsecret))throw Error('请填写有效的 APP_Secret');
 return {appid,appsecret};
}
// PHP json_encode uses escaped Unicode and slashes for array values by default.
export function yunzhongQueryString(parameters){
 const phpJSON=value=>JSON.stringify(value).replace(/\//g,'\\/').replace(/[\u0080-\uffff]/g,char=>'\\u'+char.charCodeAt(0).toString(16).padStart(4,'0'));
 return Object.keys(parameters).filter(key=>key!=='sign').sort().map(key=>{
  if(!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key))throw Error('接口参数名无效');
  const value=parameters[key];
  if(typeof value==='number'&&!Number.isSafeInteger(value))throw Error('签名数值必须为整数；金额应以字符串传输');
  const text=value==null?'':typeof value==='boolean'?(value?'1':''):typeof value==='object'?phpJSON(value):String(value);
  return key+'='+text;
 }).join('&');
}
export function signYunzhong(parameters,secret){return createHmac('sha256',secret).update(yunzhongQueryString(parameters)).digest('hex');}
export function createYunzhongClient(credentials,fetcher=fetch){
 const {appid,appsecret}=requireYunzhongCredentials(credentials);
 return async(route,parameters={})=>{
  // This integration stage is deliberately read-only; no caller-controlled upstream or POST.
  if(!['goods/category','goods/list'].includes(route))throw Error('当前只开放芸众分类和商品列表读取');
  if(['app_id','sign_type','ver','sign'].some(key=>key in parameters))throw Error('不能覆盖接口鉴权参数');
  const data={...parameters,app_id:appid,sign_type:'SHA256',ver:1};
  const query=Object.fromEntries(Object.entries(data).map(([key,value])=>{if(!['string','number'].includes(typeof value))throw Error('读取接口只支持文本和整数参数');return [key,String(value)];}));
  query.sign=signYunzhong(data,appsecret);
  let res;try{res=await fetcher(YUNZHONG_BASE+route+'?'+new URLSearchParams(query),{method:'GET',redirect:'error',signal:AbortSignal.timeout(15000),headers:{Accept:'application/json'}});}catch{throw Error('芸众接口连接失败，请检查网络与商城访问限制');}
  if(!res.ok)throw Error('芸众接口返回 HTTP '+res.status);
  let body;try{const text=await res.text();if(text.length>2e6)throw Error();body=JSON.parse(text);}catch{throw Error('芸众接口未返回有效 JSON');}
  if(body?.result!==1){
   if(route==='goods/category'&&body?.msg==='未检测到分类数据!')return {result:1,data:{data:[],current_page:1,last_page:1,total:0}};
   throw Error('芸众接口鉴权或业务校验失败，请核对 APPID、密钥与 API 应用设置');
  }
  return body;
 };
}
export async function testYunzhongConnection(client){
 const response=await client('goods/list',{page:1,status:0});
 if(!Array.isArray(response.data?.data))throw Error('芸众商品列表响应格式不匹配');
 return {readable:true};
}
export async function loadYunzhongCategories(client){
 const categories=[],seen=new Set(),queue=[{id:0,names:[],ids:[],depth:0}];let requests=0;
 while(queue.length){
  const parent=queue.shift();
  if(parent.depth>10)throw Error('芸众分类层级过深');
  for(let page=1;;page++){
   if(++requests>300)throw Error('芸众分类过多，请检查分类结构');
   const response=await client('goods/category',{parent_id:parent.id,page});const data=response.data;
   if(!Array.isArray(data?.data))throw Error('芸众分类响应格式不匹配');
   for(const row of data.data){
    const id=Number(row.id),name=String(row.name||'').trim();
    if(!Number.isSafeInteger(id)||id<=0||!name||seen.has(id)||Number(row.parent_id)!==parent.id)throw Error('芸众分类 ID、父分类或名称无效');
    seen.add(id);const names=[...parent.names,name],ids=[...parent.ids,id];
    categories.push({id,name,label:names.join(' / '),ids});
    if(categories.length>5000)throw Error('芸众分类数量超出限制');
    queue.push({id,names,ids,depth:parent.depth+1});
   }
   if(data.last_page!==undefined){if(!Number.isSafeInteger(Number(data.last_page))||Number(data.last_page)<1)throw Error('芸众分页信息无效');if(page>=Number(data.last_page))break;}
   else if(data.data.length<100)break;
  }
 }
 return {target:'yunzhong',categories,brands:[],categoryError:'',brandError:'',fetched_at:new Date().toISOString(),notice:'芸众分类已读取；商品发布、规格和文字详情兼容性正在适配，当前不可发布。'};
}
