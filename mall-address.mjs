import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';
import https from 'node:https';
export const LEGACY_YUNZHONG_ORIGIN='https://asns.cc';
export function mallOrigin(value){
 let u;try{u=new URL(String(value).trim());}catch{throw Error('请填写有效的商城 HTTPS 地址');}
 if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||(u.pathname!=='/'&&u.pathname!==''))throw Error('商城地址须为 HTTPS 域名，不含路径、查询参数或账号密码');
 if(u.port&&u.port!=='443')throw Error('商城地址仅支持 HTTPS 443 端口');
 if(isIP(u.hostname.replace(/^\[|\]$/g,''))||!u.hostname.includes('.')||/(^|\.)(localhost|local|internal|test|invalid)$/.test(u.hostname))throw Error('请填写公网商城域名');
 return u.origin;
}
export function publicAddress(address){
 if(isIP(address)!==4)return false; // Fail closed for IPv6 until a public-range policy is reviewed.
 const [a,b,c]=address.split('.').map(Number);
 return !(a===0||a===10||a===127||a>=224||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&(b===168||b===0||b===2))||(a===100&&b>=64&&b<=127)||(a===198&&(b===18||b===19||b===51&&c===100))||(a===203&&b===0&&c===113));
}
// Native fetch dispatcher: DNS is resolved and pinned for each request, so a configured
// hostname cannot redirect signed credentials to local services through DNS rebinding.
export function createMallDispatcher({resolve=lookup,send=https.request}={}){return {dispatch(options,handler){
 let request,aborted=false;
 handler.onConnect(()=>{aborted=true;request?.destroy();});
 (async()=>{
  const url=new URL(options.path,String(options.origin));mallOrigin(url.origin);
  const addresses=await resolve(url.hostname,{family:4,all:true});
  if(!addresses.length||addresses.some(row=>!publicAddress(row.address)))throw Error('商城域名必须解析到公网地址');
  if(aborted)return;
  request=send(url,{method:options.method,headers:options.headers,family:4,autoSelectFamily:false,lookup:(_host,_options,callback)=>callback(null,addresses[0].address,4)},response=>{
   handler.onHeaders(response.statusCode,response.rawHeaders,()=>response.resume(),response.statusMessage);
   response.on('data',chunk=>{if(handler.onData(chunk)===false)response.pause();});
   response.on('end',()=>handler.onComplete([]));response.on('error',error=>handler.onError(error));
  });
  request.on('error',error=>handler.onError(error));
  if(options.body){for await(const chunk of options.body){if(aborted)return;request.write(chunk);}}
  request.end();
 })().catch(error=>handler.onError(error));return true;
}};}
export const mallDispatcher=createMallDispatcher();
