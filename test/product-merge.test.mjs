import {teamStore} from '../teams.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {buildMergedProduct,productMerge} from '../product-merge.mjs';
import {openStore,validateProduct} from '../core.mjs';
import {productCollectors} from '../product-collectors.mjs';
import {suggestedMergeRows} from '../public/merge-products.js';
const products=()=>Array.from({length:4},(_,i)=>({id:'product-'+i,revision:i+1,status:i?'draft':'approved',source_url:'https://detail.1688.com/offer/'+(100+i)+'.html',title:'原商品'+i,category:'主分类',description:'说明'+i,attributes:[{name:'材质',value:'类型'+i}],images:['https://example.com/main'+i+'.jpg'],detail_images:['https://example.com/detail'+i+'.jpg'],skus:[{sku:'DEFAULT',spec:'默认',price:10+i,cost:2+i,stock:10+i}]}));
const request=p=>({products:p.map(r=>({id:r.id,revision:r.revision})),main_id:p[0].id,title:'四款合并',dimension:'型号',images:'all',details:'main',rows:suggestedMergeRows(p),request_id:'merge-request-123456789'});
test('四个链接合并四SKU：真实来源与原编码逐SKU保留，价格库存配图不串用',()=>{
 const p=products(),before=JSON.stringify(p),r=buildMergedProduct(p,request(p));assert.equal(r.product.skus.length,4);assert.equal(r.product.spec_names[0],'型号');assert.equal(new Set(r.product.skus.map(s=>s.sku)).size,4);assert.equal(r.product.description,'说明0');assert.equal(r.product.images.length,4);assert.equal(r.product.detail_images.length,1);assert.equal(r.product.merge_sources.length,4);
 r.product.skus.forEach((sku,i)=>{assert.equal(sku.price,10+i);assert.equal(sku.stock,10+i);assert.equal(sku.image,p[i].images[0]);assert.equal(sku.source.url,p[i].source_url);assert.equal(sku.source.sku,'DEFAULT');assert.equal(sku.source.revision,i+1);});assert.equal(JSON.stringify(p),before);assert.deepEqual(validateProduct(r.product).skus,r.product.skus);
});
test('遗漏SKU、重复编码、重复规格和重复叶子来源拒绝，超限图片不静默裁剪',()=>{
 for(const mode of ['missing','code','value','duplicate','images']){const p=products(),b=request(p);if(mode==='missing')b.rows.pop();if(mode==='code')b.rows[1].sku=b.rows[0].sku;if(mode==='value')b.rows[1].value=b.rows[0].value;if(mode==='duplicate')p[1].source_url=p[0].source_url;if(mode==='images')p[0].images=Array.from({length:30},(_,i)=>'https://example.com/'+i+'.jpg');assert.throws(()=>buildMergedProduct(p,b));}
});
test('嵌套合并保留最初叶子SKU链接；多SKU来源全部显式列出不猜测维度',()=>{
 const p=products();p[0].skus.push({...p[0].skus[0],sku:'SECOND',spec:'大号'});const first=buildMergedProduct(p.slice(0,2),request(p.slice(0,2))).product;const nested=[{...first,id:'merged',revision:1},p[2]];const out=buildMergedProduct(nested,request(nested)).product;assert.equal(out.skus.length,4);assert.equal(out.skus[0].source.product_id,p[0].id);assert.equal(out.skus[2].source.url,p[1].source_url);
});
test('事务创建新草稿、原记录不变、版本保护、幂等恢复及跨空间拒绝',()=>{
 const db=openStore(':memory:'),p=products(),collectors=(teamStore(db),productCollectors(db));let merged;
 try{for(const product of p)db.prepare('INSERT INTO products VALUES(?,?,?,?,?,?,?,?)').run(product.id,'alice',product.source_url,JSON.stringify(product),product.status,product.revision,'now','now');
 const svc=productMerge({db,collectors,audit:(owner,action,id)=>db.prepare('INSERT INTO audit VALUES(?,?,?,?,?)').run('audit-'+Math.random(),owner,action,id,'now'),actor:()=>({sub:'alice',name:'A'})}),b=request(p);
 const before=db.prepare('SELECT * FROM products ORDER BY id').all();assert.throws(()=>svc.preview('bob',b),/工作空间/);assert.equal(svc.preview('alice',b).product.skus.length,4);assert.equal(db.prepare('SELECT COUNT(*) n FROM products').get().n,4);
 merged=svc.create('alice',b);const row=db.prepare('SELECT * FROM products WHERE id=?').get(merged.id);assert.equal(row.status,'draft');assert.equal(row.revision,1);assert.equal(row.source,'merge:'+merged.id);assert.equal(JSON.parse(row.data).source_url,p[0].source_url);assert.deepEqual(db.prepare('SELECT * FROM products WHERE id<>? ORDER BY id').all(row.id),before);assert.equal(db.prepare('SELECT sub FROM product_collectors WHERE product_id=?').get(row.id).sub,'alice');
 db.prepare('UPDATE products SET revision=revision+1 WHERE id=?').run(p[0].id);assert.equal(svc.create('alice',b).id,merged.id);assert.equal(svc.create('alice',{...b,request_id:'another-request-123456789'}).id,merged.id);assert.throws(()=>svc.create('alice',{...b,title:'不同设置'}),/请求已用于/);assert.throws(()=>svc.preview('alice',b),/已更新/);assert.equal(db.prepare('SELECT COUNT(*) n FROM products').get().n,5);const team=teamStore(db).create('alice','合并后迁移',[]);assert.equal(svc.create(team.id,b).id,merged.id);
 }finally{db.close();}
});
test('写入中断整体回滚，不残留新商品、采集归属或幂等回执',()=>{
 const db=openStore(':memory:'),p=products(),collectors=(teamStore(db),productCollectors(db));try{for(const row of p)db.prepare('INSERT INTO products VALUES(?,?,?,?,?,?,?,?)').run(row.id,'alice',row.source_url,JSON.stringify(row),'draft',row.revision,'now','now');const svc=productMerge({db,collectors,audit:()=>{throw Error('audit_failed');},actor:()=>({sub:'alice'})});assert.throws(()=>svc.create('alice',request(p)),/audit_failed/);assert.equal(db.prepare('SELECT COUNT(*) n FROM products').get().n,4);assert.equal(db.prepare('SELECT COUNT(*) n FROM product_merge_requests').get().n,0);assert.equal(db.prepare('SELECT COUNT(*) n FROM product_collectors').get().n,0);}finally{db.close();}
});
