import test from 'node:test';
import assert from 'node:assert/strict';
import {openStore} from '../core.mjs';
import {mallConnections} from '../mall-connections.mjs';
import {changeMallLink,assertMallCanCreate,confirmMallProductDeleted} from '../product-mall-links.mjs';
import {productPublications} from '../product-publications.mjs';

test('manual links block one mall only, survive product edits, and do not create jobs',()=>{
 const db=openStore(':memory:');
 const malls=mallConnections(db);
 const mall=malls.get('alice',null,'crmeb-store').id;
 const other=malls.get('alice',null,'tigshop').id;
 const foreign=malls.get('bob',null,'crmeb-store').id;
 const add=db.prepare("INSERT INTO products VALUES(?,?,?,'{}','draft',1,'now','now')");
 add.run('p','alice','a');add.run('q','alice','b');add.run('r','bob','c');
 const options={owner:'alice',productId:'p',mallId:mall,remoteId:'554',listingStatus:'listed',audit(){}};
 assert.throws(()=>changeMallLink(db,{...options,mallId:foreign}),/工作空间/);
 assert.throws(()=>changeMallLink(db,{...options,productId:'r'}),/工作空间/);
 changeMallLink(db,options);
 assert.throws(()=>assertMallCanCreate(db,'alice','p',mall),/重复发布/);
 assert.doesNotThrow(()=>assertMallCanCreate(db,'alice','p',other));
 assert.throws(()=>changeMallLink(db,{...options,productId:'q'}),/其他记录/);
 assert.throws(()=>changeMallLink(db,{...options,remove:true,remoteId:'555'}),/关联已变化/);
 db.prepare("UPDATE products SET revision=2 WHERE id='p'").run();
 const record=productPublications(db,'alice').get('p')[0];
 assert.equal(record.source,'manual_link');
 assert.equal(record.listing_status,'listed');
 assert.equal(record.remote_id,'554');
 assert.equal(productPublications(db,'bob').size,0);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM jobs').get().n,0);
 changeMallLink(db,{...options,remove:true});
 assert.doesNotThrow(()=>assertMallCanCreate(db,'alice','p',mall));
 db.prepare("INSERT INTO jobs(id,owner,product_id,revision,target,mall_connection_id,status,token,created,updated) VALUES('job','alice','p',2,'crmeb-store',?,'dispatching','token','now','now')").run(mall);
 assert.throws(()=>changeMallLink(db,options),/已有发布任务/);
 db.close();
});

test('确认已删除只解锁指定商城，保留旧成功任务且要求新版审核',()=>{
 const db=openStore(':memory:');
 try{
  db.prepare("INSERT INTO products VALUES('p','alice','a','{}','approved',1,'now','now')").run();
  const add=db.prepare("INSERT INTO jobs(id,owner,product_id,revision,target,mall_connection_id,status,remote_id,token,created,updated) VALUES(?,'alice','p',?,'tigshop',?,?,?,'token','now','now')");
  add.run('old',1,'mall-a','succeeded','42');
  add.run('other',1,'mall-b','succeeded','43');
  const confirm={owner:'alice',productId:'p',mallId:'mall-a',jobId:'old',remoteId:'42',audit(){}};
  assert.throws(()=>confirmMallProductDeleted(db,confirm),/新版/);
  db.prepare("UPDATE products SET revision=2,status='draft' WHERE id='p'").run();
  assert.throws(()=>confirmMallProductDeleted(db,confirm),/审核/);
  db.prepare("UPDATE products SET status='approved' WHERE id='p'").run();
  assert.throws(()=>confirmMallProductDeleted(db,{...confirm,remoteId:'43'}),/已变化/);
  confirmMallProductDeleted(db,confirm);
  assert.doesNotThrow(()=>assertMallCanCreate(db,'alice','p','mall-a'));
  assert.throws(()=>assertMallCanCreate(db,'alice','p','mall-b'),/已有发布任务/);
  assert.equal(db.prepare("SELECT status FROM jobs WHERE id='old'").get().status,'succeeded');
  assert.equal(productPublications(db,'alice').get('p').find(r=>r.mall_connection_id==='mall-a').can_republish,true);
  add.run('new',2,'mall-a','dispatching','');
  assert.throws(()=>assertMallCanCreate(db,'alice','p','mall-a'),/已有发布任务/);
  assert.equal(productPublications(db,'alice').get('p').find(r=>r.mall_connection_id==='mall-a').status,'dispatching');
 }finally{db.close();}
});
