import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {billingStore} from '../billing.mjs';
import {openStore} from '../core.mjs';
test('钱包整数计量、并发连接幂等、冻结与结算退款、不可改写流水及空间隔离',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ops-ledger-')),db=new DatabaseSync(join(dir,'wallet.sqlite'));db.exec('PRAGMA busy_timeout=5000');const other=new DatabaseSync(join(dir,'wallet.sqlite'));other.exec('PRAGMA busy_timeout=5000');
 const store=billingStore(db,{legacyOwners:['internal']}),second=billingStore(other,{legacyOwners:['new']});
 try{
  assert.equal(store.view('internal').account.exempt,true);assert.equal(store.view('new').account.exempt,false);assert.equal(store.view('team').enabled,false);
  const credit={owner:'team',actor:'admin',amount:100,key:'credit-1',reason:'人工确认'};store.credit(credit);assert.equal(second.credit(credit).duplicate,true);assert.equal(store.receipt('credit-1').points,100);assert.equal(store.receipt('missing'),null);assert.equal(store.view('team').account.available,100);assert.throws(()=>store.credit({...credit,amount:101}),/不同账务/);
  for(const amount of [0,-1,1.5,NaN,Infinity,1000000001])assert.throws(()=>store.credit({...credit,key:'bad',amount}));
  const hold={id:'job-1',owner:'team',actor:'alice',amount:30,reference:'job:1:publish',rate:{version:1,unit:30}};store.reserve(hold);assert.equal(second.reserve(hold).duplicate,true);assert.equal(store.view('team').account.available,70);assert.equal(store.view('team').account.frozen,30);
  assert.throws(()=>second.reserve({...hold,id:'new-id'}));assert.equal(store.view('team').account.available,70);assert.throws(()=>store.reserve({...hold,id:'big',reference:'job:2',amount:71}),/不足/);assert.equal(store.view('team').account.frozen,30);
  assert.throws(()=>store.finish({id:'job-1',owner:'other-team',actor:'worker',action:'settle',reason:'完成'}),/不存在/);
  const settle={id:'job-1',owner:'team',actor:'worker',action:'settle',reason:'核对通过'};store.finish(settle);assert.equal(second.finish(settle).duplicate,true);assert.equal(store.view('team').account.frozen,0);assert.throws(()=>store.finish({...settle,action:'release'}),/状态冲突/);
  store.finish({...settle,action:'refund',reason:'人工核对退款'});second.finish({...settle,action:'refund',reason:'人工核对退款'});assert.equal(store.view('team').account.available,100);
  const before=store.view('team').total;assert.throws(()=>db.prepare("UPDATE billing_ledger SET points=1 WHERE owner='team'").run(),/不可修改/);assert.throws(()=>db.prepare("DELETE FROM billing_ledger WHERE owner='team'").run(),/不可删除/);assert.equal(store.view('team').total,before);assert.equal(store.view('other-team').total,0);
  store.reserve({...hold,id:'job-release',reference:'job:3'});store.finish({id:'job-release',owner:'team',actor:'worker',action:'release',reason:'明确未创建'});assert.equal(store.view('team').account.available,100);assert.equal(store.view('team').account.frozen,0);
 }finally{other.close();db.close();await rm(dir,{recursive:true,force:true});}
});
test('账本与钱包跨重启一致，流水分页保存操作者和价格快照',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ops-wallet-restart-')),path=join(dir,'wallet.sqlite');let db=new DatabaseSync(path);
 try{
  let store=billingStore(db);for(let i=0;i<25;i++)store.credit({owner:'team',actor:'admin',amount:2,key:'key-'+i,reason:'赠送'});store.reserve({id:'job',owner:'team',actor:'editor',amount:10,reference:'task',rate:{unit:10,version:'v1'}});db.close();db=new DatabaseSync(path);store=billingStore(db);assert.equal(store.view('team').account.available,40);assert.equal(store.view('team').account.frozen,10);assert.equal(store.view('team',1).entries.length,20);assert.equal(store.view('team',2).entries.length,6);assert.deepEqual(JSON.parse(db.prepare("SELECT rate_snapshot FROM billing_holds WHERE id='job'").get().rate_snapshot),{unit:10,version:'v1'});
 }finally{db.close();await rm(dir,{recursive:true,force:true});}
});
test('团队钱包API隔离和系统管理员入账权限，禁止越权、CSRF和错误目标',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ops-wallet-api-'));Object.assign(process.env,{DATA_DIR:dir,APP_ORIGIN:'https://ops.mainapis.com',DEMO_MODE:'false',ALLOWED_SUBJECTS:'root,alice,bob',SYSTEM_ADMIN_SUBJECTS:'root'});
 const {handler,closeStore}=await import('../server.mjs'),db=openStore(join(dir,'ops.sqlite'));
 for(const sub of ['root','alice','bob'])db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(sub,JSON.stringify({user:{sub},csrf:'csrf'}),Date.now()+60000);
 const call=async(sub,path,method='GET',input={},csrf='csrf')=>{const req=Readable.from(method==='GET'?[]:[Buffer.from(JSON.stringify(input))]);Object.assign(req,{url:path,method,headers:{cookie:'ops_session='+sub,origin:'https://ops.mainapis.com','x-csrf-token':csrf,'content-type':'application/json'}});const res={setHeader(){},writeHead(status){this.status=status;},end(data){this.data=JSON.parse(data);}};await handler(req,res);return res;};
 try{
  assert.equal((await call('alice','/api/billing/admin')).status,403);assert.equal((await call('alice','/api/billing/admin?request_key=api-1')).status,403);assert.equal((await call('alice','/api/billing/admin','POST',{owner:'alice',amount:10,key:'x',reason:'x'})).status,403);
  const credit={owner:'alice',amount:100,key:'api-1',reason:'线下充值核对'};assert.equal((await call('root','/api/billing/admin','POST',credit,'wrong')).status,403);assert.equal((await call('root','/api/billing/admin','POST',credit)).status,200);assert.equal((await call('root','/api/billing/admin','POST',credit)).data.duplicate,true);assert.equal((await call('root','/api/billing/admin?request_key=api-1')).data.entry.points,100);
  assert.equal((await call('bob','/api/billing?owner=alice')).data.account.available,0);assert.equal((await call('alice','/api/billing')).data.account.available,100);assert.equal((await call('root','/api/billing/admin','POST',{...credit,owner:'missing',key:'missing'})).status,400);
  db.prepare("INSERT INTO teams VALUES('team:example','例子','root','now')").run();db.prepare("INSERT INTO team_members VALUES('root','team:example','admin',1)").run();db.prepare("INSERT INTO team_members VALUES('bob','team:example','editor',1)").run();assert.equal((await call('root','/api/billing/admin','POST',{...credit,owner:'team:example',key:'team-credit'})).status,200);assert.throws(()=>db.prepare("INSERT INTO team_members VALUES('alice','team:example','editor',1)").run(),/个人钱包/);assert.equal((await call('bob','/api/billing')).data.account.available,100);assert.equal((await call('bob','/api/billing/admin')).status,403);
 }finally{db.close();closeStore();await rm(dir,{recursive:true,force:true});}
});
