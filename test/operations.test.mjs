import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile,readdir,stat,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {openStore} from '../core.mjs';
import {connectionStore} from '../connection-store.mjs';
import {backupData,verifyBackup} from '../backup-data.mjs';
import {operations,readiness,inspectTasks} from '../operations.mjs';
test('在线WAL备份包含数据库和原解密密钥，校验后可解密连接，不修改原数据',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ops-backup-')),db=openStore(join(dir,'ops.sqlite'));try{
 const store=await connectionStore(db,dir);store.set('alice',{token:'private-value'});db.prepare('INSERT INTO products VALUES(?,?,?,?,?,?,?,?)').run('p','alice','url','{}','draft',1,'now','now');const original=await readFile(join(dir,'connections.key'));
 const result=await backupData(dir),path=join(dir,'backups',result.name);await verifyBackup(path);assert.equal((await stat(join(path,'connections.key'))).mode&0o777,0o600);assert.equal((await stat(path)).mode&0o777,0o700);
 const restored=new DatabaseSync(join(path,'ops.sqlite'));assert.equal((await connectionStore(restored,path)).get('alice').token,'private-value');assert.equal(restored.prepare('SELECT count(*) n FROM products').get().n,1);restored.close();assert.deepEqual(await readFile(join(dir,'connections.key')),original);assert.equal(db.prepare('SELECT count(*) n FROM products').get().n,1);
 await writeFile(join(path,'connections.key'),randomBytes(32));await assert.rejects(verifyBackup(path),/校验失败/);
 }finally{db.close();await rm(dir,{recursive:true,force:true});}
});
test('保留策略只清理本模块已校验的旧备份，保留无关文件',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ops-retain-')),db=openStore(join(dir,'ops.sqlite'));try{
 await connectionStore(db,dir);await mkdir(join(dir,'backups','user-files'),{recursive:true});await writeFile(join(dir,'backups','user-files','important'),'keep');
 for(let day=1;day<=3;day++)await backupData(dir,{keep:2,now:new Date('2026-11-0'+day+'T00:00:00Z')});
 assert.equal((await readdir(join(dir,'backups'))).filter(n=>n.startsWith('backup-')).length,2);assert.equal(await readFile(join(dir,'backups','user-files','important'),'utf8'),'keep');
 }finally{db.close();await rm(dir,{recursive:true,force:true});}
});
test('巡检仅统计超时和待核对任务，绝不释放创建锁或重发；健康检查验证数据卷',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ops-readiness-')),db=openStore(join(dir,'ops.sqlite'));try{
 await connectionStore(db,dir);db.prepare('INSERT INTO products VALUES(?,?,?,?,?,?,?,?)').run('p','alice','url','{}','draft',1,'now','now');const insert=db.prepare('INSERT INTO jobs(id,owner,product_id,revision,target,status,token,created,updated) VALUES(?,?,?,?,?,?,?,?,?)');for(const [id,status] of [['a','accepted'],['b','unknown'],['c','succeeded']])insert.run(id,'alice','p',id==='a'?1:id==='b'?2:3,'crmeb-pro',status,'t','2026-01-01','2026-01-01');
 const before=db.prepare('SELECT * FROM jobs').all();assert.deepEqual(inspectTasks(db,Date.parse('2026-11-07T00:00:00Z')),{stalled:1,review:1});assert.deepEqual(db.prepare('SELECT * FROM jobs').all(),before);assert.equal((await readiness(db,dir)).ok,true);await writeFile(join(dir,'connections.key'),'broken');assert.equal((await readiness(db,dir)).ok,false);
 }finally{db.close();await rm(dir,{recursive:true,force:true});}
});
test('备份调度去重、失败退避并记录可读状态，重启保留最近成功时间',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ops-schedule-')),db=openStore(join(dir,'ops.sqlite'));try{
 await connectionStore(db,dir);let calls=0,now=Date.parse('2026-11-07T00:00:00Z');const opts={db,dataDir:dir,root:dir,clock:()=>now,runBackup:async()=>{calls++;return {createdAt:new Date(now).toISOString()};}};
 const ops=await operations(opts);ops.tick();assert.equal(ops.start(),false);await ops.settled();ops.tick();assert.equal(calls,1);assert.equal((await ops.status()).backup.lastSuccess,new Date(now).toISOString());const reopened=await operations(opts);reopened.tick();assert.equal(calls,1);
 now+=25*3600000;const fail=await operations({...opts,runBackup:async()=>{calls++;throw Error('failed');}});fail.tick();await fail.settled();assert.match((await fail.status()).backup.lastError,/备份失败/);fail.tick();assert.equal(calls,2);fail.stop();assert.equal(fail.start(),false);
 }finally{db.close();await rm(dir,{recursive:true,force:true});}
});
