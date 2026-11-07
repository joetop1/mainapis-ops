import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {workbookUploads,ossBrowserOrigin,ossSignedURL,ossRequest,PART_BYTES,MAX_WORKBOOK_BYTES} from '../oss-multipart.mjs';
const c={enabled:true,bucket:'examplebucket',region:'cn-hongkong',publicOrigin:'https://img.example.com',accessKeyId:'exampleAccessKey',accessKeySecret:'exampleSecret1234567890'};
test('OSS分片URL限于对象、编号、有效期与请求方法，不泄露Secret',()=>{
 const now=new Date('2026-11-07T01:02:03Z'),headers={'content-type':'application/octet-stream'};
 const url=ossSignedURL(c,'ops-private/workbooks/alice/file.xlsx','PUT',{partNumber:'1',uploadId:'abc'},headers,now),u=new URL(url);
 assert.equal(u.hostname,'examplebucket.oss-cn-hongkong.aliyuncs.com');assert.equal(u.searchParams.get('x-oss-expires'),'900');assert.equal(u.searchParams.get('x-oss-date'),'20261107T010203Z');assert.equal(url.includes(c.accessKeySecret),false);
 assert.notEqual(url,ossSignedURL(c,'ops-private/workbooks/alice/file.xlsx','PUT',{partNumber:'2',uploadId:'abc'},headers,now));assert.notEqual(url,ossSignedURL(c,'ops-private/workbooks/alice/file.xlsx','GET',{partNumber:'1',uploadId:'abc'},headers,now));
});
test('私有分片上传隔离、合并响应丢失重试、完整性与单次入队',async()=>{
 const db=new DatabaseSync(':memory:');let exists=false,acl='private',size=PART_BYTES+1,enqueues=0,completes=0,allowed=true;const calls=[];
 const fetchImpl=async(url,options)=>{const u=new URL(url);calls.push({u,...options});
  if(options.method==='POST'&&u.searchParams.has('uploads')){assert.equal(options.headers['x-oss-object-acl'],'private');return new Response('<InitiateMultipartUploadResult><UploadId>upload-1</UploadId></InitiateMultipartUploadResult>');}
  if(options.method==='HEAD')return new Response(null,{status:exists?200:404,headers:{'content-length':String(size)}});
  if(options.method==='POST'){completes++;exists=true;return new Response('<CompleteMultipartUploadResult/>');}
  if(options.method==='GET')return new Response('<AccessControlPolicy><AccessControlList><Grant>'+acl+'</Grant></AccessControlList></AccessControlPolicy>');
  return new Response(null,{status:204});
 };
 const service=workbookUploads({db,getStorage:()=>c,allowedStorage:()=>allowed,fetchImpl,enqueueRemote:async()=>{enqueues++;return {id:'batch'};}});
 try{
  await assert.rejects(service.create('alice',{supplier:'供应商',filename:'x.xlsx',size:MAX_WORKBOOK_BYTES+1}),/500MB/);
  const upload=await service.create('alice',{supplier:'供应商',filename:'x.xlsx',size});
  assert.throws(()=>service.sign('bob',upload.id,1),/不属于/);assert.throws(()=>service.sign('alice',upload.id,3),/编号/);assert.throws(()=>service.sign('alice',upload.id,0),/编号/);assert.match(service.sign('alice',upload.id,1).url,/partNumber=1/);
  allowed=false;assert.throws(()=>service.sign('alice',upload.id,1),/授权/);allowed=true;
  const parts=[{number:1,etag:'"'+'a'.repeat(32)+'"'},{number:2,etag:'b'.repeat(32)}];
  await assert.rejects(service.complete('alice',upload.id,{parts:parts.slice(0,1)}),/不完整/);
  acl='public-read';await assert.rejects(service.complete('alice',upload.id,{parts}),/私有/);assert.equal(enqueues,0);assert.equal(completes,1);
  acl='private';assert.deepEqual(await service.complete('alice',upload.id,{parts}),{id:'batch'});assert.equal(completes,1);assert.equal(enqueues,1);await service.complete('alice',upload.id,{parts});assert.equal(enqueues,1);
  assert.throws(()=>service.sign('alice',upload.id,1),/状态|结束/);
  const second=await service.create('alice',{supplier:'供应商',filename:'x.xlsx',size});await service.cancel('alice',second.id);assert.equal(calls.at(-1).method,'DELETE');
 }finally{db.close();}
});

test('后台OSS错误显示安全错误码与阶段，不泄露签名响应内容',async()=>{
 await assert.rejects(ossRequest(c,'ops-private/workbooks/file.xlsx','POST',{uploads:''},{},undefined,async()=>new Response('<Error><Code>AccessDenied</Code><RequestId>TEST123</RequestId><StringToSign>PRIVATE-SIGNING-DETAIL</StringToSign></Error>',{status:403})),error=>error.message.includes('初始化分片')&&error.message.includes('AccessDenied')&&error.message.includes('TEST123')&&!error.message.includes('PRIVATE-SIGNING-DETAIL'));
});

test('OSS V4空值子资源签名按官方SDK规则省略等号',()=>{
 // Canonical query rule: aliyun/alibabacloud-oss-python-sdk-v2 signer/v4.py,
 // _calc_canonical_request omits '=' when a query value is empty.
 // Fixed digest independently reproduced with Python hashlib/hmac.
 const url=ossSignedURL(c,'ops-private/workbooks/test.xlsx','POST',{uploads:''},{'x-oss-object-acl':'private'},new Date('2026-11-07T01:02:03Z'));
 assert.match(url,/\?uploads&/);assert.doesNotMatch(url,/uploads=/);
 assert.equal(new URL(url).searchParams.get('x-oss-signature'),'507ad14aae285c67640f3f84f96c69d944f1ed92d99d1fbfa55096ae2e6fad4e');
 const acl=ossSignedURL(c,'ops-private/workbooks/test.xlsx','GET',{acl:''},{},new Date('2026-11-07T01:02:03Z'));assert.match(acl,/\?acl&/);
});

test('页面只放行已启用且有效的OSS桶域名，阻止CSP注入',()=>{
 assert.equal(ossBrowserOrigin(c),'https://examplebucket.oss-cn-hongkong.aliyuncs.com');
 assert.equal(ossBrowserOrigin({...c,enabled:false}),'');assert.equal(ossBrowserOrigin(null),'');
 assert.equal(ossBrowserOrigin({...c,bucket:"evil; connect-src *"}),'');assert.equal(ossBrowserOrigin({...c,region:"cn-hongkong; script-src *"}),'');
});
