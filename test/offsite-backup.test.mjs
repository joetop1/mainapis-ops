import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {openStore} from '../core.mjs';
import {connectionStore} from '../connection-store.mjs';
import {backupData} from '../backup-data.mjs';
import {sealBackup,unsealBackup,offsiteBackups} from '../offsite-backup.mjs';
import {operationsAlerts} from '../operations-alerts.mjs';
import {operations} from '../operations.mjs';
const config={enabled:true,bucket:'examplebucket',region:'cn-hongkong',accessKeyId:'exampleAccessKey',accessKeySecret:'testSecret1234567890'};
test('备份独立加密、私有上传读回及离线恢复；错密钥与篡改不产生恢复目录',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ops-offsite-')),db=openStore(join(dir,'ops.sqlite')),key=randomBytes(32).toString('base64');let encrypted;
 try{
  (await connectionStore(db,dir)).set('alice',{token:'test-private-token'});const result=await backupData(dir),directory=join(dir,'backups',result.name);
  const remote=offsiteBackups({dataDir:dir,getStorage:()=>config,key,fetchImpl:async(url,options)=>{
   if(options.method==='PUT'){assert.equal(options.headers['x-oss-object-acl'],'private');const chunks=[];for await(const chunk of options.body)chunks.push(chunk);encrypted=Buffer.concat(chunks);assert.equal(encrypted.includes(await readFile(join(dir,'connections.key'))),false);return new Response(null,{status:200});}
   if(new URL(url).searchParams.has('acl'))return new Response('<AccessControlPolicy><Grant>private</Grant></AccessControlPolicy>');return new Response(encrypted);
  }});
  const receipt=await remote(result);assert.match(receipt.object,/^ops-private\/backups\//);assert.equal(receipt.bytes,encrypted.length);
  const file=join(dir,'copy.opsenc');await writeFile(file,encrypted);const output=join(dir,'restored');await unsealBackup(file,output,key);assert.equal((await stat(output)).mode&0o777,0o700);
  const restored=new DatabaseSync(join(output,'ops.sqlite'));try{assert.equal((await connectionStore(restored,output)).get('alice').token,'test-private-token');}finally{restored.close();}
  await assert.rejects(unsealBackup(file,join(dir,'wrong-key'),randomBytes(32).toString('base64')),/校验失败/);await assert.rejects(stat(join(dir,'wrong-key')));
  encrypted[25]^=1;await writeFile(file,encrypted);await assert.rejects(unsealBackup(file,join(dir,'tampered'),key),/校验失败/);await assert.rejects(stat(join(dir,'tampered')));
  const existing=join(dir,'existing');await writeFile(existing,'keep');await assert.rejects(sealBackup(directory,existing,key));assert.equal(await readFile(existing,'utf8'),'keep');
 }finally{db.close();await rm(dir,{recursive:true,force:true});}
});
test('异地上传失败单独记录，本地成功状态保留并一小时退避',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ops-offsite-status-')),db=openStore(join(dir,'ops.sqlite'));try{
  await connectionStore(db,dir);let now=Date.now(),calls=0;const ops=await operations({db,dataDir:dir,root:dir,clock:()=>now,runBackup:async()=>({createdAt:new Date(now).toISOString(),name:'test'}),runOffsite:async()=>{calls++;throw Error('network');}});
  ops.tick();await ops.settled();const status=await ops.status();assert.ok(status.backup.lastSuccess);assert.equal(status.backup.lastError,'');assert.match(status.backup.remote.lastError,/异地/);ops.tick();assert.equal(calls,1);now+=3600001;ops.tick();await ops.settled();assert.equal(calls,2);ops.stop();
 }finally{db.close();await rm(dir,{recursive:true,force:true});}
});
test('运行告警持久去重、限频并发送恢复通知，不发送密钥或自动重发任务',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ops-alerts-'));let now=Date.now(),messages=[];const options={dataDir:dir,webhook:'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=test',clock:()=>now,fetchImpl:async(url,options)=>{messages.push(JSON.parse(options.body).text.content);return new Response('{"errcode":0}');}};
 try{
  const alerts=await operationsAlerts(options),status={health:{ok:true,freeBytes:3*1024**3},worker:{enabled:true,paused:false,online:false},uptime:200,tasks:{stalled:0},backup:{lastError:'',remote:{enabled:false}}};
  await alerts.check(status);assert.equal(messages.length,1);assert.match(messages[0],/Worker/);const reopened=await operationsAlerts(options);await reopened.check(status);assert.equal(messages.length,1);
  now+=3600001;status.worker.online=true;await reopened.check(status);assert.equal(messages.length,2);assert.match(messages[1],/恢复/);now+=3600001;await reopened.check(status);assert.equal(messages.length,2);
  await assert.rejects(operationsAlerts({...options,webhook:'https://example.com/collect?key=test'}));
 }finally{await rm(dir,{recursive:true,force:true});}
});
