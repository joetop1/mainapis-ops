import test from 'node:test';
import assert from 'node:assert/strict';
import {localImageUploader} from '../local-image-upload.mjs';
const data='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhWQAAAAASUVORK5CYII=';
const config={enabled:true,bucket:'examplebucket',region:'cn-hangzhou',publicOrigin:'https://images.example.com',allowedOrigins:['https://mall.example.com'],accessKeyId:'exampleAccessKeyID',accessKeySecret:'exampleSecretForTestsOnly'};
test('本地图片上传验证内容、存储授权、目标隔离，重复内容沿用稳定地址且不接收客户端上传目标',async()=>{
 let enabled=true,allowed=true;const objects=new Map(),requests=[];const upload=localImageUploader({getStorage:()=>({...config,enabled}),allowedStorage:()=>allowed,fetchImpl:async(url,options={})=>{requests.push({url,options});if(options.method==='PUT'){objects.set(new URL(url).pathname,options.body);return new Response('');}return new Response(objects.get(new URL(url).pathname));}});
 enabled=false;await assert.rejects(upload('alice',{data}),/存储/);enabled=true;allowed=false;await assert.rejects(upload('alice',{data}),/存储/);allowed=true;
 await assert.rejects(upload('alice',{data:Buffer.from('<svg>fake</svg>').toString('base64')}),/图片内容/);await assert.rejects(upload('alice',{data:'!bad'}),/无效/);assert.equal(requests.length,0);
 const first=await upload('alice',{data,url:'https://evil.example.com'}),again=await upload('alice',{data}),other=await upload('bob',{data});assert.equal(first.url,again.url);assert.notEqual(first.url,other.url);assert.ok(first.url.startsWith(config.publicOrigin+'/ops/'));assert.equal(first.mime,'image/png');assert.ok(requests.every(r=>!r.url.includes('evil.example')));
 const failing=localImageUploader({getStorage:()=>config,allowedStorage:()=>true,fetchImpl:async()=>new Response('',{status:403})});await assert.rejects(failing('alice',{data}),/OSS 上传失败/);
});
