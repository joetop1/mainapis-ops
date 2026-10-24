import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const w=JSON.parse(readFileSync(new URL('../workflows/publish-crmeb-pro.json',import.meta.url),'utf8'));
const id='12345678-1234-1234-1234-123456789abc';
const request={body:{job_id:id,action:'publish_draft',target:'crmeb-pro',product:{title:'测试'},callback:{url:'https://ops.mainapis.com/api/callback/'+id,token:'a'.repeat(43)}}};
const run=(node,input,selector)=>vm.runInNewContext('(function(){'+node.parameters.jsCode+'})()',{ $json:input,$:selector });
test('CRMEB 工作流固定目标和凭据类型，不在 JSON 存储密钥',()=>{
 const http=w.nodes.find(n=>n.id==='crmeb-import');assert.equal(http.parameters.url,'https://www.xlupw.com/ops-bridge/import');assert.equal(http.parameters.genericAuthType,'httpHeaderAuth');assert.equal(w.active,false);assert.equal(http.retryOnFail,undefined);
 const pre=w.nodes.find(n=>n.id==='validate'),out=run(pre,request)[0].json;assert.equal(out.request.target,'crmeb-pro');assert.equal(out.request.callback,undefined);assert.equal(out.callbackUrl,request.body.callback.url);
 for(const body of [{...request.body,target:'tigshop'},{...request.body,callback:{url:'https://evil.com',token:'a'.repeat(43)}}])assert.throws(()=>run(pre,{body}));
});
test('商城响应必须明确，成功必须含真实商品 ID，未知结果不回传失败',()=>{
 const node=w.nodes.find(n=>n.id==='check-result'),selector=()=>({first:()=>({json:{callbackUrl:'https://ops.mainapis.com/api/callback/'+id,callbackToken:'secret'}})});
 assert.throws(()=>run(node,{error:'timeout'},selector));assert.throws(()=>run(node,{status:'succeeded'},selector));
 const success=run(node,{status:'succeeded',remote_id:'123',message:'已下架'},selector)[0].json;assert.equal(success.result.remote_id,'123');assert.equal(success.result.status,'succeeded');
 const failure=run(node,{status:'failed',message:'分类未配置'},selector)[0].json;assert.equal(failure.result.status,'failed');assert.equal(failure.result.remote_id,'');
});
