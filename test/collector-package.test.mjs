import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {createCollectorPackage} from '../collector-package.mjs';
import {openStore} from '../core.mjs';
import {teamStore} from '../teams.mjs';

test('采集包包含当前插件全部依赖、可解压路径与动态版本，不包含运营凭证',async()=>{
 const directory=new URL('../extensions/1688-collector/',import.meta.url).pathname;
 const release=await createCollectorPackage(directory),b=release.bytes;
 assert.equal(release.sha256,createHash('sha256').update(b).digest('hex'));
 const manifest=JSON.parse(await readFile(join(directory,'manifest.json'),'utf8'));
 assert.equal(release.version,manifest.version);assert.equal(release.filename,'mainapis-1688-collector-'+manifest.version+'.zip');
 const names=[];let pos=0;
 while(b.readUInt32LE(pos)===0x04034b50){
  const length=b.readUInt32LE(pos+18),nameLength=b.readUInt16LE(pos+26),extra=b.readUInt16LE(pos+28),name=b.subarray(pos+30,pos+30+nameLength).toString();
  assert.ok(name.startsWith('mainapis-1688-collector/'));assert.equal(name.includes('..'),false);
  const localName=name.split('/')[1];names.push(localName);const start=pos+30+nameLength+extra;
  assert.deepEqual(b.subarray(start,start+length),await readFile(join(directory,localName)));pos=start+length;
 }
 assert.equal(b.readUInt32LE(pos),0x02014b50);assert.equal(b.readUInt32LE(b.length-22),0x06054b50);
 assert.deepEqual(names.sort(),['README.md','version-bridge.js','collector.js','manifest.json','merchant-images.js','popup.css','popup.html','popup.js'].sort());
});
test('登录团队编辑员可下载，未登录及停用成员被拒绝；下载不开放商城凭证',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ops-collector-download-'));Object.assign(process.env,{DATA_DIR:dir,APP_ORIGIN:'https://ops.mainapis.com',DEMO_MODE:'false'});
 const {handler,closeStore}=await import('../server.mjs'),db=openStore(join(dir,'ops.sqlite'));
 const teams=teamStore(db);teams.create('alice','采集团队',[]);teams.setMember('alice','bob','editor');
 for(const sub of ['alice','bob'])db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(sub,JSON.stringify({user:{sub},csrf:'csrf'}),Date.now()+60000);
 const call=async(path,user='bob')=>{
  const req={url:path,method:'GET',headers:{cookie:'ops_session='+user}},headers={};
  const res={status:200,setHeader(k,v){headers[k]=v;},writeHead(s,h={}){this.status=s;Object.assign(headers,h);},end(b){this.body=b;}};
  await handler(req,res);return {status:res.status,body:res.body,headers};
 };
 try{
  assert.equal((await call('/api/extensions/1688-collector','')).status,401);
  const info=await call('/api/extensions/1688-collector');assert.equal(info.status,200);const metadata=JSON.parse(info.body);assert.ok(metadata.version);
  const download=await call(metadata.downloadUrl);assert.equal(download.status,200);assert.equal(download.headers['Content-Type'],'application/zip');assert.equal(download.headers['Content-Length'],download.body.length);assert.ok(download.headers['Content-Disposition'].includes(metadata.version));assert.equal(download.body.readUInt32LE(0),0x04034b50);
  assert.equal((await call('/api/connections/crmeb-pro/auth')).status,403);
  teams.setMember('alice','bob','editor',0);assert.equal((await call(metadata.downloadUrl)).status,403);
 }finally{db.close();closeStore();await rm(dir,{recursive:true,force:true});}
});
