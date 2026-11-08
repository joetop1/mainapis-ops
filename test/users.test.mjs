import test from 'node:test';
import {generateKeyPairSync,sign} from 'node:crypto';
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
  users.request('pending','申请人');users.request('pending','申请人');assert.equal(users.list('',1,'pending').total,1);assert.equal(users.detail('pending').events.length,1);assert.equal(users.detail('pending').user.access,'pending');assert.equal(users.detail('pending').user.last_login,'');users.update('admin',{sub:'pending',action:'disable'});users.request('pending','再次申请');assert.equal(users.blocked('pending'),true);assert.equal(users.list('',1,'pending').total,0);
  assert.equal(users.granted('stranger'),false);users.seen('seen','姓名');assert.equal(users.granted('seen'),false);
  users.update('admin',{sub:'member',action:'disable'});assert.equal(users.blocked('member'),true);assert.equal(db.prepare('SELECT COUNT(*) n FROM sessions').get().n,0);
  assert.throws(()=>users.update('admin',{sub:'admin',action:'disable'}),/不能停用/);
  users.update('admin',{sub:'member',action:'enable'});assert.equal(users.granted('member'),true);assert.equal(users.blocked('member'),false);
  const detail=users.detail('member');assert.deepEqual(detail.user.sources,['OPS管理员授权','团队成员']);assert.equal(detail.user.sessions,0);assert.equal(detail.events[0].actor,'admin');assert.equal(detail.events[0].action,'enable');assert.equal(detail.user.access,'enabled');assert.throws(()=>users.detail('missing'),/不存在/);
  db.prepare('INSERT INTO sessions VALUES(?,?,?)').run('sensitive-session-token',JSON.stringify({user:{sub:'member'},csrf:'secret-csrf'}),Date.now()+10000);assert.equal(users.detail('member').user.sessions,1);assert.equal(JSON.stringify(users.detail('member')).includes('secret-csrf'),false);assert.equal(JSON.stringify(users.detail('member')).includes('sensitive-session-token'),false);
  assert.throws(()=>users.update('admin',{sub:'member',action:'role',role:'editor'}),/至少一位/);assert.equal(db.prepare("SELECT role FROM team_members WHERE sub='member'").get().role,'admin');
  db.prepare("INSERT INTO team_members VALUES('other','team','admin',1)").run();users.update('admin',{sub:'member',action:'role',role:'editor'});assert.equal(db.prepare("SELECT role FROM team_members WHERE sub='member'").get().role,'editor');
  assert.equal(users.list('测试团队').total,2);assert.equal(users.list('%').total,0);assert.equal(users.list('姓名').items[0].sub,'seen');
  for(let i=0;i<25;i++)users.update('admin',{sub:'user'+i,action:'enable'});assert.equal(users.list('',1).items.length,20);assert.ok(users.list('',2).items.length>0);
  assert.ok(db.prepare('SELECT COUNT(*) n FROM ops_user_events').get().n>=28);
 }finally{db.close();await rm(dir,{recursive:true,force:true});}
});
test('用户管理API仅系统管理员可访问，写操作需要CSRF，停用阻断旧会话',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ops-users-api-'));Object.assign(process.env,{DATA_DIR:dir,APP_ORIGIN:'https://ops.mainapis.com',DEMO_MODE:'false',ALLOWED_SUBJECTS:'root,normal',SYSTEM_ADMIN_SUBJECTS:'root',CASDOOR_CLIENT_ID:'test-client',CASDOOR_CLIENT_SECRET:'test-secret'});
 const {handler,closeStore}=await import('../server.mjs'),db=openStore(join(dir,'ops.sqlite'));
 for(const sub of ['root','normal'])db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(sub,JSON.stringify({user:{sub},csrf:'csrf'}),Date.now()+60000);
 const call=async(sub,path,method='GET',input={},csrf='csrf')=>{const req=Readable.from(method==='GET'?[]:[Buffer.from(JSON.stringify(input))]);Object.assign(req,{url:path,method,headers:{cookie:'ops_session='+sub,origin:'https://ops.mainapis.com','x-csrf-token':csrf,'content-type':'application/json'}});const res={headers:{},setHeader(k,v){this.headers[k]=v;},writeHead(status,headers={}){this.status=status;Object.assign(this.headers,headers);},end(data){this.data=data?JSON.parse(data):null;}};await handler(req,res);return res;};
 try{
  assert.equal((await call('normal','/api/users')).status,403);assert.equal((await call('normal','/api/users?sub=root')).status,403);assert.equal((await call('root','/api/users?sub=normal')).data.user.sub,'normal');assert.equal((await call('root','/api/users')).status,200);
  assert.equal((await call('root','/api/users','POST',{sub:'normal',action:'disable'},'wrong')).status,403);
  assert.equal((await call('root','/api/users','POST',{sub:'normal',action:'disable'})).status,200);assert.equal((await call('normal','/api/products')).status,401);
  db.prepare('INSERT INTO sessions VALUES(?,?,?)').run('old',JSON.stringify({user:{sub:'normal'},csrf:'csrf'}),Date.now()+60000);assert.equal((await call('old','/api/me')).status,403);
  assert.equal((await call('root','/api/users','POST',{sub:'new-user',action:'enable'})).status,200);assert.equal(db.prepare("SELECT granted FROM ops_users WHERE sub='new-user'").get().granted,1);
  assert.equal((await call('root','/api/users','POST',{sub:'root',action:'disable'})).status,400);
  const originalFetch=globalThis.fetch,{privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048}),issuer='https://auth.mainapis.com';
  let tokenNonce='invalid';const encode=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
  globalThis.fetch=async url=>{let data;if(String(url).endsWith('/.well-known/openid-configuration'))data={issuer,authorization_endpoint:issuer+'/authorize',token_endpoint:issuer+'/token',jwks_uri:issuer+'/keys'};else if(String(url).endsWith('/keys'))data={keys:[{...publicKey.export({format:'jwk'}),kid:'test'}]};else {const payload=encode({alg:'RS256',kid:'test'})+'.'+encode({iss:issuer,aud:'test-client',sub:'applicant',name:'申请人',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+300,nonce:tokenNonce});data={id_token:payload+'.'+sign('RSA-SHA256',Buffer.from(payload),privateKey).toString('base64url')};}return new Response(JSON.stringify(data));};
  try{
   const pending=()=>db.prepare('INSERT INTO sessions VALUES(?,?,?)').run('login-state',JSON.stringify({state:'state',nonce:'nonce',verifier:'verifier'}),Date.now()+60000);
   pending();assert.equal((await call('login-state','/auth/callback?state=state&code=code')).status,400);assert.equal(db.prepare("SELECT COUNT(*) n FROM ops_users WHERE sub='applicant'").get().n,0);
   tokenNonce='nonce';pending();const application=await call('login-state','/auth/callback?state=state&code=code');assert.equal(application.status,302);assert.equal(application.headers.Location,'/?access=pending');assert.equal(db.prepare("SELECT granted FROM ops_users WHERE sub='applicant'").get().granted,0);assert.equal((await call('root','/api/users?filter=pending')).data.total,1);
   assert.equal(db.prepare('SELECT data FROM sessions').all().some(r=>JSON.parse(r.data).user?.sub==='applicant'),false);
   await call('root','/api/users','POST',{sub:'applicant',action:'enable'});pending();assert.equal((await call('login-state','/auth/callback?state=state&code=code')).headers.Location,'/');assert.equal(db.prepare('SELECT data FROM sessions').all().some(r=>JSON.parse(r.data).user?.sub==='applicant'),true);
  }finally{globalThis.fetch=originalFetch;}

 }finally{db.close();closeStore();await rm(dir,{recursive:true,force:true});}
});
