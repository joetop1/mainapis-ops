import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {setTimeout as delay} from 'node:timers/promises';
import {openStore} from '../core.mjs';
import {signYunzhong} from '../yunzhong-client.mjs';
const caps={contract:'mainapis-yunzhong-1',features:['atomic_create','marker_receipt','text_detail','sku','full_detail'],categoryLevel:3,categories:[{id:1,name:'一级',parent_id:0},{id:2,name:'二级',parent_id:1},{id:3,name:'三级',parent_id:2}],brands:[{id:4,name:'品牌'}]};
test('完整芸众HTTP流程：保存连接、三级分类品牌、团队发布、详情核对和重复发布拦截',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ops-yun-flow-'));Object.assign(process.env,{DATA_DIR:dir,APP_ORIGIN:'https://ops.mainapis.com',DEMO_MODE:'false'});
 const oldFetch=globalThis.fetch;let saved,creates=0;
 globalThis.fetch=async(url,options)=>{
  const args=options.method==='POST'?JSON.parse(options.body):Object.fromEntries(new URL(url).searchParams);assert.equal(args.sign,signYunzhong(args,'private-secret'));assert.equal(options.redirect,'error');
  let data;if(args.op==='capabilities')data=caps;else if(args.op==='lookup')data={found:!!saved,...(saved?{product:saved}:{})};else if(args.op==='create'){
   creates++;const p=args.product;data=saved={id:'55',marker:p.marker,status:0,title:p.base.title,brand_id:p.base.brand_id,category_paths:[p.category_ids],images:p.base.thumb_url,content_html:p.content_html,spec_names:p.options.specs.map(spec=>spec.title),skus:p.options.option.map(row=>({sku:row.goods_sn,price:row.product_price,cost:row.cost_price,stock:row.stock,image:row.thumb,spec_values:['红','M']}))};
  }else if(args.op==='detail')data=saved;else throw Error('unexpected operation');
  return {ok:true,text:async()=>JSON.stringify({result:1,data})};
 };
 const {handler,closeStore}=await import('../server.mjs'),db=openStore(join(dir,'ops.sqlite'));
 for(const sub of ['alice','reviewer'])db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(sub,JSON.stringify({user:{sub},csrf:'csrf'}),Date.now()+60000);
 const call=async(path,method='GET',data={},user='alice')=>{const req=Readable.from([Buffer.from(JSON.stringify(data))]);Object.assign(req,{url:path,method,headers:{cookie:'ops_session='+user,origin:'https://ops.mainapis.com','x-csrf-token':'csrf','content-type':'application/json'}});const res={status:200,setHeader(){},writeHead(status){this.status=status;},end(value){this.body=value;}};await handler(req,res);return {status:res.status,data:JSON.parse(res.body)};};
 try{
  assert.equal((await call('/api/connections/yunzhong','POST',{appid:'123',appsecret:'private-secret',dispatchPrice:'6.00'})).status,200);
  assert.equal((await call('/api/team','POST',{name:'团队'})).status,201);await call('/api/team/members','POST',{sub:'reviewer',role:'reviewer'});
  const product={source_url:'https://detail.1688.com/offer/123.html',catalog_target:'yunzhong',category_id:3,brand_ids:[4],title:'测试商品',description:'文字详情',attributes:[{name:'材质',value:'棉'}],images:['https://example.com/main.jpg'],detail_images:['https://example.com/detail.jpg'],spec_names:['颜色','尺码'],skus:[{sku:'A',spec_values:['红','M'],cost:2,price:5,stock:10}]};
  const created=await call('/api/products','POST',product);assert.equal(created.status,201,JSON.stringify(created.data));
  const p=(await call('/api/state')).data.products.find(row=>row.id===created.data.id);
  await call('/api/products/'+p.id+'/approve','POST',{revision:p.revision},'reviewer');
  const published=await call('/api/products/'+p.id+'/publish','POST',{revision:p.revision,target:'yunzhong'},'reviewer');assert.equal(published.status,202,JSON.stringify(published.data));
  for(let i=0;i<100;i++){if(db.prepare('SELECT status FROM jobs WHERE id=?').get(published.data.id).status==='succeeded')break;await delay(5);}
  assert.equal(db.prepare('SELECT status FROM jobs WHERE id=?').get(published.data.id).status,'succeeded');assert.equal(creates,1);assert.match(saved.content_html,/材质：棉/);assert.match(saved.content_html,/文字详情/);
  assert.equal((await call('/api/products/'+p.id+'/publish','POST',{revision:p.revision,target:'yunzhong'},'reviewer')).status,409);assert.equal(creates,1);
  assert.equal((await call('/api/state')).data.products.find(row=>row.id===p.id).description,'文字详情');
 }finally{globalThis.fetch=oldFetch;db.close();closeStore();await rm(dir,{recursive:true,force:true});}
});
