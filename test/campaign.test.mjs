import test from 'node:test';
import assert from 'node:assert/strict';
import {explainCampaign} from '../campaign-ai.mjs';
import {campaignQuote,recommendCampaign} from '../public/campaign.js';

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


test('本地套餐遵守利润率、库存及不同商品约束',()=>{
 const rows=[{id:0,productId:'a',cost:1,stock:0},{id:1,productId:'a',cost:12,stock:5},{id:2,productId:'a',cost:10,stock:4},{id:3,productId:'b',cost:20,stock:9},{id:4,productId:'c',cost:15,stock:3},{id:5,productId:'d',cost:60,stock:5},{id:6,productId:'e',cost:null,stock:10}];
 const options={price:99.9,fixed:6,rate:5,size:3,margin:35};
 const result=recommendCampaign(rows,options);
 assert.equal(result.length,1);
 assert.deepEqual(result[0].items.map(x=>x.id),[2,3,4]);
 assert.equal(result[0].stock,3);
 assert.ok(result[0].quote.margin>=35);
 assert.deepEqual(recommendCampaign(rows,{...options,margin:50}),[]);
});

test('AI 仅收到已校验组合的名称规格，不接收成本库存且只返回理由',async()=>{
 const bundles=[[{id:'a',sku:'a-1'},{id:'b',sku:'b-1'}]];
 const config={endpoint:'https://example.com/v1/chat/completions',model:'deepseek-flash',key:'test'};
 const findProduct=id=>({title:id,category:'日用',skus:[{sku:id+'-1',stock:19,cost:24,spec:'标准'}]});
 const result=await explainCampaign({actor:'campaign-test',config,bundles,findProduct,fetchImpl:async(_,options)=>{
  const body=JSON.parse(options.body),input=JSON.parse(body.messages[1].content);
  assert.deepEqual(input[0].products,[{title:'a',category:'日用',spec:'标准'},{title:'b',category:'日用',spec:'标准'}]);
  return Response.json({choices:[{message:{content:JSON.stringify({reasons:[{index:0,reason:'用途互补',price:1},{index:9,reason:'越界'}]})}}]});
 }});
 assert.deepEqual(result,{reasons:[{index:0,reason:'用途互补'}]});
});
