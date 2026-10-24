import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {buildStoreProduct,verifyStoreProduct,requireStoreToken,STORE_FIELDS} from '../crmeb-store.mjs';
const lease={job_id:'12345678-1234-1234-1234-123456789abc',marker:'OPS-12345678123412341234123456789abc',candidate_id:'8',product:{catalog_target:'crmeb-store',category_id:91,category:'多门店袜子',source_url:'https://detail.1688.com/offer/123.html',title:'测试袜子',images:['https://example.com/main.jpg'],skus:[{sku:'ALI-1',spec:'',image:'https://example.com/sku.jpg',price:10,cost:4.73,stock:2}]}};
const config={shippingTemplateId:3};
test('多门店字段独立适配：单SKU强制多规格、下架、独立图片、字段白名单',()=>{
 const p=buildStoreProduct(lease,config);assert.deepEqual(Object.keys(p),STORE_FIELDS);assert.equal(Object.values(p).some(v=>v===undefined),false);
 assert.equal(p.spec_type,1);assert.equal(p.attrs.length,1);assert.equal(p.attrs[0].detail['规格'],'默认');assert.equal(p.attrs[0].pic,lease.product.skus[0].image);assert.equal(p.attr,undefined);assert.equal(p.is_show,0);assert.equal(p.type,0);assert.equal(p.supplier_id,0);assert.equal(p.auto_on_time,0);assert.equal(p.temp_id,3);assert.equal(p.product_clear,undefined);
 const detail={...p,id:8};assert.equal(verifyStoreProduct({status:200,data:{productInfo:detail}},lease,config).status,'succeeded');
 assert.throws(()=>buildStoreProduct({...lease,product:{...lease.product,catalog_target:'crmeb-pro'}},config));assert.throws(()=>buildStoreProduct(lease,{shippingTemplateId:0}));
 assert.equal(requireStoreToken({status:200,data:{token:'secret'}}),'secret');assert.throws(()=>requireStoreToken({status:400,data:{token:'bad'}}));
});
test('多门店轮播最多5张且限制序列化长度，详情和SKU图片完整保留',()=>{
 const l=structuredClone(lease);l.product.images=Array.from({length:29},(_,i)=>'https://cbu01.alicdn.com/img/ibank/photo-'+i+'.jpg');
 const original=JSON.stringify(l),p=buildStoreProduct(l,config);assert.equal(p.slider_image.length,5);assert.equal(p.attrs[0].pic,l.product.skus[0].image);assert.ok(p.description.includes('photo-28.jpg'));assert.equal(JSON.stringify(l),original);
 l.product.images=['https://example.com/'+('a'.repeat(600))+'.jpg','https://example.com/'+('b'.repeat(600))+'.jpg'];assert.equal(buildStoreProduct(l,config).slider_image.length,1);
 l.product.images=['https://example.com/'+('a'.repeat(1100))+'.jpg'];assert.throws(()=>buildStoreProduct(l,config),/地址过长/);
});
test('多门店工作流隔离域名、Token路径、目标和字段，不携带会员凭据',()=>{
 const w=JSON.parse(readFileSync(new URL('../workflows/publish-crmeb-store.json',import.meta.url)));
 const get=id=>w.nodes.find(x=>x.id===id);assert.equal(get('token').parameters.url,'https://www.xlyp.cc/outapi/get_token');assert.equal(get('token').credentials,undefined);assert.equal(get('create').parameters.url,'https://www.xlyp.cc/outapi/product');assert.equal(get('webhook').parameters.path,'ops-crmeb-store');
 assert.ok(get('preflight').parameters.jsCode.includes("b.target!=='crmeb-store'"));assert.ok(get('prepare').parameters.jsCode.includes('buildStoreProduct(lease,config)'));assert.ok(get('verify').parameters.jsCode.includes('verifyStoreProduct($json,lease,config)'));
 for(const id of ['create','detail','authcheck']){const h=get(id).parameters.headerParameters.parameters;assert.equal(h.find(x=>x.name==='Authorization').value,h.find(x=>x.name==='Authori-zation').value);}
 assert.equal(get('authcheck').parameters.method,'GET');assert.equal(w.connections['获取 CRMEB Token'].main[0][0].node,'只读验证多门店授权');assert.equal(w.connections['只读验证多门店授权'].main[0][0].node,'配置分类运费并转换字段');
 assert.ok(get('prepare').parameters.jsCode.includes('多门店授权或分类详情检查未通过，未领取创建操作'));
 for(const node of w.nodes.filter(x=>x.type==='n8n-nodes-base.code'))assert.doesNotThrow(()=>new vm.Script('(function(){'+node.parameters.jsCode+'})()'));
});
