import test from 'node:test';
import assert from 'node:assert/strict';
import {openStore} from '../core.mjs';
import {REJECTED_JOB} from '../recover-store-auth.mjs';
import {PRESALE_CLAIM_TIME,recoverKnownPresaleRejection} from '../recover-store-presale.mjs';
function fixture(){
 const db=openStore(':memory:'),p={catalog_target:'crmeb-store',source_url:'https://detail.1688.com/offer/755369163302.html',skus:[{sku:'A',price:10,cost:4.73,stock:8}]};
 db.prepare('INSERT INTO products VALUES(?,?,?,?,?,?,?,?)').run('p','alice',p.source_url,JSON.stringify(p),'approved',8,'now','now');
 db.prepare('INSERT INTO jobs VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(REJECTED_JOB,'alice','p',8,'crmeb-store','unknown','secret','已确认本次请求在多门店鉴权中间件被拒绝；修正请求头后可重发同一任务','','now','now');
 db.prepare('INSERT INTO job_snapshots(job_id,product,claimed) VALUES(?,?,1)').run(REJECTED_JOB,JSON.stringify(p));
 db.prepare('INSERT INTO audit VALUES(?,?,?,?,?)').run('recovery','alice','job.recover_known_auth_rejection',REJECTED_JOB,'2026-10-24T14:51:11.363Z');
 db.prepare('INSERT INTO audit VALUES(?,?,?,?,?)').run('claim','alice','job.claim_create',REJECTED_JOB,PRESALE_CLAIM_TIME);return db;
}
test('仅恢复已核对执行13的保存前缺字段失败，所有商品数据及快照保持不变',()=>{
 const db=fixture();try{
 const data=db.prepare('SELECT data FROM products').get().data,product=db.prepare('SELECT product FROM job_snapshots').get().product;
 assert.equal(recoverKnownPresaleRejection(db).job_id,REJECTED_JOB);assert.equal(db.prepare('SELECT claimed FROM job_snapshots').get().claimed,0);assert.equal(db.prepare('SELECT data FROM products').get().data,data);assert.equal(db.prepare('SELECT product FROM job_snapshots').get().product,product);assert.throws(()=>recoverKnownPresaleRejection(db));
 }finally{db.close();}
});
test('后续尝试、已核验、结果未知或其他商品不能使用缺字段恢复入口',()=>{
 for(const mutate of [
 db=>db.prepare("UPDATE audit SET created='2026-10-24T15:00:00.000Z' WHERE action='job.claim_create'").run(),
 db=>db.prepare("UPDATE jobs SET status='succeeded',remote_id='99'").run(),
 db=>db.prepare("UPDATE jobs SET message='请求超时'").run(),
 db=>db.prepare("UPDATE job_snapshots SET verification_nonce='nonce'").run(),
 db=>db.prepare("UPDATE jobs SET target='crmeb-pro'").run()
 ]){const db=fixture();try{mutate(db);assert.throws(()=>recoverKnownPresaleRejection(db));assert.equal(db.prepare('SELECT claimed FROM job_snapshots').get().claimed,1);}finally{db.close();}}
});
