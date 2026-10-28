import test from 'node:test';
import assert from 'node:assert/strict';
import {openStore} from '../core.mjs';
import {createCrmebRunner} from '../crmeb-direct.mjs';
const id='b790e467-9767-4c68-a5d3-8e30f2a3f23a';
function setup(){const db=openStore(':memory:'),product={catalog_target:'crmeb-store',catalog_connection_id:'mall-a',category_id:1,title:'T',images:['https://example.com/a.jpg'],skus:[{sku:'A',spec:'红',price:5,cost:2,stock:10}],crmeb:{origin:'https://store.example.com',shippingTemplateId:9}};db.prepare('INSERT INTO products VALUES(?,?,?,?,?,?,?,?)').run('p','alice','s',JSON.stringify(product),'approved',1,'now','now');db.prepare('INSERT INTO jobs(id,owner,product_id,revision,target,status,token,created,updated,mall_connection_id) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,'alice','p',1,'crmeb-store','accepted','token','now','now','mall-a');db.prepare('INSERT INTO job_snapshots(job_id,product) VALUES(?,?)').run(id,JSON.stringify(product));return {db,job:db.prepare('SELECT * FROM jobs WHERE id=?').get(id)};}
const response=data=>({ok:true,text:async()=>JSON.stringify(data)});
test('CRMEB创建超时后领取锁保留，重复调度不再次创建',async()=>{
 const {db,job}=setup();let writes=0;
 const runner=createCrmebRunner({db,audit(){},getConnection:()=>({url:'https://store.example.com',appid:'a',appsecret:'secret'}),fetcher:async(url)=>{if(url.endsWith('get_token'))return response({status:200,data:{token:'t'}});if(url.endsWith('/category/1'))return response({status:200,data:{id:1}});writes++;throw Error('timeout');}});
 try{await runner(job);assert.equal(db.prepare('SELECT status FROM jobs').get().status,'unknown');assert.equal(db.prepare('SELECT claimed FROM job_snapshots').get().claimed,1);await runner(job);assert.equal(writes,1);}finally{db.close();}
});
test('CRMEB过期的失败核对不能覆盖后续核对状态',async()=>{
 const {db,job}=setup();let rejectRead,started;const waiting=new Promise(resolve=>started=resolve);
 db.prepare("UPDATE job_snapshots SET claimed=1,candidate_id='18',verification_nonce='old'").run();db.prepare("UPDATE jobs SET status='verifying'").run();
 const runner=createCrmebRunner({db,audit(){},getConnection:()=>({url:'https://store.example.com',appid:'a',appsecret:'secret'}),fetcher:async(url)=>{if(url.endsWith('get_token'))return response({status:200,data:{token:'t'}});started();return new Promise((_,reject)=>rejectRead=reject);}});
 try{const running=runner(job,'verify_draft');await waiting;db.prepare("UPDATE job_snapshots SET verification_nonce='new'").run();db.prepare("UPDATE jobs SET message='new verification'").run();rejectRead(Error('old failure'));await running;assert.equal(db.prepare('SELECT message FROM jobs').get().message,'new verification');}finally{db.close();}
});
