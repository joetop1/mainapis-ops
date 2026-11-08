import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../extensions/1688-collector/popup.js',import.meta.url),'utf8');
const quoteFn=source.slice(source.indexOf('export async function quoteIntoOps'),source.indexOf('export async function importIntoOps')).replace('export ','');
const importFn=source.slice(source.indexOf('export async function importIntoOps'),source.indexOf('\nlet pendingImport=')).replace('export ','');
const product={source_url:'https://detail.1688.com/offer/123.html',title:'商品'};
const confirmed={owner:'team:a',revision:3,due:2,source_url:product.source_url};
function run(fn,fetch,confirmation=confirmed){return vm.runInNewContext('('+fn+')('+JSON.stringify(product)+','+JSON.stringify(confirmation)+')',{location:{origin:'https://ops.mainapis.com'},AbortSignal,fetch});}
const response=value=>({ok:true,json:async()=>value});
test('插件预估与实际导入在OPS标签页执行，带CSRF、确认价格和工作空间',async()=>{
 const requests=[];const fetch=async(url,options={})=>{requests.push({url,options});if(url==='/api/me')return response({user:{sub:'alice'},team:{id:'team:a'},csrf:'secret-csrf'});if(url==='/api/billing/quote')return response({owner:'team:a',workspace:'团队A',revision:3,due:2,available:10});return response({id:'new'});};
 const preview=await run(quoteFn,fetch);assert.equal(preview.quote.due,2);assert.equal(JSON.stringify(preview).includes('secret-csrf'),false);assert.equal(requests.filter(r=>r.url==='/api/products').length,0);
 const imported=await run(importFn,fetch);assert.equal(imported.id,'new');const create=requests.find(r=>r.url==='/api/products');assert.equal(create.options.headers['X-CSRF-Token'],'secret-csrf');assert.equal(create.options.credentials,'same-origin');assert.deepEqual(JSON.parse(create.options.body),{...product,billing_revision:3,billing_owner:'team:a'});
});
test('插件拒绝过期价格、低余额、跨空间和未确认导入；重复来源不写入',async()=>{
 for(const change of [{revision:4},{due:3},{available:1},{owner:'team:b'}]){let writes=0;const result=await run(importFn,async url=>{if(url==='/api/me')return response({user:{sub:'alice'},team:{id:'team:a'},csrf:'csrf'});if(url==='/api/billing/quote')return response({owner:'team:a',revision:3,due:2,available:10,...change});writes++;return response({id:'wrong'});});assert.ok(result.error);assert.equal(writes,0);}
 const missing=await run(importFn,async()=>response({user:{sub:'alice'},team:{id:'team:a'},csrf:'csrf'}),null);assert.match(missing.error,/重新查看费用/);
 let writes=0,exists=false;const fetch=async url=>{if(url==='/api/me')return response({user:{sub:'alice'},team:{id:'team:a'},csrf:'csrf'});if(url==='/api/billing/quote')return response({owner:'team:a',revision:3,due:exists?0:2,available:10,...(exists?{existing:{id:'original'}}:{})});writes++;exists=true;throw Error('response lost');};
 assert.match((await run(importFn,fetch)).error,/未确认导入结果/);const retried=await run(importFn,fetch);assert.equal(retried.duplicate,true);assert.equal(retried.id,'original');assert.equal(writes,1);
});
