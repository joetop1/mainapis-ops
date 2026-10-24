import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
test('多门店探测只授权和读取，不使用会员凭据或写商品接口',()=>{
 const w=JSON.parse(readFileSync(new URL('../workflows/inspect-crmeb-store.json',import.meta.url)));
 const requests=w.nodes.filter(x=>x.type==='n8n-nodes-base.httpRequest');assert.equal(requests.length,2);
 assert.equal(requests[0].parameters.url,'https://www.xlyp.cc/outapi/get_token');assert.equal(requests[0].credentials,undefined);assert.equal(requests[1].parameters.method,'GET');
 assert.equal(w.active,false);assert.equal(w.settings.saveManualExecutions,false);
 for(const r of requests){assert.equal(r.retryOnFail,false);assert.equal(r.parameters.options.redirect.redirect.followRedirects,false);}
 const validate=w.nodes.find(x=>x.id==='validate').parameters.jsCode;
 const run=data=>vm.runInNewContext('(function(){'+validate+'})()',{$json:data});
 assert.equal(run({status:200,data:{token:'private-token'}})[0].json.token,'private-token');
 assert.equal(run({token:'private-token'})[0].json.token,'private-token');assert.throws(()=>run({status:400,data:{token:'bad'}}));assert.throws(()=>run({status:200,data:{}}));
 const summary=w.nodes.find(x=>x.id==='summary').parameters.jsCode;
 const result=vm.runInNewContext('(function(){'+summary+'})()',{$json:{status:200,data:[{id:5,cate_name:'测试分类',token:'must-not-leak'}]}});
 assert.equal(result[0].json.category_count,1);assert.equal(JSON.stringify(result).includes('must-not-leak'),false);
});
