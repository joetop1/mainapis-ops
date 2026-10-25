import test from 'node:test';
import assert from 'node:assert/strict';
import {validateCrmebWebhook,testCrmebWebhook} from '../crmeb-webhook.mjs';
const token='a'.repeat(48),url='https://n8n.mainapis.com/webhook/ops-crmeb-official';
test('limits saved publishing endpoints to the corresponding production webhook',()=>{
 assert.deepEqual(validateCrmebWebhook('crmeb-pro',url,token),{url,token});
 for(const candidate of ['http://n8n.mainapis.com/webhook/ops-crmeb-official','https://evil.example/webhook/ops-crmeb-official','https://n8n.mainapis.com/webhook/ops-crmeb-store',url+'?secret=test','https://user:pass@n8n.mainapis.com/webhook/ops-crmeb-official'])assert.throws(()=>validateCrmebWebhook('crmeb-pro',candidate,token));
 assert.throws(()=>validateCrmebWebhook('crmeb-pro',url,'short'));assert.throws(()=>validateCrmebWebhook('crmeb-pro',url,token+'\n'));
});
test('test probe never sends a valid publish task and explains ingress failures',async()=>{
 for(const status of [200,403,404,302,500]){
  const result=await testCrmebWebhook({url,token},async(actual,options)=>{assert.equal(actual,url);assert.equal(options.redirect,'manual');assert.equal(options.headers['X-Ops-Token'],token);const b=JSON.parse(options.body);assert.equal(b.action,'ops_connection_test');assert.equal(b.product,undefined);assert.equal(b.job_id,undefined);return {status};});
  assert.equal(result.httpStatus,status);assert.equal(result.ok,status===200);assert.ok(!JSON.stringify(result).includes(token));
 }
});
