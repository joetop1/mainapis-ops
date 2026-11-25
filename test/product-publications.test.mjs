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
 assert.deepEqual({...rows.find(r=>r.target==='crmeb-pro')},{job_id:'old',product_id:'p',target:'crmeb-pro',mall_connection_id:'',status:'succeeded',revision:1,remote_id:'554',updated:'001',can_republish:false});
 assert.equal(rows.find(r=>r.target==='crmeb-store').status,'awaiting_review');
 assert.equal(rows.find(r=>r.target==='crmeb-store').job_id,'pending');
 assert.equal(rows.find(r=>r.target==='crmeb-store').verify_job_id,undefined);
 db.prepare("INSERT INTO job_snapshots(job_id,product,claimed) VALUES('pending','{}',1)").run();
 assert.equal(productPublications(db,'alice').get('p').find(r=>r.target==='crmeb-store').verify_job_id,'pending');
 db.prepare("UPDATE jobs SET status='verifying' WHERE id='pending'").run();
 assert.equal(productPublications(db,'alice').get('p').find(r=>r.target==='crmeb-store').verify_job_id,undefined);

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

test('大量商品历史只汇总最近1000件，仍保留旧版本成功并隔离其他空间',()=>{
 const db=openStore(':memory:');try{
 const product=db.prepare('INSERT INTO products VALUES(?,?,?,?,?,?,?,?)');
 const job=db.prepare('INSERT INTO jobs(id,owner,product_id,revision,target,status,token,remote_id,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?)');
 db.exec('BEGIN');
 for(let i=0;i<1002;i++){
  const id='p'+i,stamp=String(i).padStart(5,'0');product.run(id,'alice','url'+i,'{}','draft',2,stamp,stamp);
  job.run(id+'-old','alice',id,1,'tigshop','succeeded','t','remote'+i,'1','1');
  job.run(id+'-new','alice',id,2,'tigshop','failed','t','','2','2');
 }
 product.run('foreign','bob','foreign','{}','draft',1,'99999','99999');job.run('foreign-job','bob','foreign',1,'tigshop','succeeded','t','private','3','3');
 db.exec('COMMIT');
 const summary=productPublications(db,'alice');assert.equal(summary.size,1000);assert(!summary.has('p0'));assert(!summary.has('p1'));assert(!summary.has('foreign'));
 for(const id of ['p2','p500','p1001']){assert.equal(summary.get(id)[0].remote_id,'remote'+id.slice(1));assert.equal(summary.get(id)[0].can_republish,false);}
 assert.equal(productPublications(db,'bob').get('foreign')[0].remote_id,'private');
 }finally{db.close();}
});
