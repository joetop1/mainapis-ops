import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {openStore} from '../core.mjs';
import {mallConnections,MALL_SYSTEMS} from '../mall-connections.mjs';
import {connectionStore} from '../connection-store.mjs';
import {teamStore} from '../teams.mjs';
test('旧数据库升级自动备份、历史任务绑定稳定连接，重复迁移不改变回执快照',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ops-mall-migrate-')),path=join(dir,'ops.sqlite');
 let db=new DatabaseSync(path);
 db.exec(`CREATE TABLE jobs(id TEXT PRIMARY KEY,owner TEXT NOT NULL,product_id TEXT NOT NULL,revision INTEGER NOT NULL,target TEXT NOT NULL,status TEXT NOT NULL,token TEXT NOT NULL,message TEXT NOT NULL,remote_id TEXT NOT NULL,created TEXT NOT NULL,updated TEXT NOT NULL);
 INSERT INTO jobs VALUES('old-job','alice','p',6,'yunzhong','succeeded','private-token','ok','18','then','then');`);db.close();
 try{
  db=openStore(path);const profiles=await connectionStore(db,dir,'profiles');profiles.set('alice',{yunzhong:{name:'旧商城'}});
  const m=mallConnections(db,profiles);m.ensure('alice');const row=m.get('alice',null,'yunzhong');
  const before=db.prepare('SELECT * FROM jobs').get();assert.equal(before.mall_connection_id,row.id);assert.equal(before.remote_id,'18');assert.equal(before.token,'private-token');assert.equal(before.status,'succeeded');assert.equal(row.name,'旧商城');
  m.ensure('alice');assert.deepEqual(db.prepare('SELECT * FROM jobs').get(),before);assert.equal(m.list('alice').length,Object.keys(MALL_SYSTEMS).length);
  const files=await readdir(dir);assert.equal(files.filter(f=>f.includes('.pre-mall-connections-')).length,1);
  const backup=new DatabaseSync(join(dir,files.find(f=>f.includes('.pre-mall-connections-'))));assert.equal(backup.prepare('SELECT remote_id FROM jobs').get().remote_id,'18');assert.equal(backup.prepare('PRAGMA table_info(jobs)').all().some(r=>r.name==='mall_connection_id'),false);backup.close();
 }finally{db.close();await rm(dir,{recursive:true,force:true});}
});
test('同系统连接ID和密钥scope独立，迁入团队后ID和新增连接密钥保持稳定',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ops-mall-team-')),db=openStore(':memory:');
 try{
  const profiles=await connectionStore(db,dir,'profiles'),credentials=await connectionStore(db,dir,'yunzhong'),m=mallConnections(db,profiles);
  const a=m.create('alice','yunzhong','A'),b=m.create('alice','yunzhong','B');assert.notEqual(a.id,b.id);credentials.set(m.scope(a),{appsecret:'a'});credentials.set(m.scope(b),{appsecret:'b'});
  assert.throws(()=>m.get('bob',a.id,'yunzhong'));assert.throws(()=>m.get('alice',a.id,'tigshop'));
  const old=m.get('alice',null,'yunzhong');const team=teamStore(db).create('alice','团队',[profiles,credentials],m.moveOwner);
  assert.equal(m.get(team.id,null,'yunzhong').id,old.id);assert.equal(m.get(team.id,a.id).id,a.id);assert.equal(credentials.get(m.scope(m.get(team.id,a.id))).appsecret,'a');assert.equal(credentials.get(m.scope(m.get(team.id,b.id))).appsecret,'b');
  assert.throws(()=>m.get('alice',a.id));
 }finally{db.close();await rm(dir,{recursive:true,force:true});}
});
test('商城单字标识持久保存且隔离连接，非法标识不修改名称',()=>{
 const db=openStore(':memory:');try{
  const m=mallConnections(db),a=m.create('alice','shopxo','小蓝'),b=m.create('alice','shopxo','另一家');
  m.rename('alice',a.id,'小蓝有品','蓝');assert.equal(m.get('alice',a.id).badge,'蓝');assert.equal(m.get('alice',b.id).badge,'');
  assert.equal(mallConnections(db).get('alice',a.id).badge,'蓝');
  assert.throws(()=>m.rename('alice',a.id,'错误名称','两个'));assert.equal(m.get('alice',a.id).name,'小蓝有品');
  m.rename('alice',a.id,'改名');assert.equal(m.get('alice',a.id).badge,'蓝');m.rename('alice',a.id,'改名','');assert.equal(m.get('alice',a.id).badge,'');
 }finally{db.close();}
});
