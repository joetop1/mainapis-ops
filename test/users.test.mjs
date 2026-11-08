import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {openStore} from '../core.mjs';
import {teamStore} from '../teams.mjs';
import {userDirectory} from '../users.mjs';
test('用户访问授权、停用立即撤销会话、管理员与团队最后管理员保护、审计分页',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ops-users-')),db=openStore(join(dir,'test.sqlite'));teamStore(db);
 db.prepare("INSERT INTO teams VALUES('team','测试团队','admin','now')").run();db.prepare("INSERT INTO team_members VALUES('member','team','admin',1)").run();db.prepare('INSERT INTO sessions VALUES(?,?,?)').run('session',JSON.stringify({user:{sub:'member',name:'成员'}}),Date.now()+10000);
 const users=userDirectory({db,allowed:['admin'],isSystemAdmin:s=>s==='admin'});
 try{
  assert.equal(users.granted('stranger'),false);users.seen('seen','姓名');assert.equal(users.granted('seen'),false);
  users.update('admin',{sub:'member',action:'disable'});assert.equal(users.blocked('member'),true);assert.equal(db.prepare('SELECT COUNT(*) n FROM sessions').get().n,0);
  assert.throws(()=>users.update('admin',{sub:'admin',action:'disable'}),/不能停用/);
  users.update('admin',{sub:'member',action:'enable'});assert.equal(users.granted('member'),true);assert.equal(users.blocked('member'),false);
  assert.throws(()=>users.update('admin',{sub:'member',action:'role',role:'editor'}),/至少一位/);assert.equal(db.prepare("SELECT role FROM team_members WHERE sub='member'").get().role,'admin');
  db.prepare("INSERT INTO team_members VALUES('other','team','admin',1)").run();users.update('admin',{sub:'member',action:'role',role:'editor'});assert.equal(db.prepare("SELECT role FROM team_members WHERE sub='member'").get().role,'editor');
  assert.equal(users.list('测试团队').total,2);assert.equal(users.list('%').total,0);assert.equal(users.list('姓名').items[0].sub,'seen');
  for(let i=0;i<25;i++)users.update('admin',{sub:'user'+i,action:'enable'});assert.equal(users.list('',1).items.length,20);assert.ok(users.list('',2).items.length>0);
  assert.ok(db.prepare('SELECT COUNT(*) n FROM ops_user_events').get().n>=28);
 }finally{db.close();await rm(dir,{recursive:true,force:true});}
});
test('用户管理API仅系统管理员可访问，写操作需要CSRF，停用阻断旧会话',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ops-users-api-'));Object.assign(process.env,{DATA_DIR:dir,APP_ORIGIN:'https://ops.mainapis.com',DEMO_MODE:'false',ALLOWED_SUBJECTS:'root,normal',SYSTEM_ADMIN_SUBJECTS:'root'});
 const {handler,closeStore}=await import('../server.mjs'),db=openStore(join(dir,'ops.sqlite'));
 for(const sub of ['root','normal'])db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(sub,JSON.stringify({user:{sub},csrf:'csrf'}),Date.now()+60000);
 const call=async(sub,path,method='GET',input={},csrf='csrf')=>{const req=Readable.from(method==='GET'?[]:[Buffer.from(JSON.stringify(input))]);Object.assign(req,{url:path,method,headers:{cookie:'ops_session='+sub,origin:'https://ops.mainapis.com','x-csrf-token':csrf,'content-type':'application/json'}});const res={setHeader(){},writeHead(status){this.status=status;},end(data){this.data=JSON.parse(data);}};await handler(req,res);return res;};
 try{
  assert.equal((await call('normal','/api/users')).status,403);assert.equal((await call('root','/api/users')).status,200);
  assert.equal((await call('root','/api/users','POST',{sub:'normal',action:'disable'},'wrong')).status,403);
  assert.equal((await call('root','/api/users','POST',{sub:'normal',action:'disable'})).status,200);assert.equal((await call('normal','/api/products')).status,401);
  db.prepare('INSERT INTO sessions VALUES(?,?,?)').run('old',JSON.stringify({user:{sub:'normal'},csrf:'csrf'}),Date.now()+60000);assert.equal((await call('old','/api/me')).status,403);
  assert.equal((await call('root','/api/users','POST',{sub:'new-user',action:'enable'})).status,200);assert.equal(db.prepare("SELECT granted FROM ops_users WHERE sub='new-user'").get().granted,1);
  assert.equal((await call('root','/api/users','POST',{sub:'root',action:'disable'})).status,400);
 }finally{db.close();closeStore();await rm(dir,{recursive:true,force:true});}
});
