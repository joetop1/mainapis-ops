import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSameStyleProduct} from '../same-style.mjs';
import {productMerge} from '../product-merge.mjs';
import {openStore,validateProduct} from '../core.mjs';
import {suggestedStyleMatch,styleSourceIds} from '../public/same-style.js';
function fixtures(){
 const base={revision:1,title:'润滑液',category:'分类',catalog_target:'crmeb-pro',category_id:1,brand_ids:[3],images:['https://img.example.com/stock.png'],attributes:[{name:'产地',value:'货盘产地'}],skus:[]};
 const stocks=[50,100].map((size,i)=>({...base,id:'s'+i,source_url:'supplier:'+String(i+1).repeat(64),supplier_import:{supplier:'供应商'},skus:[{sku:'BAR'+i,spec:size+'ml',cost:10+i,price:20+i,stock:8+i}]}));
 const ref={...base,id:'ref',source_url:'https://detail.1688.com/offer/123.html',title:'采集标题',images:['https://img.example.com/ref.png'],detail_images:['https://img.example.com/detail.png'],description:'采集说明',attributes:[{name:'材质',value:'水性'}],skus:[50,100,200].map(size=>({sku:'REF'+size,spec:size+'ml',cost:0,price:1,stock:999,image:'https://img.example.com/'+size+'.png'}))};
 const products=[...stocks,ref],input={mode:'same-style',products:products.map(p=>({id:p.id,revision:1})),main_id:'s0',reference_id:'ref',title:'完整商品',dimension:'容量',images:'reference',rows:stocks.map((p,i)=>({product_id:p.id,original_sku:p.skus[0].sku,value:p.skus[0].spec,reference_sku:'REF'+[50,100][i]})),request_id:'same-style-request-12345'};
 return {products,input};
}
test('同款整理只保留货盘SKU及商业数据，图文和规格图来自采集，来源可再次保存',()=>{
 const {products,input}=fixtures(),before=JSON.stringify(products),{product}=buildSameStyleProduct(products,input);
 assert.equal(product.skus.length,2);assert.deepEqual(product.skus.map(s=>[s.sku,s.cost,s.price,s.stock]),[['BAR0',10,20,8],['BAR1',11,21,9]]);
 assert.deepEqual(product.images,products[2].images);assert.deepEqual(product.detail_images,products[2].detail_images);assert.deepEqual(product.attributes,products[2].attributes);assert.deepEqual(product.brand_ids,[3]);assert.equal(product.skus[0].image,products[2].skus[0].image);assert.equal(product.skus[0].source.url,products[0].source_url);assert.deepEqual(product.same_style.matches[0],{product_id:'s0',sku:'BAR0',reference_sku:'REF50'});assert.equal(product.supplier_import,undefined);assert.deepEqual(validateProduct(product),product);assert.equal(JSON.stringify(products),before);
 assert.deepEqual([...styleSourceIds([{...product,id:'new'}])].sort(),['ref','s0','s1']);
});
test('未匹配保留原图，重复对应、遗漏、无效来源或重复规格拒绝',()=>{
 let {products,input}=fixtures();input.rows[0].reference_sku='';let result=buildSameStyleProduct(products,input);assert.equal(result.product.skus[0].image,products[0].images[0]);assert.ok(result.warnings.some(w=>w.includes('未对应')));
 for(const mode of ['duplicate','missing','foreign','value','sku','ref']){({products,input}=fixtures());if(mode==='duplicate')input.rows[1].reference_sku=input.rows[0].reference_sku;if(mode==='missing')input.rows.pop();if(mode==='foreign')input.rows[0].product_id='other';if(mode==='value')input.rows[1].value=input.rows[0].value;if(mode==='sku')input.rows[0].reference_sku='MISSING';if(mode==='ref')input.reference_id='s0';assert.throws(()=>buildSameStyleProduct(products,input));}
});
test('同款生成隔离空间、保护版本、事务回滚、幂等重试且不改原商品',()=>{
 const {products,input}=fixtures(),db=openStore(':memory:');
 for(const p of products)db.prepare('INSERT INTO products VALUES(?,?,?,?,?,?,?,?)').run(p.id,'alice',p.source_url,JSON.stringify(p),'draft',1,'now','now');
 const svc=productMerge({db,collectors:{record(){}},audit(){},actor:()=>({sub:'alice'})});const before=db.prepare('SELECT * FROM products').all();
 assert.throws(()=>svc.preview('bob',input),/工作空间/);assert.equal(svc.preview('alice',input).product.skus.length,2);
 const result=svc.create('alice',input);assert.equal(svc.create('alice',input).id,result.id);assert.equal(svc.create('alice',{...input,request_id:'new-request-123456'}).id,result.id);assert.deepEqual(db.prepare('SELECT * FROM products WHERE id<>?').all(result.id),before);assert.equal(db.prepare('SELECT status FROM products WHERE id=?').get(result.id).status,'draft');
 assert.throws(()=>svc.create('alice',{...input,reference_id:'s0'}),/请求已用于/);
 db.prepare("UPDATE products SET revision=2 WHERE id='s0'").run();assert.throws(()=>svc.preview('alice',input),/已更新/);db.close();
 const broken=openStore(':memory:');for(const p of products)broken.prepare('INSERT INTO products VALUES(?,?,?,?,?,?,?,?)').run(p.id,'alice',p.source_url,JSON.stringify(p),'draft',1,'now','now');const failing=productMerge({db:broken,collectors:{record(){}},audit(){throw Error('broken');},actor:()=>({})});assert.throws(()=>failing.create('alice',input),/broken/);assert.equal(broken.prepare('SELECT count(*) n FROM products').get().n,3);assert.equal(broken.prepare('SELECT count(*) n FROM product_merge_requests').get().n,0);broken.close();
});
test('仅唯一且明确同名规格建议匹配，模糊标题和默认值不猜测',()=>{
 const {products}=fixtures(),ref=products[2];assert.equal(suggestedStyleMatch({spec:' 50 ml '},ref),'REF50');assert.equal(suggestedStyleMatch({spec:'默认'},ref),'');assert.equal(suggestedStyleMatch({spec:'5ml'},ref),'');ref.skus.push({...ref.skus[0],sku:'duplicate'});assert.equal(suggestedStyleMatch({spec:'50ml'},ref),'');
});

test('仅合并货盘：沿用所选主商品图文并保留各 SKU 的商业数据',()=>{
 const {products,input}=fixtures(),stocks=products.slice(0,2);
 stocks[1].description='主商品说明';
 stocks[1].images=['https://img.example.com/main.png'];
 const {product}=buildSameStyleProduct(stocks,{...input,main_id:'s1',reference_id:'',rows:input.rows.map(row=>({...row,reference_sku:''}))});
 assert.equal(product.description,'主商品说明');
 assert.deepEqual(product.images,stocks[1].images);
 assert.equal(product.source_url,stocks[1].source_url);
 assert.deepEqual(product.skus.map(s=>[s.sku,s.cost,s.price,s.stock,s.image]),[['BAR0',10,20,8,stocks[0].images[0]],['BAR1',11,21,9,stocks[1].images[0]]]);
});
