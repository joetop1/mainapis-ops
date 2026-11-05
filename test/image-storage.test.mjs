import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {imageStorage,storageConfig,publicStorage,readImage,ossHeaders} from '../image-storage.mjs';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhWQAAAAASUVORK5CYII=','base64');
const config={enabled:true,bucket:'examplebucket',region:'cn-hangzhou',publicOrigin:'https://images.example.com',allowedOrigins:['https://mall.example.com'],accessKeyId:'exampleAccessKeyID',accessKeySecret:'exampleSecretForTestsOnly'};
function fixture(){
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE job_snapshots(job_id TEXT PRIMARY KEY,product TEXT,claimed INTEGER DEFAULT 0);CREATE TABLE jobs(id TEXT PRIMARY KEY,status TEXT,message TEXT,updated TEXT);');
 let settings=null,fail='',puts=0;const objects=new Map(),requests=[];
 const fetchImpl=async(url,options={})=>{requests.push({url,options});if(options.method==='PUT'){puts++;if(fail==='put')return new Response('',{status:403});assert.match(options.headers.authorization,/^OSS4-HMAC-SHA256/);objects.set(new URL(url).pathname,Buffer.from(options.body));return new Response('',{status:200});}if(url.startsWith(config.publicOrigin)){const b=objects.get(new URL(url).pathname);return new Response(fail==='public'?'<html>oops</html>':b,{status:b?200:404});}if(fail==='source'&&url.includes('detail'))return new Response('',{status:403});return new Response(png);};
 const store={get:()=>settings,set:(_key,c)=>settings=c},service=imageStorage({db,store,fetchImpl});
 const product={images:['https://source.example.com/main.jpg'],detail_images:['https://source.example.com/detail.jpg'],skus:[{sku:'x',image:'https://source.example.com/main.jpg'}]};
 const job={id:'task-1',owner:'team-a',mall_connection_id:'mall-a'};
 const record=()=>{db.prepare("INSERT INTO jobs VALUES(?,'dispatching','','')").run(job.id);db.prepare('INSERT INTO job_snapshots(job_id,product) VALUES(?,?)').run(job.id,JSON.stringify(product));service.record(job.id,product,service.prepare('https://mall.example.com'));};
 return {db,service,product,job,record,requests,objects,get puts(){return puts;},set fail(v){fail=v;},close:()=>db.close()};
}
test('存储默认关闭，精确域名授权，配置不回传密钥及非法目标拒绝',()=>{
 const f=fixture();try{assert.equal(f.service.view().enabled,false);assert.equal(f.service.available('https://mall.example.com'),false);assert.throws(()=>f.service.prepare('https://mall.example.com'));f.service.save(config);assert.equal(f.service.available('https://mall.example.com'),true);assert.equal(f.service.available('https://sub.mall.example.com'),false);assert.equal(publicStorage(config).accessKeySecret,undefined);assert.equal(publicStorage(config).accessKeyId,undefined);assert.throws(()=>storageConfig({...config,region:'cn-hangzhou.evil.com'}));assert.throws(()=>storageConfig({...config,allowedOrigins:['http://mall.example.com']}));assert.throws(()=>storageConfig({...config,publicOrigin:'https://127.0.0.1'}));assert.equal(f.service.save({...config,accessKeyId:'',accessKeySecret:''}).credentialsSaved,true);}finally{f.close();}
});
test('转存主图详情SKU去重，原资料不变，所有图片完成后原子替换任务，重复运行不上传',async()=>{
 const f=fixture();try{f.service.save(config);f.record();const original=JSON.stringify(f.product),result=await f.service.transfer(f.job);assert.equal(JSON.stringify(f.product),original);assert.equal(f.puts,2);assert.equal(result.images[0],result.skus[0].image);assert.ok(result.images[0].startsWith(config.publicOrigin+'/ops/'));assert.equal(f.db.prepare('SELECT claimed FROM job_snapshots').get().claimed,0);assert.equal(f.db.prepare('SELECT state FROM image_transfer_jobs').get().state,'done');await f.service.transfer(f.job);assert.equal(f.puts,2);assert.ok(f.requests.every(r=>r.options.redirect==='manual'||r.options.redirect==='error'));}finally{f.close();}
});
test('下载失败不改快照、不领取创建，重试复用已完成文件，禁止换桶续传',async()=>{
 const f=fixture();try{f.service.save(config);f.record();f.fail='source';await assert.rejects(f.service.transfer(f.job),/403/);assert.equal(f.db.prepare('SELECT product FROM job_snapshots').get().product,JSON.stringify(f.product));assert.equal(f.db.prepare('SELECT state FROM image_transfer_jobs').get().state,'pending');assert.equal(f.puts,1);f.fail='';f.service.save({...config,bucket:'anotherbucket'});await assert.rejects(f.service.transfer(f.job),/存储目标已变化/);f.service.save(config);await f.service.transfer(f.job);assert.equal(f.puts,2);}finally{f.close();}
});
test('OSS错误、公开域名不可读和已领取任务阻止转存',async()=>{
 for(const failure of ['put','public']){const f=fixture();try{f.service.save(config);f.record();f.fail=failure;await assert.rejects(f.service.transfer(f.job));assert.equal(f.db.prepare('SELECT product FROM job_snapshots').get().product,JSON.stringify(f.product));assert.equal(f.db.prepare('SELECT COUNT(*) n FROM image_transfer_files').get().n,0);}finally{f.close();}}
 const f=fixture();try{f.service.save(config);f.record();f.db.exec('UPDATE job_snapshots SET claimed=1');await assert.rejects(f.service.transfer(f.job),/已领取/);assert.equal(f.puts,0);}finally{f.close();}
});
test('下载拒绝本地地址重定向、过大文件、HTML和重定向循环，读取不带存储鉴权',async()=>{
 const fetchImpl=async()=>new Response('',{status:302,headers:{location:'https://127.0.0.1/private'}});await assert.rejects(readImage('https://source.example.com/a',{fetchImpl}),/公网/);
 await assert.rejects(readImage('https://source.example.com/a',{fetchImpl:async()=>new Response('x',{headers:{'content-length':String(11*1024*1024)}})}),/10MB/);
 await assert.rejects(readImage('https://source.example.com/a',{fetchImpl:async()=>new Response('<html>fake.jpg</html>')}),/图片内容/);
 await assert.rejects(readImage('https://source.example.com/a',{fetchImpl:async()=>new Response('',{status:302,headers:{location:'/a'}})}),/重定向次数/);
 const h=ossHeaders(config,'ops/a.png','image/png',png,new Date('2026-11-05T00:00:00Z'));assert.equal(h['x-oss-date'],'20261105T000000Z');assert.match(h.authorization,/Credential=exampleAccessKeyID\/20261105\/cn-hangzhou\/oss\/aliyun_v4_request,Signature=[a-f0-9]{64}$/);
});
