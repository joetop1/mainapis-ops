import test from 'node:test';
import assert from 'node:assert/strict';
import {openStore} from '../core.mjs';
import {createYunzhongRunner} from '../yunzhong-direct.mjs';
import {buildYunzhongProduct} from '../yunzhong-product.mjs';
const product={catalog_target:'yunzhong',category_id:2,title:'测试商品',description:'',images:['https://example.com/main.jpg'],detail_images:['https://example.com/detail.jpg'],spec_names:['颜色'],skus:[{sku:'A',spec_values:['红'],price:10,cost:4,stock:2}],yunzhong:{categoryIds:[1,2],categoryLevel:2,dispatchPrice:'5.00'}};
test('官方创建分步执行：部分核对不报成功，未知结果不重建，SKU失败保留商品ID',async()=>{
 for(const mode of ['success','unknown','options-failed','existing']){
  const db=openStore(':memory:'),id='a'.repeat(32),marker='OPS-'+id;
  db.prepare('INSERT INTO products VALUES(?,?,?,?,?,?,?,?)').run('p','alice','source',JSON.stringify(product),'approved',1,'now','now');
  db.prepare('INSERT INTO jobs(id,owner,product_id,revision,target,status,token,message,remote_id,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,'alice','p',1,'yunzhong','dispatching','token','','','now','now');
  db.prepare('INSERT INTO job_snapshots(job_id,product) VALUES(?,?)').run(id,JSON.stringify(product));
  let creates=0,optionsWrites=0;const expected=buildYunzhongProduct({product,marker},product.yunzhong);let saved=mode==='existing'?{id:99,...expected.base}:null;
  const runner=createYunzhongRunner({db,getConnection:()=>({appid:'1',appsecret:'secret',mode:'official',publishingReady:true}),audit:()=>{},fetcher:async(url,options)=>{
   assert.ok(!String(url).includes('bridge'));const parsed=new URL(url),route=parsed.pathname.split('/outside/1/')[1],args=options.method==='POST'?JSON.parse(options.body):Object.fromEntries(parsed.searchParams);let data;
   if(route==='goods/category'){const parent=Number(args.parent_id);data={data:parent===0?[{id:1,name:'一级',parent_id:0}]:parent===1?[{id:2,name:'二级',parent_id:1}]:[],last_page:1};}
   else if(route==='goods/list')data={data:saved?[saved]:[]};
   else if(route==='goods/create'){creates++;saved={id:99,...expected.base};if(mode==='unknown')throw Error('response lost');data={goods_id:99};}
   else if(route==='goods/createOption'){optionsWrites++;if(mode==='options-failed')throw Error('SKU response lost');data={};}
   else if(route==='goods/getOption')data={has_option:1,specs:[{title:'颜色',spec_item:[{id:1,title:'红'}]}],option:expected.options.option.map(row=>({...row,specs:'1'}))};
   else throw Error('unexpected '+route);
   return {ok:true,text:async()=>JSON.stringify({result:1,data})};
  }});
  const job=db.prepare('SELECT * FROM jobs WHERE id=?').get(id);await runner(job);
  const result=db.prepare('SELECT * FROM jobs WHERE id=?').get(id);
  assert.equal(result.status,['unknown','options-failed'].includes(mode)?'unknown':'awaiting_review');
  if(mode==='options-failed')assert.equal(result.remote_id,'99');
  await runner(job);assert.equal(creates,mode==='existing'?0:1);assert.equal(optionsWrites,mode==='existing'||mode==='unknown'?0:1);
  db.prepare('UPDATE job_snapshots SET candidate_id=?,verification_nonce=? WHERE job_id=?').run('99','nonce',id);
  await runner(job,'verify_draft');assert.equal(db.prepare('SELECT status FROM jobs WHERE id=?').get(id).status,'awaiting_review');assert.equal(creates,mode==='existing'?0:1);
  db.close();
 }
});
