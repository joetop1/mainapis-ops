import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {compactImageKey,uploadImage} from '../image-storage.mjs';
import {localImageUploader} from '../local-image-upload.mjs';
import {assertCrmebImageLengths,officialCreateReceipt} from '../crmeb-official.mjs';
const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhWQAAAAASUVORK5CYII=','base64'),config={enabled:true,bucket:'examplebucket',region:'cn-hongkong',publicOrigin:'https://img.mainapis.com',accessKeyId:'exampleAccessKeyID',accessKeySecret:'exampleSecretForTestsOnly'};
test('短对象路径满足CRMEB规格图片128字符限制，稳定内容键与空间隔离',()=>{
 for(const ext of ['jpg','png','webp','gif']){const key=compactImageKey('team:example',bytes,ext);assert.ok((config.publicOrigin+'/'+key).length<=128);assert.equal(key,compactImageKey('team:example',bytes,ext));assert.notEqual(key,compactImageKey('another',bytes,ext));}
 assert.throws(()=>assertCrmebImageLengths({images:['https://img.example.com/'+'a'.repeat(150)],skus:[{sku:'x'}]}),/128/);
 assert.doesNotThrow(()=>assertCrmebImageLengths({images:['https://img.example.com/main.jpg'],skus:[{image:'https://img.example.com/sku.jpg'}]}));
 assert.throws(()=>assertCrmebImageLengths({images:['https://img.example.com/main.jpg'],skus:[{image:'https://img.example.com/'+'b'.repeat(150)}]}),/128/);
});
test('旧OPS图片复制为短地址并验证内容，拒绝外部域名和其他空间图片，保留原对象',async()=>{
 const owner='alice',scope=createHash('sha256').update(owner).digest('hex').slice(0,24),original=config.publicOrigin+'/ops/'+scope+'/supplier/old-batch/'+'a'.repeat(64)+'.png';let puts=0;const objects=new Map([[new URL(original).pathname,bytes]]),calls=[];
 const fetchImpl=async(url,options={})=>{calls.push(String(url));if(options.method==='PUT'){puts++;objects.set(new URL(url).pathname,Buffer.from(options.body));return new Response('');}return new Response(objects.get(new URL(url).pathname));};
 const repair=localImageUploader({getStorage:()=>config,allowedStorage:()=>true,fetchImpl});
 await assert.rejects(repair(owner,{sourceUrl:'https://evil.example.com/a.png'}),/当前空间/);await assert.rejects(repair('bob',{sourceUrl:original}),/当前空间/);assert.equal(calls.length,0);
 const result=await repair(owner,{sourceUrl:original});assert.ok(result.url.length<=128);assert.notEqual(result.url,original);assert.equal(puts,1);assert.ok(objects.has(new URL(original).pathname));assert.deepEqual(objects.get(new URL(result.url).pathname),bytes);
 let called=false;await assert.rejects(uploadImage({...config,publicOrigin:'https://'+'a'.repeat(100)+'.example.com'},compactImageKey(owner,bytes,'png'),{bytes,mime:'image/png'},{fetchImpl:async()=>{called=true;}}),/128/);assert.equal(called,false);
});
test('商城image字段超长响应仍标为需核对，不解除创建锁',()=>{const r=officialCreateReceipt({status:400,msg:"SQLSTATE[22001]: Data too long for column 'image' at row 1"});assert.equal(r.status,'unknown');});
