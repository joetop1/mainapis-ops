import {randomBytes} from 'node:crypto';
import {signYunzhong,requireYunzhongCredentials} from './yunzhong-client.mjs';
export const YUNZHONG_BRIDGE='https://asns.cc/addons/yun_shop/api.php?i=1&route=mainapis-ops.index';
export const YUNZHONG_CONTRACT='mainapis-yunzhong-2';
export function createYunzhongBridge(credentials,fetcher=fetch){
 const {appid,appsecret}=requireYunzhongCredentials(credentials);
 return async(op,parameters={})=>{
  if(!['capabilities','lookup','detail','create'].includes(op))throw Error('芸众兼容接口操作无效');
  if(['op','app_id','sign','sign_type','ver','timestamp','nonce','route','i'].some(key=>key in parameters))throw Error('不能覆盖接口鉴权参数');
  const data={...parameters,op,app_id:appid,sign_type:'SHA256',ver:1,timestamp:Math.floor(Date.now()/1000),nonce:randomBytes(16).toString('hex')};data.sign=signYunzhong(data,appsecret);
  const writing=op==='create',url=writing?YUNZHONG_BRIDGE:YUNZHONG_BRIDGE+'&'+new URLSearchParams(Object.entries(data).map(([key,value])=>[key,String(value)]));
  let response;try{response=await fetcher(url,{method:writing?'POST':'GET',redirect:'error',signal:AbortSignal.timeout(writing?45000:15000),headers:{Accept:'application/json',...(writing?{'Content-Type':'application/json'}:{})},...(writing?{body:JSON.stringify(data)}:{})});}catch{throw Error('芸众兼容扩展连接未确认，请检查安装与网络；写入后必须先核对任务编码');}
  if(!response.ok)throw Error('芸众兼容扩展返回 HTTP '+response.status+'，请核对安装、签名或商品字段');
  let body;try{const text=await response.text();if(text.length>3e6)throw Error();body=JSON.parse(text);}catch{throw Error('芸众兼容扩展响应格式无效');}
  if(body?.result!==1||!body.data||typeof body.data!=='object')throw Error('芸众兼容扩展拒绝请求，请核对安装、签名或字段；不要重复创建商品');
  return body.data;
 };
}
export function yunzhongCatalog(capabilities){
 if(capabilities.contract!==YUNZHONG_CONTRACT||![2,3].includes(capabilities.categoryLevel)||!['atomic_create','marker_receipt','text_detail','sku','full_detail'].every(name=>capabilities.features?.includes(name)))throw Error('请先安装正确版本的芸众兼容扩展');
 if(!Array.isArray(capabilities.categories)||!Array.isArray(capabilities.brands)||capabilities.categories.length>5000||capabilities.brands.length>5000)throw Error('芸众分类品牌列表格式无效或过大');
 const byId=new Map();for(const row of capabilities.categories){const id=Number(row.id),parent=Number(row.parent_id);if(!Number.isSafeInteger(id)||id<=0||!Number.isSafeInteger(parent)||parent<0||byId.has(id)||typeof row.name!=='string'||!row.name.trim())throw Error('芸众分类数据无效');byId.set(id,{id,name:row.name,parent});}
 const categories=[...byId.values()].map(row=>{const ids=[],names=[],seen=new Set();let current=row;while(current){if(seen.has(current.id)||ids.length>=10)throw Error('芸众分类存在循环或超出层级');seen.add(current.id);ids.unshift(current.id);names.unshift(current.name);if(!current.parent)break;current=byId.get(current.parent);if(!current)throw Error('芸众分类父节点缺失');}return {id:row.id,name:row.name,label:names.join(' / '),ids};});
 const seenBrands=new Set(),brands=capabilities.brands.map(row=>{const id=Number(row.id);if(!Number.isSafeInteger(id)||id<=0||seenBrands.has(id)||typeof row.name!=='string'||!row.name.trim())throw Error('芸众品牌数据无效');seenBrands.add(id);return {id,name:row.name,label:row.name,ids:[id]};});
 return {target:'yunzhong',categories,brands,categoryError:'',brandError:'',fetched_at:new Date().toISOString(),categoryLevel:capabilities.categoryLevel,notice:'芸众分类与品牌来自兼容扩展，商品按下架状态入库；文字详情与产品参数一并保存。'};
}
