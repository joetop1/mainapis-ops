import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {openStore} from '../core.mjs';
test('批量设置使用所选商城真实分类品牌，CSRF和空间隔离，分类无效时不修改任何商品',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ops-bulk-flow-'));Object.assign(process.env,{DATA_DIR:dir,APP_ORIGIN:'https://ops.mainapis.com',DEMO_MODE:'false'});const old=globalThis.fetch;globalThis.fetch=async url=>({ok:true,text:async()=>JSON.stringify({status:200,data:String(url).includes('/api/category')?[{id:11,cate_name:'真实分类'}]:[{id:21,brand_name:'真实品牌'}]})});
 const {handler,closeStore}=await import('../server.mjs'),db=openStore(join(dir,'ops.sqlite'));for(const sub of ['alice','bob'])db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(sub,JSON.stringify({user:{sub},csrf:'csrf'}),Date.now()+60000);
 const call=async(path,method='GET',body={},sub='alice',csrf='csrf')=>{const req=Readable.from(method==='GET'?[]:[Buffer.from(JSON.stringify(body))]);Object.assign(req,{url:path,method,headers:{cookie:'ops_session='+sub,origin:'https://ops.mainapis.com','x-csrf-token':csrf,'content-type':'application/json'}});const res={status:200,setHeader(){},writeHead(s){this.status=s;},end(v){this.body=v;}};await handler(req,res);return {status:res.status,data:JSON.parse(res.body)};};
 try{
  const state=(await call('/api/state')).data,mall=state.malls.find(m=>m.type==='crmeb-pro'),foreign=(await call('/api/state','GET',{},'bob')).data.malls.find(m=>m.type==='crmeb-pro');db.prepare("INSERT INTO products VALUES('p','alice','source',?,'approved',1,'now','now')").run(JSON.stringify({source_url:'https://detail.1688.com/offer/1.html',images:[],skus:[],title:'商品'}));
  const input={products:[{id:'p',revision:1}],mapping:{catalog_connection_id:mall.id,catalog_target:'crmeb-pro',category_id:11,category:'伪造名称',brand_ids:[21]},mode:'overwrite'};
  assert.equal((await call('/api/products/bulk-settings','POST',input,'alice','wrong')).status,403);assert.equal((await call('/api/products/bulk-settings','POST',{...input,mapping:{...input.mapping,catalog_connection_id:foreign.id}})).status,400);assert.equal((await call('/api/products/bulk-settings','POST',{...input,mapping:{...input.mapping,category_id:999}})).status,400);assert.equal(db.prepare("SELECT revision FROM products WHERE id='p'").get().revision,1);
  const result=await call('/api/products/bulk-settings','POST',input);assert.equal(result.status,200);assert.equal(result.data.results[0].ok,true);const row=db.prepare("SELECT * FROM products WHERE id='p'").get(),p=JSON.parse(row.data);assert.equal(p.category,'真实分类');assert.deepEqual(p.brand_ids,[21]);assert.equal(row.status,'draft');assert.equal(row.revision,2);
 }finally{globalThis.fetch=old;db.close();closeStore();await rm(dir,{recursive:true,force:true});}
});
