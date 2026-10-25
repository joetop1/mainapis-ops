import test from 'node:test';
import assert from 'node:assert/strict';
import {tigshopPrices} from '../tigshop-pricing.mjs';
const config={sourceCurrency:'CNY',targetCurrency:'EUR',eurPerCny:0.125};
test('converts price and cost without changing source or SKU images/stock',()=>{
 const source=[{sku:'A',price:19.99,cost:4.73,stock:7,image:'https://example.com/a.jpg'}];
 const before=structuredClone(source),result=tigshopPrices(source,config);
 assert.deepEqual(source,before);assert.equal(result[0].price,2.5);assert.equal(result[0].cost,0.59);
 assert.equal(result[0].stock,7);assert.equal(result[0].image,source[0].image);
});
test('rejects missing, invalid and reversed currency configuration',()=>{
 const skus=[{price:10,cost:2}];
 for(const rate of [undefined,0,-1,Infinity,NaN,'0.125',8])assert.throws(()=>tigshopPrices(skus,{...config,eurPerCny:rate}));
 assert.throws(()=>tigshopPrices(skus,{...config,sourceCurrency:'EUR',targetCurrency:'CNY'}));
 assert.throws(()=>tigshopPrices([{price:0.01,cost:0}],config));
});
import {parseTigshopFX,fetchTigshopFX,TIGSHOP_FX_URL} from '../tigshop-pricing.mjs';
const xml="<Cube><Cube time='2026-10-23'><Cube currency='CNY' rate='7.466'/></Cube></Cube>";
test('uses the reciprocal ECB quote on weekends with provenance',()=>{
 const fx=parseTigshopFX(xml,new Date('2026-10-25T03:00:00Z'));
 assert.equal(fx.cnyPerEur,7.466);assert.equal(fx.eurPerCny,1/7.466);assert.equal(fx.rateDate,'2026-10-23');
 assert.equal(tigshopPrices([{price:74.66,cost:7.466}],fx)[0].price,10);
 for(const bad of [xml.replace('7.466','0'),xml.replace('CNY','USD'),xml.replace('2026-10-23','2026-10-01'),xml.replace('2026-10-23','2026-11-01')])assert.throws(()=>parseTigshopFX(bad,new Date('2026-10-25')));
});
test('fetch is fixed-origin, disallows redirects and fails closed',async()=>{
 const fx=await fetchTigshopFX(async(url,options)=>{assert.equal(url,TIGSHOP_FX_URL);assert.equal(options.redirect,'error');return {ok:true,text:async()=>xml};},new Date('2026-10-25'));
 assert.equal(fx.rateDate,'2026-10-23');
 await assert.rejects(()=>fetchTigshopFX(async()=>({ok:false})));
});
