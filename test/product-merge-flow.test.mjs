import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {openStore,decodeProduct} from '../core.mjs';
import {suggestedMergeRows} from '../public/merge-products.js';
test('实际handler合并、预览、已发布提醒、编辑溯源保留、团队权限和重复请求',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ops-merge-flow-'));Object.assign(process.env,{DATA_DIR:dir,APP_ORIGIN:'https://ops.mainapis.com',DEMO_MODE:'false'});const original=globalThis.fetch;globalThis.fetch=()=>{throw Error('合并不得访问商城或上游');};
 const {handler,closeStore}=await import('../server.mjs'),db=openStore(join(dir,'ops.sqlite'));
 for(const sub of ['alice','editor','outsider'])db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(sub,JSON.stringify({user:{sub,name:sub},csrf:'csrf'}),Date.now()+60000);
 const call=async(path,method='GET',body={},sub='alice',csrf='csrf')=>{const req=Readable.from(method==='GET'?[]:[Buffer.from(JSON.stringify(body))]);Object.assign(req,{url:path,method,headers:{cookie:'ops_session='+sub,origin:'https://ops.mainapis.com','x-csrf-token':csrf,'content-type':'application/json'}});const res={status:200,setHeader(){},writeHead(status){this.status=status;},end(value){this.body=value;}};await handler(req,res);return {status:res.status,data:JSON.parse(res.body)};};
 try{
  await call('/api/team','POST',{name:'合并团队'});await call('/api/team/members','POST',{sub:'editor',role:'editor'});
  const ids=[];for(let i=0;i<4;i++){const made=await call('/api/products','POST',{source_url:'https://detail.1688.com/offer/'+(200+i)+'.html',title:'原商品'+i,category:'原始资料',images:['https://example.com/'+i+'.jpg'],skus:[{sku:'SAME',spec:'默认',cost:i+1,price:i+10,stock:i+20}]},i%2?'editor':'alice');assert.equal(made.status,201);ids.push(made.data.id);}
  const products=ids.map(id=>decodeProduct(db.prepare('SELECT * FROM products WHERE id=?').get(id))),owner=db.prepare('SELECT owner FROM products WHERE id=?').get(ids[0]).owner;
  db.prepare("UPDATE products SET status='approved' WHERE id=?").run(ids[0]);db.prepare('INSERT INTO jobs(id,owner,product_id,revision,target,status,token,created,updated) VALUES(?,?,?,?,?,?,?,?,?)').run('history',owner,ids[0],1,'crmeb-pro','succeeded','private','now','now');
  const input={products:products.map(p=>({id:p.id,revision:p.revision})),main_id:ids[0],title:'合并新商品',dimension:'款式',images:'all',details:'main',rows:suggestedMergeRows(products),request_id:'handler-merge-123456789'};
  assert.equal((await call('/api/products/merge-preview','POST',input,'outsider')).status,400);assert.equal((await call('/api/products/merge','POST',input,'editor','bad')).status,403);
  const preview=await call('/api/products/merge-preview','POST',input,'editor');assert.equal(preview.status,200);assert.match(preview.data.warnings.join(' '),/已有发布任务/);assert.equal(db.prepare('SELECT COUNT(*) n FROM products').get().n,4);
  const created=await call('/api/products/merge','POST',input,'editor');assert.equal(created.status,201,JSON.stringify(created));const id=created.data.id;
  assert.equal((await call('/api/products/merge','POST',input,'editor')).data.id,id);assert.equal(db.prepare('SELECT COUNT(*) n FROM products').get().n,5);assert.equal(db.prepare('SELECT COUNT(*) n FROM jobs').get().n,1);assert.equal(db.prepare('SELECT status FROM products WHERE id=?').get(ids[0]).status,'approved');
  let p=decodeProduct(db.prepare('SELECT * FROM products WHERE id=?').get(id));const sources=p.skus.map(s=>s.source);assert.equal(p.status,'draft');assert.equal(p.merge_sources.length,4);
  const oldClient={...p,title:'修改后',skus:p.skus.map(s=>{const row={...s};delete row.source;return row;})};delete oldClient.merge_sources;assert.equal((await call('/api/products/'+id,'PUT',oldClient,'editor')).status,200);p=decodeProduct(db.prepare('SELECT * FROM products WHERE id=?').get(id));assert.deepEqual(p.skus.map(s=>s.source),sources);assert.equal(p.merge_sources.length,4);
  assert.equal((await call('/api/products/'+id,'PUT',{...p,source_url:'https://detail.1688.com/offer/999.html'},'editor')).status,400);
  const mine=(await call('/api/state?collection_scope=mine','GET',{},'editor')).data.products;assert.ok(mine.some(p=>p.id===id));assert.ok(!mine.some(p=>p.id===ids[0]));
  assert.equal((await call('/api/products','POST',{...products[0]})).status,400);assert.equal(db.prepare('SELECT COUNT(*) n FROM products').get().n,5);
 }finally{globalThis.fetch=original;db.close();closeStore();await rm(dir,{recursive:true,force:true});}
});
