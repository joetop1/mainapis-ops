import test from 'node:test';
import assert from 'node:assert/strict';
import {openStore} from '../core.mjs';
import {REJECTED_JOB} from '../recover-store-auth.mjs';
import {recoverKnownCarouselRejection} from '../recover-store-carousel.mjs';
function fixture(){
 const db=openStore(':memory:'),p={source_url:'https://detail.1688.com/offer/755369163302.html',catalog_target:'crmeb-store',images:['https://example.com/a.jpg'],skus:[{sku:'A',price:10,stock:8}]};
 db.prepare('INSERT INTO products VALUES(?,?,?,?,?,?,?,?)').run('p','alice',p.source_url,JSON.stringify(p),'approved',8,'now','now');
 db.prepare('INSERT INTO jobs VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(REJECTED_JOB,'alice','p',8,'crmeb-store','unknown','secret','已确认执行13因 presale_status 缺失在保存事务前失败；商城修复后可重发同一任务','','now','now');
 db.prepare('INSERT INTO job_snapshots(job_id,product,claimed) VALUES(?,?,1)').run(REJECTED_JOB,JSON.stringify(p));
 db.prepare('INSERT INTO audit VALUES(?,?,?,?,?)').run('prev','alice','job.recover_known_presale_rejection',REJECTED_JOB,'2026-10-24T15:00:00.000Z');
 db.prepare('INSERT INTO audit VALUES(?,?,?,?,?)').run('claim','alice','job.claim_create',REJECTED_JOB,'2026-10-24T15:01:00.000Z');return db;
}
test('轮播超长恢复需商城无记录证据，且不改变原始图片、SKU或价格库存',()=>{
 const db=fixture();try{assert.throws(()=>recoverKnownCarouselRejection(db));const before=db.prepare('SELECT data FROM products').get().data,snapshot=db.prepare('SELECT product FROM job_snapshots').get().product;
 assert.equal(recoverKnownCarouselRejection(db,{merchantEmptyConfirmed:true}).job_id,REJECTED_JOB);assert.equal(db.prepare('SELECT claimed FROM job_snapshots').get().claimed,0);assert.equal(db.prepare('SELECT data FROM products').get().data,before);assert.equal(db.prepare('SELECT product FROM job_snapshots').get().product,snapshot);assert.throws(()=>recoverKnownCarouselRejection(db,{merchantEmptyConfirmed:true}));
 }finally{db.close();}
});
test('未知的其他失败或多次后续领取不能使用轮播恢复入口',()=>{
 for(const mutate of [
 db=>db.prepare("UPDATE jobs SET message='网络超时'").run(),
 db=>db.prepare("UPDATE jobs SET remote_id='123'").run(),
 db=>db.prepare('INSERT INTO audit VALUES(?,?,?,?,?)').run('again','alice','job.claim_create',REJECTED_JOB,'2026-10-24T15:02:00.000Z')
 ]){const db=fixture();try{mutate(db);assert.throws(()=>recoverKnownCarouselRejection(db,{merchantEmptyConfirmed:true}));assert.equal(db.prepare('SELECT claimed FROM job_snapshots').get().claimed,1);}finally{db.close();}}
});
