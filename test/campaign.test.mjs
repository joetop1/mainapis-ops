import test from 'node:test';
import assert from 'node:assert/strict';
import {campaignQuote} from '../public/campaign.js';

test('套餐按 SKU 数量汇总成本，扣除运费包材和按成交额计算的平台费',()=>{
 const result=campaignQuote([{cost:12.35,quantity:2},{cost:8,quantity:1}],99.9,6.5,5);
 assert.equal(result.cost,32.7);
 assert.equal(result.profit,55.7);
 assert.equal(result.breakEven,41.27);
});
test('成本未核对、数量无效时不计算利润',()=>{
 for(const cost of [null,undefined,0,NaN])assert.equal(campaignQuote([{cost,quantity:1}],99.9,0,0),null);
 assert.equal(campaignQuote([{cost:12,quantity:0}],99.9,0,0),null);
});
