import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchCrmebToken} from '../crmeb-auth.mjs';
test('CRMEB授权只允许固定商城、不跟随重定向，兼容两种Token字段且拒绝泄密错误',async()=>{
 for(const target of ['crmeb-pro','crmeb-store']){
  let called=0;
  const fetcher=async(url,options)=>{called++;assert.equal(options.method,'POST');assert.equal(options.redirect,'error');assert.deepEqual(JSON.parse(options.body),{appid:'app',appsecret:'private-secret'});assert.equal(url,target==='crmeb-pro'?'https://xlupw.com/outapi/access_token':'https://www.xlyp.cc/outapi/get_token');return {ok:true,text:async()=>JSON.stringify({status:200,data:target==='crmeb-pro'?{access_token:'token'}:{token:'token'}})};};
  assert.equal(await fetchCrmebToken(target,{appid:' app ',appsecret:'private-secret'},fetcher),'token');assert.equal(called,1);
 }
 for(const response of [{status:400,msg:'private-secret',data:{token:'token'}},{status:200,data:{token:'bad\r\nheader'}},{status:200,data:{}},{status:200,data:{token:5}}]){
  await assert.rejects(()=>fetchCrmebToken('crmeb-pro',{appid:'app',appsecret:'private-secret'},async()=>({ok:true,text:async()=>JSON.stringify(response)})),e=>!e.message.includes('private-secret'));
 }
 for(const creds of [{},{appid:'app',appsecret:''},{appid:'app',appsecret:'x\ny'}])await assert.rejects(()=>fetchCrmebToken('crmeb-pro',creds,()=>{throw Error('must not call');}));
 await assert.rejects(()=>fetchCrmebToken('https://evil.test',{appid:'app',appsecret:'secret'}));
});
