import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openStore} from '../core.mjs';
import {connectionStore} from '../connection-store.mjs';
import {supplierAISettings} from '../supplier-ai.mjs';

test('后台配置加密保存，不返回令牌，worker 可读取变更，换地址不复用旧令牌',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ops-ai-settings-')),path=join(dir,'test.sqlite'),db=openStore(path),worker=openStore(path);
 try{
  const store=await connectionStore(db,dir,'supplier-ai'),workerStore=await connectionStore(worker,dir,'supplier-ai');
  const env={OPS_SUPPLIER_AI_KEY:'legacy-key',OPS_SUPPLIER_AI_MODEL:'legacy-model'};
  const server=supplierAISettings(store,{env}),runtime=supplierAISettings(workerStore,{env});
  assert.equal(runtime.get().model,'legacy-model');
  const base='https://api.mainapis.com/v1',key='new-token-for-tests',model='text-model';
  assert.deepEqual(server.save({base,key,model,enabled:true}),{base,model,enabled:true,has_key:true});
  assert.doesNotMatch(db.prepare('SELECT encrypted FROM connections_supplier_ai').get().encrypted,/new-token-for-tests/);
  assert.equal(runtime.get().model,model);assert.equal(runtime.get().key,key);
  assert.throws(()=>server.save({base:'https://other.example.com/v1',model,enabled:true}),/重新填写/);
  assert.throws(()=>server.save({base:'https://127.0.0.1/v1',key,model,enabled:true}),/公网 HTTPS/);
  server.save({base,model,enabled:false});
  assert.equal(runtime.get(),null);assert.equal(server.view().has_key,true);
 }finally{worker.close();db.close();await rm(dir,{recursive:true,force:true});}
});

test('后台获取模型并测试聊天补全，不保存未提交的令牌',async()=>{
 let stored;const calls=[];
 const settings=supplierAISettings({get:()=>stored,set:(_,value)=>{stored=value;}},{env:{},fetchImpl:async(url,request)=>{
  calls.push([url,request]);assert.equal(request.headers.Authorization,'Bearer test-token');
  return Response.json(url.endsWith('/models')?{data:[{id:'text-model'},{id:'text-model'},{id:null}]}:{choices:[{message:{content:'OK'}}]});
 }});
 const body={base:'https://api.mainapis.com/v1',key:'test-token',model:'text-model',enabled:true};
 assert.deepEqual(await settings.models(body),{models:['text-model']});
 assert.deepEqual(await settings.test(body),{model:'text-model'});
 assert.equal(calls[0][1].method,'GET');assert.equal(JSON.parse(calls[1][1].body).model,'text-model');
 assert.equal(stored,undefined);
});

test('AI 兼容可核对的坐标写法并记录响应诊断，不记录响应正文',async()=>{
 const {recognizeSupplierBlocks}=await import('../supplier-ai.mjs');
 const products=[{key:'a',barcodes:[]},{key:'b',barcodes:[]}];
 const source={a:{A1:'原名',B1:'Original'},b:{A2:'另一件'}};
 const config={endpoint:'https://example.com',key:'test',model:'test'};
 const run=(content,model='test')=>recognizeSupplierBlocks(products,source,{...config,model},async(_,request)=>{
  const payload=JSON.parse(request.body);
  assert.deepEqual(payload.thinking,model==='deepseek-flash'?{type:'disabled'}:undefined);
  assert.equal(payload.max_tokens,1800);
  return Response.json({choices:[{finish_reason:'length',message:{content,reasoning_content:'reasoning text'}}]});
 });
 const good=await run(JSON.stringify({items:[{id:'0',fields:{title_zh:'$a$1',title_en:['B1'],spec:['A2']}}]}));
 assert.equal(good.recognized,1);assert.equal(good.diagnostics.bilingual_titles,1);assert.equal(good.diagnostics.invalid_fields,1);assert.equal(good.diagnostics.missing_items,1);
 const empty=await run('', 'deepseek-flash');
 assert.equal(empty.diagnostics.reasoning_without_content,1);
 const bad=await run('{"items":[');
 assert.equal(bad.unresolved,2);assert.equal(bad.diagnostics.invalid_json,1);assert.equal(bad.diagnostics.length_limited,1);
});
