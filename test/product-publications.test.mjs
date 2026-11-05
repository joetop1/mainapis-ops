import test from 'node:test';
import assert from 'node:assert/strict';
import {openStore} from '../core.mjs';
import {productPublications} from '../product-publications.mjs';
test('商城发布摘要不受300条任务限制，保留历史成功、待核对与空间隔离',()=>{
 const db=openStore(':memory:');
 const product=db.prepare('INSERT INTO products VALUES(?,?,?,?,?,?,?,?)');
 product.run('p','alice','https://detail.1688.com/offer/1.html','{}','draft',3,'now','now');
 product.run('q','bob','https://detail.1688.com/offer/1.html','{}','draft',1,'now','now');
 const job=db.prepare('INSERT INTO jobs(id,owner,product_id,revision,target,status,token,message,remote_id,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?,?)');
 job.run('old','alice','p',1,'crmeb-pro','succeeded','secret','','554','001','001');
 job.run('new','alice','p',2,'crmeb-pro','failed','secret','','','002','002');
 job.run('pending','alice','p',3,'crmeb-store','awaiting_review','secret','','','003','003');
 job.run('foreign','bob','q',1,'tigshop','succeeded','secret','','999','999','999');
 for(let i=0;i<301;i++)job.run('extra'+i,'alice','p',i+4,'tigshop','failed','secret','','',String(1000+i),String(1000+i));
 const rows=productPublications(db,'alice').get('p');
 assert.equal(rows.length,3);
 assert.deepEqual({...rows.find(r=>r.target==='crmeb-pro')},{product_id:'p',target:'crmeb-pro',mall_connection_id:'',status:'succeeded',revision:1,remote_id:'554',updated:'001',can_republish:false});
 assert.equal(rows.find(r=>r.target==='crmeb-store').status,'awaiting_review');
 assert.equal(productPublications(db,'alice').has('q'),false);
 assert.equal(productPublications(db,'bob').get('q')[0].remote_id,'999');
 assert.equal(productPublications(db,'empty').size,0);
 db.close();
});

test('仅全部历史安全结束且未领取的失败任务允许重新发布',()=>{
 const db=openStore(':memory:');
 db.prepare('INSERT INTO products VALUES(?,?,?,?,?,?,?,?)').run('p','alice','url','{}','approved',2,'now','now');
 const job=db.prepare("INSERT INTO jobs(id,owner,product_id,revision,target,status,token,created,updated) VALUES(?,'alice','p',1,'crmeb-pro',?,'t',?,?)");
 job.run('old','failed','1','1');
 const summary=()=>productPublications(db,'alice').get('p')[0].can_republish;
 assert.equal(summary(),false);
 db.prepare("INSERT INTO job_snapshots(job_id,product) VALUES('old','{}')").run();
 assert.equal(summary(),true);
 for(const field of ['claimed','candidate_id','verification_nonce']){
 db.prepare(`UPDATE job_snapshots SET ${field}=? WHERE job_id='old'`).run(field==='claimed'?1:'18');
 assert.equal(summary(),false);
 db.prepare(`UPDATE job_snapshots SET ${field}=? WHERE job_id='old'`).run(field==='claimed'?0:'');
 }
 job.run('new','failed','2','2');
 db.prepare("INSERT INTO job_snapshots(job_id,product) VALUES('new','{}')").run();
 assert.equal(summary(),true);
 db.prepare("UPDATE jobs SET status='unknown' WHERE id='old'").run();
 assert.equal(summary(),false);
 db.prepare("UPDATE jobs SET status='failed',remote_id='18' WHERE id='old'").run();
 assert.equal(summary(),false);
 db.close();
});
