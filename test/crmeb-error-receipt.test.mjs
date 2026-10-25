import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
test('创建失败仍回传未知状态，锁不释放，无自动重试且不泄露原始错误',()=>{
 const code=readFileSync(new URL('../workflows/crmeb-create-receipt.js',import.meta.url),'utf8');
 for(const input of [{error:'502 Bearer private-token'}, {error:{message:'timeout',request:{headers:{authorization:'private-token'}}}}, {status:200,error:'private-token'}, {}, {status:400}, null]){
  const result=vm.runInNewContext(`(function(){${code}})()`,{$json:input})[0].json;
  assert.equal(result.status,'unknown');assert.equal(JSON.stringify(result).includes('private-token'),false);assert.equal(result.remote_id,undefined);
 }
 const result=vm.runInNewContext(`(function(){${code}})()`,{$json:{status:200,msg:'ok'}})[0].json;assert.equal(result.status,'awaiting_review');
 for(const target of ['official','store']){
  const w=JSON.parse(readFileSync(new URL(`../workflows/publish-crmeb-${target}.json`,import.meta.url)));
  for(const id of ['create','detail']){const n=w.nodes.find(n=>n.id===id);assert.equal(n.onError,'continueRegularOutput');assert.equal(n.retryOnFail,false);}
  const from=w.nodes.find(n=>n.id==='create').name,receiptName=w.nodes.find(n=>n.id==='receipt').name,callback=w.nodes.find(n=>n.id==='callback').name;
  assert.equal(w.connections[from].main[0][0].node,receiptName);assert.equal(w.connections[receiptName].main[0][0].node,callback);
 }
});
