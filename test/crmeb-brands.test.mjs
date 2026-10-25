import test from 'node:test';
import assert from 'node:assert/strict';
import {crmebBrandReader} from '../crmeb-brands.mjs';
import {createCatalogLoader,applyCatalog} from '../catalog.mjs';
const tree={status:200,data:[{value:11,label:'品牌系列',children:[{value:99,label:'刚新增的品牌'}]}]};
test('reads unassociated backend brands with hierarchy and authenticates each mall independently',async()=>{
 for(const target of ['crmeb-pro','crmeb-store']){
  const calls=[],base=target==='crmeb-pro'?'https://xlupw.com':'https://www.xlyp.cc';
  const fetcher=async(url,options)=>{calls.push({url,options});assert.equal(options.redirect,'error');return {ok:true,status:200,text:async()=>JSON.stringify(url.endsWith('/brand/list')?tree:{status:200,data:target==='crmeb-pro'?{access_token:'member-access'}:{token:'store-access'}})};};
  const read=crmebBrandReader(target,{appid:'app-'+target,appsecret:'private'},fetcher);
  let publicBrandCalled=false;
  const loader=createCatalogLoader(async url=>{if(url.endsWith('/api/brand'))publicBrandCalled=true;return {status:200,data:[]};},target,read);
  const catalog=await loader();assert.equal(publicBrandCalled,false);assert.deepEqual(catalog.brands[1].ids,[11,99]);
  const p={catalog_target:target,brand_ids:[11,99]};assert.equal(applyCatalog(p,catalog),p);
  assert.equal(calls[0].url,base+(target==='crmeb-pro'?'/outapi/access_token':'/outapi/get_token'));
  assert.equal(JSON.parse(calls[0].options.body).appid,'app-'+target);
  assert.equal(calls[1].url,base+'/outapi/brand/list');
  assert.equal(calls[1].options.headers.Authorization,calls[1].options.headers['Authori-zation']);
  await loader(true);assert.equal(calls.length,4);
 }
});
test('backend brand failure is explicit and never falls back to an incomplete public list',async()=>{
 const read=crmebBrandReader('crmeb-store',{appid:'app',appsecret:'secret'},async(url)=>({ok:!url.endsWith('/brand/list'),status:url.endsWith('/brand/list')?404:200,text:async()=>JSON.stringify({status:200,data:{token:'test'}})}));
 await assert.rejects(read,/尚未安装/);
 let brandCalls=0;
 const loader=createCatalogLoader(async url=>{if(url.endsWith('/brand'))brandCalls++;return {status:200,data:[]};},'crmeb-store',read);
 const catalog=await loader();assert.ok(catalog.brandError);assert.equal(brandCalls,0);assert.deepEqual(catalog.brands,[]);
});
