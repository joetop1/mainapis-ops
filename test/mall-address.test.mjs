import test from 'node:test';
import assert from 'node:assert/strict';
import {mallOrigin,publicAddress,mallDispatcher} from '../mall-address.mjs';
import {requireYunzhongCredentials,createYunzhongClient} from '../yunzhong-client.mjs';
import {createYunzhongBridge} from '../yunzhong-bridge.mjs';
const credentials={url:'https://shop.example.com',appid:'123',appsecret:'test-secret'};
test('商城地址只接受公网HTTPS域名，禁止凭据、路径、IP、内部域名和额外端口',()=>{
 assert.equal(mallOrigin(' https://SHOP.example.com/ '),'https://shop.example.com');
 for(const value of ['http://shop.example.com','https://user:pass@shop.example.com','https://shop.example.com/admin','https://shop.example.com?x=1','https://shop.example.com#x','https://127.0.0.1','https://[::1]','https://localhost','https://a.internal','https://shop.example.com:9000'])assert.throws(()=>mallOrigin(value));
 for(const ip of ['127.0.0.1','10.1.2.3','172.16.1.1','192.168.1.1','169.254.169.254','100.100.100.200','0.0.0.0','198.18.0.1','::1','::ffff:127.0.0.1'])assert.equal(publicAddress(ip),false,ip);
 assert.equal(publicAddress('8.8.8.8'),true);
});
test('更换商城地址必须重填密钥，旧连接兼容且原连接不变',()=>{
 const old={appid:'123',appsecret:'secret'};
 assert.equal(requireYunzhongCredentials({appid:'123'},old).url,'https://asns.cc');
 assert.throws(()=>requireYunzhongCredentials({url:credentials.url,appid:'123'},old),/必须重新填写/);
 assert.equal(requireYunzhongCredentials(credentials,old).url,credentials.url);assert.equal(old.url,undefined);
});
test('芸众读取、创建和核对均使用所选地址并禁止重定向，传递DNS固定传输器',async()=>{
 const calls=[],fetcher=async(url,options)=>{calls.push({url,options});return {ok:true,text:async()=>JSON.stringify({result:1,data:{ok:true}})};};
 const official=createYunzhongClient(credentials,fetcher),bridge=createYunzhongBridge(credentials,fetcher);
 await official('goods/list',{page:1});await official('goods/create',{title:'test'});
 await bridge('capabilities');await bridge('create',{product:{}});await bridge('detail',{goods_id:18});await bridge('check_absent',{marker:'OPS-'+'a'.repeat(32)});
 assert.equal(calls.length,6);
 for(const {url,options} of calls){assert.equal(new URL(url).origin,credentials.url);assert.equal(options.redirect,'error');assert.equal(options.dispatcher,mallDispatcher);}
 assert.equal(new URL(calls[2].url).searchParams.get('i'),'1');
});

import {createMallDispatcher} from '../mall-address.mjs';
import {EventEmitter} from 'node:events';
import {Readable} from 'node:stream';
test('真实fetch通过传输器固定已校验DNS地址，私网解析在建立连接前拒绝',async()=>{
 let sent=0;
 const send=(url,options,callback)=>{
  sent++;assert.equal(url.hostname,'merchant.example.com');assert.equal(options.family,4);
  options.lookup(url.hostname,{},(error,address,family)=>{assert.equal(error,null);assert.equal(address,'8.8.8.8');assert.equal(family,4);});
  const req=new EventEmitter();req.write=()=>true;req.destroy=()=>{};req.end=()=>queueMicrotask(()=>{const res=Readable.from([Buffer.from('{"ok":true}')]);Object.assign(res,{statusCode:200,statusMessage:'OK',rawHeaders:['Content-Type','application/json']});callback(res);});return req;
 };
 const dispatcher=createMallDispatcher({resolve:async()=>[{address:'8.8.8.8'}],send});
 const response=await fetch('https://merchant.example.com/',{dispatcher,redirect:'error'});assert.deepEqual(await response.json(),{ok:true});assert.equal(sent,1);
 const blocked=createMallDispatcher({resolve:async()=>[{address:'169.254.169.254'}],send});
 await assert.rejects(fetch('https://merchant.example.com/',{dispatcher:blocked}));assert.equal(sent,1);
});
