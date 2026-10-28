import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {setTimeout as delay} from 'node:timers/promises';
import {openStore} from '../core.mjs';
import {signYunzhong} from '../yunzhong-client.mjs';
const capabilities={bridgeVersion:'0.2.6',contract:'mainapis-yunzhong-2',features:['atomic_create','marker_receipt','text_detail','sku','full_detail','safe_absence_check'],categoryLevel:2,categories:[{id:1,name:'父类',parent_id:0},{id:2,name:'子类',parent_id:1}],brands:[]};
test('同系统两个商城的配置、分类、发布去重、回执及成员权限完全隔离',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ops-multi-mall-'));Object.assign(process.env,{DATA_DIR:dir,APP_ORIGIN:'https://ops.mainapis.com',DEMO_MODE:'false'});
 const original=globalThis.fetch,calls=[],saved=new Map(),secrets={'https://mall-a.example.com':'secret-a','https://mall-b.example.com':'secret-b'};
 globalThis.fetch=async(url,options)=>{
  const origin=new URL(url).origin,args=options.method==='POST'?JSON.parse(options.body):Object.fromEntries(new URL(url).searchParams);const signed={...args};delete signed.route;delete signed.i;assert.equal(args.sign,signYunzhong(signed,secrets[origin]));calls.push({origin,op:args.op});
  let data;
  if(args.op==='capabilities')data=capabilities;
  else if(args.op==='lookup')data={found:!!saved.get(origin),product:saved.get(origin)};
  else if(args.op==='create'){
   const p=args.product;data={id:origin.includes('mall-a')?'18':'29',marker:p.marker,status:0,title:p.base.title,brand_id:0,category_paths:[p.category_ids],images:p.base.thumb_url,content_html:p.content_html,price:p.base.price,cost_price:p.base.cost_price,stock:p.base.stock,dispatch_type:1,dispatch_price:p.base.dispatch_price,spec_names:['颜色'],skus:p.options.option.map(s=>({sku:s.goods_sn,price:s.product_price,cost:s.cost_price,stock:s.stock,image:s.thumb,spec_values:['红']}))};saved.set(origin,data);
  }else if(args.op==='detail')data=saved.get(origin);else throw Error('unexpected');
  return {ok:true,text:async()=>JSON.stringify({result:1,data})};
 };
 const {handler,closeStore}=await import('../server.mjs'),db=openStore(join(dir,'ops.sqlite'));
 for(const sub of ['alice','editor','reviewer','outsider'])db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(sub,JSON.stringify({user:{sub},csrf:'csrf'}),Date.now()+60000);
 const call=async(path,method='GET',body={},sub='alice')=>{const req=Readable.from([Buffer.from(JSON.stringify(body))]);Object.assign(req,{url:path,method,headers:{cookie:'ops_session='+sub,origin:'https://ops.mainapis.com','x-csrf-token':'csrf','content-type':'application/json'}});const res={status:200,setHeader(){},writeHead(s){this.status=s;},end(b){this.body=b;}};await handler(req,res);return {status:res.status,data:JSON.parse(res.body)};};
 const settled=async id=>{for(let i=0;i<80;i++){const row=db.prepare('SELECT * FROM jobs WHERE id=?').get(id);if(row.status==='succeeded')return row;await delay(5);}return db.prepare('SELECT * FROM jobs WHERE id=?').get(id);};
 try{
  const a=(await call('/api/malls','POST',{system:'yunzhong',name:'A店'})).data.connection,b=(await call('/api/malls','POST',{system:'yunzhong',name:'B店'})).data.connection;
  for(const [mall,url,key] of [[a,'https://mall-a.example.com','secret-a'],[b,'https://mall-b.example.com','secret-b']]){
   const result=await call('/api/connections/yunzhong?connection_id='+mall.id,'POST',{url,appid:'123',appsecret:key,mode:'bridge',dispatchPrice:'0'});assert.equal(result.status,200,JSON.stringify(result));
  }
  const duplicate=(await call('/api/malls','POST',{system:'yunzhong',name:'重复地址'})).data.connection;
  assert.equal((await call('/api/connections/yunzhong?connection_id='+duplicate.id,'POST',{url:'https://mall-a.example.com',appid:'123',appsecret:'secret-a',mode:'bridge',dispatchPrice:'0'})).status,400);
  assert.equal((await call('/api/connections/tigshop?connection_id='+a.id)).status,400);
  assert.equal((await call('/api/catalog/yunzhong?connection_id='+a.id,'GET',{},'outsider')).status,400);
  await call('/api/team','POST',{name:'团队'});await call('/api/team/members','POST',{sub:'editor',role:'editor'});await call('/api/team/members','POST',{sub:'reviewer',role:'reviewer'});
  assert.equal((await call('/api/malls','POST',{system:'yunzhong',name:'非法'},'reviewer')).status,403);
  assert.equal((await call('/api/connections/yunzhong?connection_id='+a.id,'GET',{},'editor')).status,403);
  const product={source_url:'https://detail.1688.com/offer/123.html',catalog_target:'yunzhong',catalog_connection_id:a.id,category_id:2,title:'T',images:['https://example.com/a.jpg'],detail_images:['https://example.com/d.jpg'],spec_names:['颜色'],skus:[{sku:'A',spec_values:['红'],cost:2,price:5,stock:10}]};
  const created=await call('/api/products','POST',product);assert.equal(created.status,201,JSON.stringify(created));const id=created.data.id;
  await call('/api/products/'+id+'/approve','POST',{revision:1});
  assert.equal((await call('/api/products/'+id+'/publish','POST',{revision:1,target:'yunzhong',connection_id:b.id})).status,400);
  const first=await call('/api/products/'+id+'/publish','POST',{revision:1,target:'yunzhong',connection_id:a.id});assert.equal(first.status,202,JSON.stringify(first));assert.equal((await settled(first.data.id)).remote_id,'18');
  assert.equal((await call('/api/products/'+id+'/publish','POST',{revision:1,target:'yunzhong',connection_id:a.id})).status,409);
  assert.equal((await call('/api/products/'+id,'PUT',{...product,catalog_connection_id:b.id,revision:1})).status,200);
  await call('/api/products/'+id+'/approve','POST',{revision:2});const second=await call('/api/products/'+id+'/publish','POST',{revision:2,target:'yunzhong',connection_id:b.id});assert.equal(second.status,202,JSON.stringify(second));assert.equal((await settled(second.data.id)).remote_id,'29');
  const state=(await call('/api/state')).data;assert.equal(state.products[0].publications.length,2);assert.deepEqual(new Set(state.products[0].publications.map(r=>r.mall_connection_id)),new Set([a.id,b.id]));assert.equal(calls.filter(c=>c.op==='create').length,2);
  assert.equal((await call('/api/connections/yunzhong?connection_id='+a.id,'POST',{url:'https://changed.example.com',appid:'123',appsecret:'secret-a',mode:'bridge',dispatchPrice:'0'})).status,400);
  assert.equal((await call('/api/connections/yunzhong?connection_id='+b.id)).data.url,'https://mall-b.example.com');assert.equal(JSON.stringify(state).includes('secret-a'),false);
 }finally{globalThis.fetch=original;db.close();closeStore();await rm(dir,{recursive:true,force:true});}
});
