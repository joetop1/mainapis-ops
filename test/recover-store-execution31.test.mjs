import test from 'node:test';
import assert from 'node:assert/strict';
import {openStore} from '../core.mjs';
import {JSON_BODY_JOB as JOB} from '../recover-store-json-body.mjs';
import {recoverExecution31} from '../recover-store-execution31.mjs';
const flags={merchantEmptyAfterRestart:true,execution31Finished:true};
function fixture(){
 const db=openStore(':memory:'),p={catalog_target:'crmeb-store',source_url:'https://detail.1688.com/offer/1084174064750.html',title:'TENGA LOTION水溶性润滑液',skus:[{stock:90,price:74.9}]};
 db.prepare('INSERT INTO products VALUES(?,?,?,?,?,?,?,?)').run('p','alice',p.source_url,JSON.stringify(p),'approved',2,'now','now');
 db.prepare('INSERT INTO jobs VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(JOB,'alice','p',2,'crmeb-store','accepted','secret','n8n 已接收，等待执行结果','','now','now');
 db.prepare('INSERT INTO job_snapshots(job_id,product,claimed) VALUES(?,?,1)').run(JOB,JSON.stringify(p));
 for(const [id,action,time] of [['first','job.claim_create','2026-10-25T07:23:16Z'],['recovery','job.recover_execution30_json_body','2026-10-25T07:30:00Z'],['second','job.claim_create','2026-10-25T07:32:16Z']])db.prepare('INSERT INTO audit VALUES(?,?,?,?,?)').run(id,'alice',action,JOB,time);
 return db;
}
test('执行31恢复保留快照和所有其他任务，需确认且不能重复使用',()=>{
 const db=fixture();try{const before=db.prepare('SELECT product FROM job_snapshots').get().product;assert.throws(()=>recoverExecution31(db));recoverExecution31(db,flags);assert.equal(db.prepare('SELECT claimed FROM job_snapshots').get().claimed,0);assert.equal(db.prepare('SELECT product FROM job_snapshots').get().product,before);assert.equal(db.prepare('SELECT status FROM jobs').get().status,'unknown');assert.throws(()=>recoverExecution31(db,flags));}finally{db.close();}
});
test('执行31恢复拒绝后续领取、已入库结果、不同商品或缺少执行30恢复证据',()=>{
 for(const sql of ["UPDATE jobs SET remote_id='2180'","UPDATE job_snapshots SET candidate_id='2180'","UPDATE job_snapshots SET verification_nonce='active'","UPDATE jobs SET revision=3","UPDATE jobs SET status='succeeded'","DELETE FROM audit WHERE id='recovery'","INSERT INTO audit VALUES('third','alice','job.claim_create','"+JOB+"','2026-10-25T08:00:00Z')","UPDATE job_snapshots SET product=json_set(product,'$.source_url','https://detail.1688.com/offer/1.html')"]){const db=fixture();try{db.exec(sql);assert.throws(()=>recoverExecution31(db,flags));assert.equal(db.prepare('SELECT claimed FROM job_snapshots').get().claimed,1);}finally{db.close();}}
});
