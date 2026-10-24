import test from 'node:test';
import assert from 'node:assert/strict';
import {openStore} from '../core.mjs';
import {REJECTED_JOB,recoverKnownAuthorizationRejection} from '../recover-store-auth.mjs';
function fixture(){
 const db=openStore(':memory:');const p={catalog_target:'crmeb-store',source_url:'https://detail.1688.com/offer/755369163302.html',skus:[{sku:'A',price:10,stock:9}]};
 db.prepare('INSERT INTO products VALUES(?,?,?,?,?,?,?,?)').run('p','alice',p.source_url,JSON.stringify(p),'approved',8,'now','now');
 db.prepare('INSERT INTO jobs VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(REJECTED_JOB,'alice','p',8,'crmeb-store','unknown','private-token','官方接口未返回明确成功，请先在商城仓库核对，禁止重新创建','','now','now');
 db.prepare('INSERT INTO job_snapshots(job_id,product,claimed) VALUES(?,?,1)').run(REJECTED_JOB,JSON.stringify(p));return db;
}
test('仅恢复已确认410003鉴权拒绝的特定任务，保留原快照和所有商品数据',()=>{
 const db=fixture();try{const product=db.prepare('SELECT data FROM products').get().data,snapshot=db.prepare('SELECT product FROM job_snapshots').get().product;
 const r=recoverKnownAuthorizationRejection(db);assert.equal(r.job_id,REJECTED_JOB);assert.equal(db.prepare('SELECT claimed FROM job_snapshots').get().claimed,0);assert.equal(db.prepare('SELECT data FROM products').get().data,product);assert.equal(db.prepare('SELECT product FROM job_snapshots').get().product,snapshot);assert.equal(db.prepare('SELECT COUNT(*) n FROM audit').get().n,1);assert.throws(()=>recoverKnownAuthorizationRejection(db));
 }finally{db.close();}
});
test('未知结果、已核验和错误来源都不能用专用恢复命令解锁',()=>{
 for(const mutate of [
  db=>db.prepare("UPDATE jobs SET status='succeeded',remote_id='88'").run(),
  db=>db.prepare("UPDATE jobs SET target='crmeb-pro'").run(),
  db=>db.prepare("UPDATE job_snapshots SET candidate_id='88'").run(),
  db=>db.prepare("UPDATE jobs SET message='请求超时，结果未知'").run(),
  db=>db.prepare("UPDATE job_snapshots SET product=?").run(JSON.stringify({catalog_target:'crmeb-store',source_url:'https://detail.1688.com/offer/999.html'}))
 ]){const db=fixture();try{mutate(db);assert.throws(()=>recoverKnownAuthorizationRejection(db));assert.equal(db.prepare('SELECT claimed FROM job_snapshots').get().claimed,1);assert.equal(db.prepare('SELECT COUNT(*) n FROM audit').get().n,0);}finally{db.close();}}
});
