import test from 'node:test';
import assert from 'node:assert/strict';
import {optimizeProductTitle} from '../product-title-ai.mjs';

const config={endpoint:'https://example.com/v1/chat/completions',model:'deepseek-flash',key:'test'};

test('标题优化仅发送商品文字，返回标题建议',async()=>{
 const result=await optimizeProductTitle({actor:'valid',config,input:{title:'便携水杯 水杯',specs:['350ml'],description:'不锈钢杯身',price:80,stock:99,source_url:'https://example.com/private'},fetchImpl:async(_,request)=>{
  const body=JSON.parse(request.body),data=JSON.parse(body.messages[1].content);
  assert.deepEqual(Object.keys(data),['title','category','brand','description','specs','attributes']);
  assert.deepEqual(data.specs,['350ml']);
  return Response.json({choices:[{message:{content:'{"title":"便携不锈钢水杯 350ml"}'}}]});
 }});
 assert.deepEqual(result,{title:'便携不锈钢水杯 350ml'});
});

test('没有原题不调用模型，过长或多行建议不接受',async()=>{
 await assert.rejects(optimizeProductTitle({actor:'empty',config,input:{title:' '},fetchImpl:()=>assert.fail('不应调用')}),/原商品标题/);
 for(const [actor,title] of [['long','杯'.repeat(201)],['multiline','水杯\n第二行']]){
  await assert.rejects(optimizeProductTitle({actor,config,input:{title:'原题'},fetchImpl:async()=>Response.json({choices:[{message:{content:JSON.stringify({title})}}]})}),/有效的 AI 标题/);
 }
});
