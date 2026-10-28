import test from 'node:test';
import assert from 'node:assert/strict';
import {openStore} from '../core.mjs';
import {JSON_BODY_JOB,recoverKnownJsonBodyFailure} from '../recover-store-json-body.mjs';
const flags={merchantEmptyConfirmed:true,execution30Confirmed:true};
function fixture(){
 const db=openStore(':memory:'),p={catalog_target:'crmeb-store',title:'TENGA LOTION水溶性润滑液',skus:[{stock:1,price:10}]};
 db.prepare('INSERT INTO products VALUES(?,?,?,?,?,?,?,?)').run('p','alice','source',JSON.stringify(p),'approved',2,'now','now');
 db.prepare('INSERT INTO jobs(id,owner,product_id,revision,target,status,token,message,remote_id,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(JSON_BODY_JOB,'alice','p',2,'crmeb-store','accepted','secret','n8n 已接收，等待执行结果','','now','now');
 db.prepare('INSERT INTO job_snapshots(job_id,product,claimed) VALUES(?,?,1)').run(JSON_BODY_JOB,JSON.stringify(p));
 db.prepare('INSERT INTO audit VALUES(?,?,?,?,?)').run('claim','alice','job.claim_create',JSON_BODY_JOB,'now');return db;
}
test('仅执行30已核对的一次JSON解析失败可恢复，快照不变且禁止重复恢复',()=>{
 const db=fixture();try{const before=db.prepare('SELECT product FROM job_snapshots').get().product;
 assert.throws(()=>recoverKnownJsonBodyFailure(db));recoverKnownJsonBodyFailure(db,flags);
 assert.equal(db.prepare('SELECT claimed,product FROM job_snapshots').get().product,before);assert.equal(db.prepare('SELECT claimed FROM job_snapshots').get().claimed,0);
 assert.equal(db.prepare('SELECT status FROM jobs').get().status,'unknown');assert.throws(()=>recoverKnownJsonBodyFailure(db,flags));}finally{db.close();}
});
test('已有结果、多个领取、其他版本或错误任务均不解锁',()=>{
 for(const sql of ["UPDATE jobs SET remote_id='1'","UPDATE job_snapshots SET candidate_id='1'","UPDATE jobs SET revision=3","UPDATE jobs SET status='succeeded'","UPDATE jobs SET target='crmeb-pro'","INSERT INTO audit VALUES('claim2','alice','job.claim_create','"+JSON_BODY_JOB+"','later')"]){const db=fixture();try{db.exec(sql);assert.throws(()=>recoverKnownJsonBodyFailure(db,flags));assert.equal(db.prepare('SELECT claimed FROM job_snapshots').get().claimed,1);}finally{db.close();}}
});
