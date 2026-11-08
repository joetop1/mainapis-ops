import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openStore} from '../core.mjs';
import {billingStore} from '../billing.mjs';
test('单价保存不启用收费，价格确认防变化，免计费空间保持免费',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ops-price-')),db=openStore(join(dir,'test.sqlite')),billing=billingStore(db,{legacyOwners:['internal']});try{
  const rates=billing.saveRates({actor:'root',collect:2,publish:5,revision:1});assert.equal(rates.enabled,0);assert.equal(billing.quote('paid',{kind:'publish',quantity:3}).due,0);assert.throws(()=>billing.saveRates({actor:'root',collect:3,publish:5,revision:1}),/版本已变化/);
  db.exec('UPDATE billing_settings SET enabled=1');assert.equal(billing.quote('paid',{kind:'publish',quantity:3}).due,15);assert.equal(billing.prepareCharge('internal','publish',null,true).due,0);assert.throws(()=>billing.prepareCharge('paid','publish',1),/确认当前费用/);assert.throws(()=>billing.prepareCharge('paid','publish',rates.revision,true),/OSS/);assert.equal(billing.prepareCharge('paid','collect',rates.revision).due,2);
 }finally{db.close();await rm(dir,{recursive:true,force:true});}
});
test('商品写入、发布任务与冻结同事务回滚，成功结算、明确失败退回、不确定结果不退',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ops-meter-')),db=openStore(join(dir,'test.sqlite')),billing=billingStore(db);try{
  const rate=billing.saveRates({actor:'root',collect:2,publish:5,revision:1});db.exec('UPDATE billing_settings SET enabled=1');billing.credit({owner:'paid',actor:'root',amount:30,key:'credit',reason:'测试'});
  const insertProduct=id=>db.prepare("INSERT INTO products VALUES(?,?,?,'{}','approved',1,'now','now')").run(id,'paid',id);
  db.exec('BEGIN IMMEDIATE');insertProduct('collected');billing.chargeProduct({owner:'paid',actor:'editor',id:'collected',rate:billing.prepareCharge('paid','collect',rate.revision)});db.exec('COMMIT');assert.equal(billing.view('paid').account.available,28);assert.equal(billing.view('paid').account.frozen,0);
  db.exec('BEGIN IMMEDIATE');insertProduct('rolled-back');billing.chargeProduct({owner:'paid',actor:'editor',id:'rolled-back',rate:billing.prepareCharge('paid','collect',rate.revision)});db.exec('ROLLBACK');assert.equal(db.prepare("SELECT 1 FROM products WHERE id='rolled-back'").get(),undefined);assert.equal(billing.view('paid').account.available,28);
  const insertJob=(id,revision)=>{db.prepare("INSERT INTO jobs(id,owner,product_id,revision,target,status,token,created,updated) VALUES(?,'paid','collected',?,'crmeb-pro','dispatching','t','now','now')").run(id,revision);db.prepare("INSERT INTO job_snapshots(job_id,product) VALUES(?,'{}')").run(id);billing.reservePublish({id,owner:'paid',actor:'editor',revision:rate.revision});};
  db.exec('BEGIN IMMEDIATE');insertJob('abort',1);db.exec('ROLLBACK');assert.equal(billing.view('paid').account.frozen,0);assert.equal(db.prepare("SELECT 1 FROM jobs WHERE id='abort'").get(),undefined);
  for(const [id,revision]of [['success',1],['failed',2],['uncertain',3],['claimed-failed',4]]){db.exec('BEGIN IMMEDIATE');insertJob(id,revision);db.exec('COMMIT');}
  assert.equal(billing.view('paid').account.frozen,20);db.prepare("UPDATE jobs SET status='succeeded',remote_id='18' WHERE id='success'").run();db.prepare("UPDATE job_snapshots SET claimed=1 WHERE job_id='success'").run();
  db.prepare("UPDATE jobs SET status='failed' WHERE id IN('failed','claimed-failed')").run();db.prepare("UPDATE job_snapshots SET claimed=1 WHERE job_id='claimed-failed'").run();db.prepare("UPDATE jobs SET status='unknown' WHERE id='uncertain'").run();
  billing.reconcilePending();billing.reconcilePending();assert.equal(billing.view('paid').account.available,13);assert.equal(billing.view('paid').account.frozen,10);assert.equal(db.prepare("SELECT state FROM billing_holds WHERE id='publish:success'").get().state,'settled');assert.equal(db.prepare("SELECT state FROM billing_holds WHERE id='publish:failed'").get().state,'released');assert.equal(db.prepare("SELECT state FROM billing_holds WHERE id='publish:uncertain'").get().state,'held');assert.equal(db.prepare("SELECT state FROM billing_holds WHERE id='publish:claimed-failed'").get().state,'held');
  billing.saveRates({actor:'root',collect:3,publish:9,revision:rate.revision});assert.equal(JSON.parse(db.prepare("SELECT rate_snapshot FROM billing_holds WHERE id='publish:success'").get().rate_snapshot).unit,5);
  db.exec("UPDATE billing_accounts SET available=0 WHERE owner='paid'");db.exec('BEGIN IMMEDIATE');try{insertProduct('insufficient');assert.throws(()=>billing.chargeProduct({owner:'paid',actor:'editor',id:'insufficient',rate:billing.prepareCharge('paid','collect',rate.revision+1)}),/不足/);}finally{db.exec('ROLLBACK');}assert.equal(db.prepare("SELECT 1 FROM products WHERE id='insufficient'").get(),undefined);
 }finally{db.close();await rm(dir,{recursive:true,force:true});}
});
