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


test('兼容单行标题，并区分模型截断与渠道限流',async()=>{
 const run=(actor,response)=>optimizeProductTitle({actor,config,input:{title:'水杯'},fetchImpl:async()=>response()});
 const reply=(content,finish_reason)=>()=>Response.json({choices:[{finish_reason,message:{content}}]});
 assert.deepEqual(await run('plain',reply('建议标题：便携水杯','stop')),{title:'便携水杯'});
 await assert.rejects(run('truncated',reply('便携水','length')),/补试后仍未返回完整标题/);
 await assert.rejects(run('limited',()=>new Response('',{status:429})),/HTTP 429/);
 await assert.rejects(run('broken-json',reply('{"title":','stop')),/有效的 AI 标题/);
});


test('截断且正文不完整时只补试一次，完整 JSON 不重复调用',async()=>{
 const run=async(actor,replies)=>{
  const budgets=[];
  const result=await optimizeProductTitle({actor,config,input:{title:'水杯'},fetchImpl:async(_,req)=>{
   const payload=JSON.parse(req.body);budgets.push(payload.max_tokens);
   assert.equal(payload.thinking.type,'disabled');
   const [content,finish_reason]=replies.shift();
   return Response.json({choices:[{finish_reason,message:{content}}]});
  }});
  return {result,budgets};
 };
 assert.deepEqual(await run('retry',[['','length'],['便携水杯','stop']]),{result:{title:'便携水杯'},budgets:[1024,4096]});
 assert.deepEqual(await run('complete',[['{"title":"便携水杯"}','length']]),{result:{title:'便携水杯'},budgets:[1024]});
});
