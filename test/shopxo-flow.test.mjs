import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {setTimeout as delay} from 'node:timers/promises';
import {openStore} from '../core.mjs';
import {shopxoSignature} from '../shopxo-client.mjs';
const caps={contract:'mainapis-shopxo-1',bridgeVersion:'0.1.0',shopVersion:'6.9.2',features:['marker_receipt','warehouse_inventory','full_detail'],categories:[{id:1,parent_id:0,name:'父'},{id:2,parent_id:1,name:'子'}],brands:[{id:3,name:'品牌'}],warehouses:[{id:7,name:'主仓'}]};
test('ShopXO完整HTTP流程：测试不保存、仓库校验、团队隔离、下架核对和不确定创建保锁',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ops-shopxo-flow-'));Object.assign(process.env,{DATA_DIR:dir,APP_ORIGIN:'https://ops.mainapis.com',DEMO_MODE:'false'});
 const original=globalThis.fetch,saved=new Map(),secret='a'.repeat(64);let creates=0,failCreate=false;
 globalThis.fetch=async(url,options)=>{
  assert.equal(url,'https://shopxo.example.com/mainapis-shopxo.php');const envelope=JSON.parse(options.body);assert.equal(envelope.sign,shopxoSignature(envelope.request,secret));const r=JSON.parse(Buffer.from(envelope.request,'base64'));assert.equal(r.appid,'ops_12345678');let data;
  if(r.op==='capabilities')data=caps;else if(r.op==='lookup')data={found:saved.has(r.marker),product:saved.get(r.marker)};
  else if(r.op==='create'){
   creates++;if(failCreate)throw Error('unknown timeout');const p=r.product;data={id:'18',marker:p.marker,status:0,title:p.title,category_id:p.category_id,brand_id:p.brand_id,warehouse_id:p.warehouse_id,stock:p.skus.reduce((n,s)=>n+s.stock,0),cover:p.images[0],images:p.images,detail_images:p.detail_images,content_html:p.content_html,spec_names:p.spec_names,skus:p.skus.map(s=>({...s,warehouse_stock:s.stock}))};saved.set(p.marker,data);
  }else if(r.op==='detail')data=saved.get(r.marker);else throw Error('unexpected op');
  return {ok:true,status:200,text:async()=>JSON.stringify({code:0,data})};
 };
 const {handler,closeStore}=await import('../server.mjs'),db=openStore(join(dir,'ops.sqlite'));
 for(const sub of ['alice','bob'])db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(sub,JSON.stringify({user:{sub},csrf:'csrf'}),Date.now()+60000);
 const call=async(path,method='GET',data={},sub='alice')=>{const req=Readable.from([Buffer.from(JSON.stringify(data))]);Object.assign(req,{url:path,method,headers:{cookie:'ops_session='+sub,origin:'https://ops.mainapis.com','x-csrf-token':'csrf','content-type':'application/json'}});const res={status:200,setHeader(){},writeHead(s){this.status=s;},end(b){this.body=b;}};await handler(req,res);return {status:res.status,data:JSON.parse(res.body),raw:String(res.body)};};
 const wait=async id=>{for(let n=0;n<100;n++){const row=db.prepare('SELECT * FROM jobs WHERE id=?').get(id);if(['succeeded','unknown','awaiting_review'].includes(row.status))return row;await delay(5);}throw Error('timeout');};
 try{
  const mall=(await call('/api/malls','POST',{system:'shopxo',name:'小蓝ShopXO'})).data.connection,path='/api/connections/shopxo?connection_id='+mall.id;
  const credentials={url:'https://shopxo.example.com',appid:'ops_12345678',appsecret:secret,warehouseId:7};
  assert.equal((await call('/api/connections/shopxo/test?connection_id='+mall.id,'POST',credentials)).data.warehouses[0].id,7);assert.equal((await call(path)).data.configured,false);assert.equal(creates,0);
  assert.equal((await call(path,'POST',{...credentials,warehouseId:99})).status,400);assert.equal((await call(path,'POST',credentials)).status,200);assert.equal((await call(path)).raw.includes(secret),false);assert.equal((await call(path,'GET',{},'bob')).status,400);
  const product={catalog_target:'shopxo',catalog_connection_id:mall.id,category_id:2,brand_ids:[3],source_url:'https://detail.1688.com/offer/123.html',title:'测试商品',description:'文字',images:['https://example.com/a.jpg'],detail_images:['https://example.com/d.jpg'],spec_names:['颜色'],skus:[{sku:'A',spec_values:['红'],cost:2,price:5,stock:10}]};
  const add=await call('/api/products','POST',product);assert.equal(add.status,201,JSON.stringify(add));const id=add.data.id;await call('/api/products/'+id+'/approve','POST',{revision:1});const sent=await call('/api/products/'+id+'/publish','POST',{revision:1,target:'shopxo',connection_id:mall.id});assert.equal(sent.status,202,JSON.stringify(sent));const job=await wait(sent.data.id);assert.equal(job.status,'succeeded',job.message);assert.equal(job.remote_id,'18');assert.equal(creates,1);
  assert.equal((await call('/api/products/'+id+'/publish','POST',{revision:1,target:'shopxo',connection_id:mall.id})).status,409);
  failCreate=true;const add2=await call('/api/products','POST',{...product,source_url:'https://detail.1688.com/offer/124.html'});await call('/api/products/'+add2.data.id+'/approve','POST',{revision:1});const sent2=await call('/api/products/'+add2.data.id+'/publish','POST',{revision:1,target:'shopxo',connection_id:mall.id});const unknown=await wait(sent2.data.id);assert.equal(unknown.status,'unknown');assert.equal(db.prepare('SELECT claimed FROM job_snapshots WHERE job_id=?').get(unknown.id).claimed,1);assert.equal((await call('/api/jobs/'+unknown.id+'/retry','POST',{})).status,409);assert.equal(creates,2);
 }finally{globalThis.fetch=original;db.close();closeStore();await rm(dir,{recursive:true,force:true});}
});
