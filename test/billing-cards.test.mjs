import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {Readable} from 'node:stream';
import {billingStore} from '../billing.mjs';
import {openStore} from '../core.mjs';
const execute=promisify(execFile);
test('卡密摘要存储、批次幂等、兑换入账原子性、过期作废与重试限频',()=>{
 const db=new DatabaseSync(':memory:');let now='2026-11-08T00:00:00Z';const billing=billingStore(db,{clock:()=>now});
 try{
  const input={actor:'admin',label:'测试批次',amount:100,quantity:3,expires:'2026-11-09T00:00:00Z',key:'mint-1'},mint=billing.mintCards(input);assert.equal(mint.codes.length,3);assert.equal(new Set(mint.codes).size,3);assert.match(mint.codes[0],/^OPS-(?:[A-F0-9]{8}-){4}[A-F0-9]{8}$/);assert.equal(billing.mintCards(input).duplicate,true);assert.deepEqual(billing.mintCards(input).codes,[]);assert.throws(()=>billing.mintCards({...input,amount:101}),/冲突/);
  const rows=db.prepare('SELECT * FROM billing_cards').all();for(const code of mint.codes)assert.equal(JSON.stringify(rows).includes(code),false);assert.equal(JSON.stringify(billing.cardDetails(mint.id)).includes('digest'),false);
  const redeem={owner:'team-a',actor:'alice',code:mint.codes[0].toLowerCase()};const result=billing.redeemCard(redeem);assert.equal(result.amount,100);assert.equal(billing.view('team-a').account.available,100);assert.equal(billing.redeemCard(redeem).duplicate,true);assert.equal(billing.view('team-a').total,1);assert.throws(()=>billing.redeemCard({...redeem,owner:'team-b',actor:'bob'}),/卡密无效/);assert.equal(billing.view('team-b').account.available,0);
  const revoked=billing.revokeCards({actor:'admin',batchId:mint.id,reason:'撤回未售出'});assert.equal(revoked.revoked,2);assert.equal(billing.view('team-a').account.available,100);assert.throws(()=>billing.redeemCard({...redeem,code:mint.codes[1]}),/卡密无效/);assert.equal(billing.cardBatches().items[0].redeemed,1);
  const exp=billing.mintCards({...input,key:'expire',quantity:1});now='2026-11-10T00:00:00Z';assert.throws(()=>billing.redeemCard({...redeem,code:exp.codes[0]}),/卡密无效/);assert.equal(billing.cardDetails(exp.id).items[0].state,'expired');assert.equal(billing.redeemCard(redeem).duplicate,true);
  for(let i=0;i<10;i++)assert.throws(()=>billing.redeemCard({owner:'other',actor:'guesser',code:'bad'}),/卡密无效/);assert.throws(()=>billing.redeemCard({owner:'other',actor:'guesser',code:exp.codes[0]}),e=>e.httpStatus===429);now='2026-11-10T00:11:00Z';assert.throws(()=>billing.redeemCard({owner:'other',actor:'guesser',code:'bad'}),/卡密无效/);
  const rollback=billing.mintCards({...input,key:'rollback',expires:'',quantity:1});billing.credit({owner:'full',actor:'admin',amount:1,key:'full',reason:'测试'});db.prepare("UPDATE billing_accounts SET available=1000000000000 WHERE owner='full'").run();assert.throws(()=>billing.redeemCard({owner:'full',actor:'full',code:rollback.codes[0]}),/上限/);assert.equal(billing.cardDetails(rollback.id).items[0].state,'active');assert.equal(billing.view('full').total,1);
 }finally{db.close();}
});
test('两个真实进程并发兑换同一张卡，只有一个空间入账',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ops-card-race-')),path=join(dir,'cards.sqlite'),db=new DatabaseSync(path);const store=billingStore(db),code=store.mintCards({actor:'root',label:'并发',amount:10,quantity:1,key:'batch'}).codes[0];
 try{
  const script="import {DatabaseSync} from 'node:sqlite';import {billingStore} from './billing.mjs';const db=new DatabaseSync(process.argv[1]);db.exec('PRAGMA busy_timeout=5000');try{billingStore(db).redeemCard({owner:process.argv[2],actor:process.argv[2],code:process.argv[3]});console.log('ok');}catch{console.log('rejected');}finally{db.close();}";
  const results=await Promise.all(['team-a','team-b'].map(owner=>execute(process.execPath,['--input-type=module','-e',script,path,owner,code],{cwd:new URL('../',import.meta.url).pathname})));assert.deepEqual(results.map(r=>r.stdout.trim()).sort(),['ok','rejected']);assert.equal(db.prepare('SELECT SUM(available) n FROM billing_accounts').get().n,10);assert.equal(db.prepare('SELECT COUNT(*) n FROM billing_ledger').get().n,1);
 }finally{db.close();await rm(dir,{recursive:true,force:true});}
});
test('卡密管理和兑换接口校验管理员、团队角色、CSRF及兑换目标',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ops-card-api-'));Object.assign(process.env,{DATA_DIR:dir,APP_ORIGIN:'https://ops.mainapis.com',DEMO_MODE:'false',ALLOWED_SUBJECTS:'root,alice,bob',SYSTEM_ADMIN_SUBJECTS:'root'});const {handler,closeStore}=await import('../server.mjs'),db=openStore(join(dir,'ops.sqlite'));
 for(const sub of ['root','alice','bob'])db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(sub,JSON.stringify({user:{sub},csrf:'csrf'}),Date.now()+60000);db.prepare("INSERT INTO teams VALUES('team:test','测试团队','alice','now')").run();db.prepare("INSERT INTO team_members VALUES('alice','team:test','admin',1)").run();db.prepare("INSERT INTO team_members VALUES('bob','team:test','editor',1)").run();
 const call=async(sub,path,method='GET',input={},csrf='csrf')=>{const req=Readable.from(method==='GET'?[]:[Buffer.from(JSON.stringify(input))]);Object.assign(req,{url:path,method,headers:{cookie:'ops_session='+sub,origin:'https://ops.mainapis.com','x-csrf-token':csrf,'content-type':'application/json'}});const res={setHeader(){},writeHead(status){this.status=status;},end(data){this.data=JSON.parse(data);}};await handler(req,res);return res;};
 try{
  assert.equal((await call('alice','/api/billing/cards')).status,403);assert.equal((await call('root','/api/billing/cards','POST',{},'wrong')).status,403);const batch=(await call('root','/api/billing/cards','POST',{label:'接口测试',amount:50,quantity:1,key:'api-mint'})).data;
  assert.equal((await call('bob','/api/billing/redeem','POST',{code:batch.codes[0]})).status,403);assert.equal((await call('alice','/api/billing/redeem','POST',{code:batch.codes[0]},'wrong')).status,403);assert.equal((await call('alice','/api/billing/redeem','POST',{code:batch.codes[0],expectedOwner:'alice'})).status,409);
  assert.equal((await call('alice','/api/billing/redeem','POST',{code:batch.codes[0],owner:'root'})).status,200);assert.equal((await call('alice','/api/billing')).data.account.available,50);assert.equal((await call('root','/api/billing?owner=team:test')).data.account.available,0);
  const details=await call('root','/api/billing/cards?batch='+batch.id);assert.equal(details.data.items[0].owner,'team:test');assert.equal(details.data.items[0].redeemer,'alice');assert.equal(JSON.stringify(details.data).includes(batch.codes[0]),false);
 }finally{db.close();closeStore();await rm(dir,{recursive:true,force:true});}
});
