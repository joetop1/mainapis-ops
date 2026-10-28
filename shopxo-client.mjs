import {randomBytes,createHmac} from 'node:crypto';
import {mallOrigin,mallDispatcher} from './mall-address.mjs';
export function requireShopxoConnection(value,previous){
 const url=mallOrigin(value.url||previous?.url||''),appid=String(value.appid||previous?.appid||'').trim(),supplied=String(value.appsecret||'').trim();
 if(!/^[A-Za-z0-9_-]{8,64}$/.test(appid))throw Error('请填写ShopXO独立扩展生成的应用ID');
 if(previous&&(url!==previous.url||appid!==previous.appid)&&!supplied)throw Error('更换商城地址或应用ID时须重新填写密钥');
 const appsecret=supplied||previous?.appsecret||'';if(!/^[a-f0-9]{64}$/.test(appsecret))throw Error('请填写ShopXO独立扩展生成的64位密钥');
 return {url,appid,appsecret};
}
export const shopxoSignature=(request,key)=>createHmac('sha256',key).update(request).digest('hex');
export function createShopxoClient(connection,fetcher=fetch){
 const {url,appid,appsecret}=requireShopxoConnection(connection);
 return async(op,parameters={})=>{
  if(!['capabilities','lookup','create','detail'].includes(op)||['op','appid','timestamp','nonce'].some(k=>k in parameters))throw Error('ShopXO接口操作无效');
  const request=Buffer.from(JSON.stringify({...parameters,op,appid,timestamp:Math.floor(Date.now()/1000),nonce:randomBytes(16).toString('hex')})).toString('base64');if(request.length>1500000)throw Error('ShopXO请求过大，请减少详情内容');
  let response;try{response=await fetcher(url+'/mainapis-shopxo.php',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({request,sign:shopxoSignature(request,appsecret)}),dispatcher:mallDispatcher,redirect:'error',signal:AbortSignal.timeout(op==='create'?60000:20000)});}catch{throw Error('ShopXO独立入口连接未确认，请检查扩展与网络；创建结果不明时禁止重建');}
  let body;try{const text=await response.text();if(text.length>3e6)throw Error();body=JSON.parse(text);}catch{throw Error('ShopXO入口未返回有效JSON，HTTP '+response.status);}
  if(!response.ok||body.code!==0||!body.data)throw Error('ShopXO独立入口拒绝请求，HTTP '+response.status+'；诊断码 '+(/^[A-Z_]{1,60}$/.test(body.error_code||'')?body.error_code:'REQUEST_FAILED')+'，请先核对任务货号，禁止重复创建');
  return body.data;
 };
}
export function shopxoCatalog(caps){
 if(caps.contract!=='mainapis-shopxo-1'||caps.shopVersion!=='6.9.2'||!['marker_receipt','warehouse_inventory','full_detail'].every(f=>caps.features?.includes(f)))throw Error('请安装已适配ShopXO 6.9.2的独立扩展并通过预检');
 for(const key of ['categories','brands','warehouses'])if(!Array.isArray(caps[key])||caps[key].length>5000)throw Error('ShopXO分类品牌或仓库格式无效');
 const byId=new Map();for(const row of caps.categories){if(!Number.isSafeInteger(row.id)||row.id<1||!Number.isSafeInteger(row.parent_id)||row.parent_id<0||typeof row.name!=='string'||!row.name||byId.has(row.id))throw Error('ShopXO分类无效');byId.set(row.id,row);}
 const categories=[...byId.values()].map(row=>{const ids=[],names=[],seen=new Set();for(let current=row;current;current=current.parent_id?byId.get(current.parent_id):null){if(seen.has(current.id)||ids.length>10)throw Error('ShopXO分类循环或过深');seen.add(current.id);ids.unshift(current.id);names.unshift(current.name);if(current.parent_id&&!byId.has(current.parent_id))throw Error('ShopXO父分类缺失');}return {id:row.id,name:row.name,label:names.join(' / '),ids};});
 const convert=rows=>{const seen=new Set();return rows.map(row=>{if(!Number.isSafeInteger(row.id)||row.id<1||typeof row.name!=='string'||!row.name||seen.has(row.id))throw Error('ShopXO品牌或仓库无效');seen.add(row.id);return {...row,label:row.name,ids:[row.id]};});};
 return {target:'shopxo',categories,brands:convert(caps.brands),warehouses:convert(caps.warehouses),categoryError:'',brandError:'',fetched_at:new Date().toISOString(),notice:'ShopXO 6.9.2：商品默认下架，库存写入所选仓库；运费使用商城配置，虚拟销量忽略，采购参考成本保存在规格扩展字段。'};
}
