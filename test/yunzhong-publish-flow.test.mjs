import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {setTimeout as delay} from 'node:timers/promises';
import {openStore} from '../core.mjs';
import {signYunzhong} from '../yunzhong-client.mjs';
test('完整芸众HTTP流程：保存连接、官方分类、团队发布、部分核对和重复发布拦截',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ops-yun-flow-'));Object.assign(process.env,{DATA_DIR:dir,APP_ORIGIN:'https://ops.mainapis.com',DEMO_MODE:'false'});
 const oldFetch=globalThis.fetch;let saved,creates=0;
 globalThis.fetch=async(url,options)=>{
  const args=options.method==='POST'?JSON.parse(options.body):Object.fromEntries(new URL(url).searchParams);assert.equal(args.sign,signYunzhong(args,'private-secret'));assert.equal(options.redirect,'error');
  assert.ok(!String(url).includes('bridge'));const route=new URL(url).pathname.split('/outside/1/')[1];let data;
  if(route==='goods/category'){const parent=Number(args.parent_id);data={data:parent===0?[{id:1,name:'一级',parent_id:0}]:parent===1?[{id:2,name:'二级',parent_id:1}]:[],last_page:1};}
  else if(route==='goods/list')data={data:saved?[saved]:[]};
  else if(route==='goods/create'){creates++;saved={id:55,...args};data={goods_id:55};}
  else if(route==='goods/createOption'){saved.options={has_option:1,specs:[{title:'颜色',spec_item:[{id:1,title:'红'}]}],option:args.option.map(row=>({...row,specs:'1'}))};data={};}
  else if(route==='goods/getOption')data=saved.options;
  else throw Error('unexpected operation '+route);
  return {ok:true,text:async()=>JSON.stringify({result:1,data})};
 };
 const {handler,closeStore}=await import('../server.mjs'),db=openStore(join(dir,'ops.sqlite'));
 for(const sub of ['alice','reviewer'])db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(sub,JSON.stringify({user:{sub},csrf:'csrf'}),Date.now()+60000);
 const call=async(path,method='GET',data={},user='alice')=>{const req=Readable.from([Buffer.from(JSON.stringify(data))]);Object.assign(req,{url:path,method,headers:{cookie:'ops_session='+user,origin:'https://ops.mainapis.com','x-csrf-token':'csrf','content-type':'application/json'}});const res={status:200,setHeader(){},writeHead(status){this.status=status;},end(value){this.body=value;}};await handler(req,res);return {status:res.status,data:JSON.parse(res.body)};};
 try{
  assert.equal((await call('/api/connections/yunzhong','POST',{appid:'123',appsecret:'private-secret',dispatchPrice:'6.00',categoryLevel:2})).status,200);
  assert.equal((await call('/api/team','POST',{name:'团队'})).status,201);await call('/api/team/members','POST',{sub:'reviewer',role:'reviewer'});
  const product={source_url:'https://detail.1688.com/offer/123.html',catalog_target:'yunzhong',category_id:2,brand_ids:[],title:'测试商品',description:'',attributes:[],images:['https://example.com/main.jpg'],detail_images:['https://example.com/detail.jpg'],spec_names:['颜色'],skus:[{sku:'A',spec_values:['红'],cost:2,price:5,stock:10}]};
  const unsupported=await call('/api/products','POST',{...product,source_url:'https://detail.1688.com/offer/456.html',description:'必须保留的文字'});
  const blocked=(await call('/api/state')).data.products.find(row=>row.id===unsupported.data.id);
  await call('/api/products/'+blocked.id+'/approve','POST',{revision:blocked.revision},'reviewer');
  assert.equal((await call('/api/products/'+blocked.id+'/publish','POST',{revision:blocked.revision,target:'yunzhong'},'reviewer')).status,400);
  assert.equal(creates,0);assert.equal(db.prepare('SELECT count(*) AS n FROM jobs').get().n,0);
  const created=await call('/api/products','POST',product);assert.equal(created.status,201,JSON.stringify(created.data));
  const p=(await call('/api/state')).data.products.find(row=>row.id===created.data.id);
  await call('/api/products/'+p.id+'/approve','POST',{revision:p.revision},'reviewer');
  const published=await call('/api/products/'+p.id+'/publish','POST',{revision:p.revision,target:'yunzhong'},'reviewer');assert.equal(published.status,202,JSON.stringify(published.data));
  for(let i=0;i<100;i++){if(db.prepare('SELECT status FROM jobs WHERE id=?').get(published.data.id).status==='awaiting_review')break;await delay(5);}
  assert.equal(db.prepare('SELECT status FROM jobs WHERE id=?').get(published.data.id).status,'awaiting_review');assert.equal(creates,1);assert.equal(saved.status,0);assert.deepEqual(saved.good_content,product.detail_images);
  assert.equal((await call('/api/products/'+p.id+'/publish','POST',{revision:p.revision,target:'yunzhong'},'reviewer')).status,409);assert.equal(creates,1);
  assert.equal((await call('/api/state')).data.products.find(row=>row.id===p.id).description,'');
 }finally{globalThis.fetch=oldFetch;db.close();closeStore();await rm(dir,{recursive:true,force:true});}
});
