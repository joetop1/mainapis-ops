import test from 'node:test';
import assert from 'node:assert/strict';
import {gunzipSync} from 'node:zlib';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {createYunzhongPackage} from '../yunzhong-package.mjs';
import {openStore} from '../core.mjs';
test('芸众下载包可解压、安装更新依赖完整且内容精确对应受控源码',async()=>{
 const dir=new URL('../integrations/yunzhong/ops-bridge/',import.meta.url).pathname;
 const r=await createYunzhongPackage(dir),tar=gunzipSync(r.bytes),names=[];
 assert.equal(r.sha256,createHash('sha256').update(r.bytes).digest('hex'));
 for(let pos=0;tar[pos];){
  const h=tar.subarray(pos,pos+512),name=h.subarray(0,100).toString().split('\0')[0],size=parseInt(h.subarray(124,136).toString(),8);
  const checksum=parseInt(h.subarray(148,156).toString(),8),copy=Buffer.from(h);copy.fill(32,148,156);assert.equal(checksum,copy.reduce((a,b)=>a+b,0));
  assert.deepEqual(tar.subarray(pos+512,pos+512+size),await readFile(join(dir,name)));names.push(name);pos+=512+Math.ceil(size/512)*512;
 }
 assert.deepEqual(names.sort(),['Bridge.php','MainapisOpsController.php','Compatibility.php','reviewed-sources.json','entry.php','config.php','install.php','apply-update.php','INSTALL.md'].sort());
 assert.match(r.filename,/^mainapis-yunzhong-bridge-\d+\.\d+\.\d+\.tar\.gz$/);
});
test('芸众扩展下载和说明要求登录，元数据不包含密钥',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ops-yunzhong-download-'));Object.assign(process.env,{DATA_DIR:dir,APP_ORIGIN:'https://ops.mainapis.com',DEMO_MODE:'false'});
 const {handler,closeStore}=await import('../server.mjs'),db=openStore(join(dir,'ops.sqlite'));
 db.prepare('INSERT INTO sessions VALUES(?,?,?)').run('download-user',JSON.stringify({user:{sub:'download-user'},csrf:'csrf'}),Date.now()+60000);
 const call=async(path,loggedIn)=>{const res={status:200,setHeader(){},writeHead(s,h){this.status=s;this.headers=h;},end(b){this.body=b;}};await handler({url:path,method:'GET',headers:{cookie:loggedIn?'ops_session=download-user':''}},res);return res;};
 try{
  for(const suffix of ['', '/download','/guide'])assert.equal((await call('/api/extensions/yunzhong-bridge'+suffix,false)).status,401);
  const metadata=JSON.parse((await call('/api/extensions/yunzhong-bridge',true)).body);assert.match(metadata.sha256,/^[a-f0-9]{64}$/);assert.equal(metadata.appsecret,undefined);
  const file=await call(metadata.downloadUrl,true);assert.equal(file.status,200);assert.equal(file.headers['Content-Type'],'application/gzip');assert.ok(gunzipSync(file.body).length>0);
  assert.match((await call('/api/extensions/yunzhong-bridge/guide',true)).body.toString(),/首次安装/);
 }finally{db.close();closeStore();await rm(dir,{recursive:true,force:true});}
});
