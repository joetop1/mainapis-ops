import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {openStore} from '../core.mjs';
test('正式API新增采集按成功计费，重复、低余额与价格未确认不写商品不扣点',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ops-charge-api-'));Object.assign(process.env,{DATA_DIR:dir,APP_ORIGIN:'https://ops.mainapis.com',DEMO_MODE:'false',ALLOWED_SUBJECTS:'root',SYSTEM_ADMIN_SUBJECTS:'root'});const {handler,closeStore}=await import('../server.mjs'),db=openStore(join(dir,'ops.sqlite'));
 for(const sub of ['root','customer'])db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(sub,JSON.stringify({user:{sub},csrf:'csrf'}),Date.now()+60000);
 const call=async(sub,path,method='GET',input={})=>{const req=Readable.from(method==='GET'?[]:[Buffer.from(JSON.stringify(input))]);Object.assign(req,{url:path,method,headers:{cookie:'ops_session='+sub,origin:'https://ops.mainapis.com','x-csrf-token':'csrf','content-type':'application/json'}});const res={setHeader(){},writeHead(status){this.status=status;},end(data){this.data=JSON.parse(data);}};await handler(req,res);return res;};
 try{
  await call('root','/api/users','POST',{sub:'customer',action:'enable'});assert.equal((await call('customer','/api/billing/rates')).status,403);const rates=(await call('root','/api/billing/rates','POST',{collect:2,publish:5,revision:1,enabled:true})).data;assert.equal(rates.enabled,0);
  db.exec('UPDATE billing_settings SET enabled=1');await call('root','/api/billing/admin','POST',{owner:'customer',amount:3,key:'credit',reason:'test'});
  const p={title:'商品',category:'测试',source_url:'https://detail.1688.com/offer/123.html',images:['https://example.com/a.jpg'],skus:[{sku:'A',spec:'默认',price:10,cost:5,stock:3}]};assert.equal((await call('customer','/api/products','POST',p)).status,400);assert.equal(db.prepare("SELECT COUNT(*) n FROM products WHERE owner='customer'").get().n,0);
  assert.equal((await call('customer','/api/products','POST',{...p,billing_owner:'root',billing_revision:rates.revision})).status,400);const created=await call('customer','/api/products','POST',{...p,billing_revision:rates.revision});assert.equal(created.status,201);const quote=await call('customer','/api/billing/quote','POST',{kind:'collect',quantity:1,source_url:p.source_url});assert.equal(quote.data.owner,'customer');assert.equal(quote.data.due,0);assert.equal(quote.data.existing.id,created.data.id);assert.equal((await call('customer','/api/billing')).data.account.available,1);assert.equal((await call('customer','/api/products','POST',{...p,billing_revision:rates.revision})).status,400);assert.equal((await call('customer','/api/billing')).data.account.available,1);
  assert.equal((await call('customer','/api/products','POST',{...p,source_url:'https://detail.1688.com/offer/124.html',billing_revision:rates.revision})).status,400);assert.equal(db.prepare("SELECT COUNT(*) n FROM products WHERE owner='customer'").get().n,1);assert.equal((await call('customer','/api/billing')).data.account.frozen,0);
 }finally{db.close();closeStore();await rm(dir,{recursive:true,force:true});}
});
