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
