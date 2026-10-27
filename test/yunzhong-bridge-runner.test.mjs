import test from 'node:test';
import assert from 'node:assert/strict';
import {openStore} from '../core.mjs';
import {createYunzhongRunner} from '../yunzhong-direct.mjs';
const capabilities={contract:'mainapis-yunzhong-2',features:['atomic_create','marker_receipt','text_detail','sku','full_detail'],categoryLevel:2,categories:[{id:1,name:'一级',parent_id:0},{id:2,name:'二级',parent_id:1}],brands:[]};
const product={catalog_target:'yunzhong',category_id:2,title:'测试商品',description:'文字详情',attributes:[{name:'材质',value:'棉'}],images:['https://example.com/main.jpg'],detail_images:['https://example.com/detail.jpg'],spec_names:['颜色'],skus:[{sku:'A',spec_values:['红'],price:10,cost:4,stock:2}],yunzhong:{categoryIds:[1,2],mode:'bridge',categoryLevel:2,dispatchPrice:'5.00'}};
test('芸众直接发布、未知写入禁止重建、后续核对、已有回执仅核对',async()=>{
 for(const mode of ['success','unknown','existing']){
  const db=openStore(':memory:'),id='a'.repeat(32),marker='OPS-'+id;
  db.prepare('INSERT INTO products VALUES(?,?,?,?,?,?,?,?)').run('p','alice','source',JSON.stringify(product),'approved',1,'now','now');
  db.prepare('INSERT INTO jobs VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,'alice','p',1,'yunzhong','dispatching','token','','','now','now');
  db.prepare('INSERT INTO job_snapshots(job_id,product) VALUES(?,?)').run(id,JSON.stringify(product));
  let creates=0,saved=null;
  const asActual=plan=>({id:'99',marker,status:0,price:plan.base.price,cost_price:plan.base.cost_price,stock:plan.base.stock,dispatch_type:1,dispatch_price:plan.base.dispatch_price,title:plan.base.title,brand_id:0,category_paths:[plan.category_ids],images:plan.base.thumb_url,content_html:plan.content_html,spec_names:['颜色'],skus:plan.options.option.map(row=>({sku:row.goods_sn,price:row.product_price,cost:row.cost_price,stock:row.stock,image:row.thumb,spec_values:['红']}))});
  if(mode==='existing'){const {buildYunzhongProduct}=await import('../yunzhong-product.mjs');saved=asActual(buildYunzhongProduct({product,marker},{...product.yunzhong,compatibility:true}));}
  const runner=createYunzhongRunner({db,getConnection:()=>({appid:'1',appsecret:'secret',mode:'bridge',publishingReady:true}),audit:()=>{},fetcher:async(url,options)=>{
   const data=options.method==='POST'?JSON.parse(options.body):Object.fromEntries(new URL(url).searchParams);let result;
   if(data.op==='capabilities')result=capabilities;
   else if(data.op==='lookup')result={found:!!saved,...(saved?{product:saved}:{})};
   else if(data.op==='create'){creates++;saved=asActual(data.product);if(mode==='unknown')throw Error('network after commit');result=saved;}
   else if(data.op==='detail')result=saved;
   return {ok:true,text:async()=>JSON.stringify({result:1,data:result})};
  }});
  const job=db.prepare('SELECT * FROM jobs WHERE id=?').get(id);await runner(job);
  assert.equal(db.prepare('SELECT status FROM jobs WHERE id=?').get(id).status,mode==='unknown'?'unknown':'succeeded');
  await runner(job);assert.equal(creates,mode==='existing'?0:1);
  if(mode==='unknown'){
   db.prepare('UPDATE job_snapshots SET candidate_id=?,verification_nonce=? WHERE job_id=?').run('99','nonce',id);
   await runner(job,'verify_draft');assert.equal(db.prepare('SELECT status FROM jobs WHERE id=?').get(id).status,'succeeded');assert.equal(creates,1);
  }
  db.close();
 }
});
