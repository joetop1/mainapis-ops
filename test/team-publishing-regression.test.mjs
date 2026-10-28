import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openStore} from '../core.mjs';
import {teamStore} from '../teams.mjs';
import {connectionStore} from '../connection-store.mjs';
import {buildStoreProduct} from '../crmeb-store.mjs';
test('个人迁移团队后，两商城凭证、发布入口、任务快照、回调密钥及商品请求体保持一致',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ops-team-publish-')),db=openStore(':memory:');
 try{
  const stores=await Promise.all(['crmeb-pro','crmeb-store'].map(scope=>connectionStore(db,dir,scope)));
  stores.forEach((s,i)=>s.set('alice',{appid:'app-'+i,appsecret:'private-'+i,webhookUrl:'https://n8n.mainapis.com/webhook/'+i,webhookToken:'hook-'+i}));
  const product={catalog_target:'crmeb-store',category_id:154,title:'TENGA LOTION测试',source_url:'https://detail.1688.com/offer/1084174064750.html',images:['https://example.com/main.jpg'],detail_images:Array.from({length:20},(_,i)=>`https://example.com/detail${i}.jpg`),applicable_type:0,skus:[{sku:'ALI-1',spec:'红',image:'https://example.com/sku.jpg',price:74.9,cost:45,stock:90}]};
  const id='968140ec-5c8d-4672-a039-27cdcad7fa51';
  db.prepare('INSERT INTO products VALUES(?,?,?,?,?,?,?,?)').run('p','alice',product.source_url,JSON.stringify(product),'approved',2,'now','now');
  db.prepare('INSERT INTO jobs(id,owner,product_id,revision,target,status,token,message,remote_id,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,'alice','p',2,'crmeb-store','accepted','callback-secret','n8n 已接收，等待执行结果','','now','now');
  db.prepare('INSERT INTO job_snapshots(job_id,product,claimed) VALUES(?,?,1)').run(id,JSON.stringify(product));
  const read=()=>{
   const j=db.prepare('SELECT * FROM jobs WHERE id=?').get(id),s=db.prepare('SELECT * FROM job_snapshots WHERE job_id=?').get(id);
   return {connections:stores.map(store=>store.get(j.owner)),snapshot:s,callbackToken:j.token,payload:buildStoreProduct({marker:'OPS-'+id.replaceAll('-',''),product:JSON.parse(s.product)},{shippingTemplateId:1})};
  };
  const before=read();teamStore(db).create('alice','团队',stores);assert.deepEqual(read(),before);
 }finally{db.close();await rm(dir,{recursive:true,force:true});}
});
