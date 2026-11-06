import test from 'node:test';
import assert from 'node:assert/strict';
import {openStore} from '../core.mjs';
import {productMergeUsage} from '../product-merge-status.mjs';
import {mergeUsages,mergeStatusHTML} from '../public/merge-status.js';
test('历史合并关联不依赖当前采集人/分页，普通合并和同款整理均标记且空间隔离',()=>{
 const db=openStore(':memory:');db.exec('CREATE TABLE product_merge_requests(owner TEXT,request_id TEXT,fingerprint TEXT,product_id TEXT)');
 const add=(id,owner,data)=>db.prepare('INSERT INTO products VALUES(?,?,?,?,?,?,?,?)').run(id,owner,'source-'+id,JSON.stringify(data),'draft',1,'now','now');
 add('source','alice',{title:'原商品'});add('result','alice',{title:'合并标题',merge_sources:[{product_id:'source'}]});add('style','alice',{title:'整理标题',same_style:{},merge_sources:[{product_id:'source'},{product_id:'another'}]});add('foreign','bob',{title:'不能泄露',merge_sources:[{product_id:'source'}]});
 for(const [owner,id] of [['alice','result'],['alice','style'],['bob','foreign']])db.prepare('INSERT INTO product_merge_requests VALUES(?,?,?,?)').run(owner,id,id,id);
 const before=db.prepare('SELECT * FROM products').all(),map=productMergeUsage(db,'alice');assert.deepEqual(map.get('source'),[{id:'result',title:'合并标题',kind:'merge'},{id:'style',title:'整理标题',kind:'same-style'}]);assert.equal(JSON.stringify([...map]).includes('不能泄露'),false);assert.equal(productMergeUsage(db,'nobody').size,0);
 const loaded=[{id:'source',merge_usage:map.get('source')}];assert.equal(mergeUsages(loaded).get('source').length,2);assert.deepEqual(db.prepare('SELECT * FROM products').all(),before);db.close();
});
test('来源和成品标志区分，多个结果保留入口并转义标题，无历史商品无标志',()=>{
 const products=[{id:'s'},{id:'m',title:'<标题>',merge_sources:[{product_id:'s'}]},{id:'n',title:'同款结果',same_style:{},merge_sources:[{product_id:'s'}]}];const map=mergeUsages(products),esc=v=>String(v).replaceAll('<','&lt;').replaceAll('>','&gt;');
 const html=mergeStatusHTML(products[0],map.get('s'),esc);assert.match(html,/已合并/);assert.match(html,/已同款整理/);assert.match(html,/data-open-merge="m"/);assert.match(html,/&lt;标题&gt;/);assert.equal(html.includes('<标题>'),false);assert.match(mergeStatusHTML(products[1],undefined,esc),/合并成品/);assert.match(mergeStatusHTML(products[2],undefined,esc),/同款整理成品/);assert.equal(mergeStatusHTML({id:'untouched'},undefined,esc),'');
 const withServer=mergeUsages([{...products[0],merge_usage:map.get('s')},...products.slice(1)]);assert.equal(withServer.get('s').length,2);
});
