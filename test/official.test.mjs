import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {validateProduct} from '../core.mjs';
import {readFileSync} from 'node:fs';
import {buildOfficialProduct,officialCreateReceipt,verifyOfficialProduct,requireOfficialToken} from '../crmeb-official.mjs';
const lease={job_id:'12345678-1234-1234-1234-123456789abc',marker:'OPS-12345678123412341234123456789abc',candidate_id:'42',action:'publish_draft',product:{source_url:'https://detail.1688.com/offer/123.html',title:'测试商品',category:'测试分类',description:'<script>test</script>',images:['https://xlupw.com/test.jpg'],skus:[{sku:'SKU-A',spec:'白色 / 小号',price:10,cost:5,stock:2},{sku:'SKU-B',spec:'黑色 / 大号',price:15,cost:8,stock:3}]}};
const cfg={categoryMap:{'测试分类':[116]},shippingTemplateId:7};
test('品牌、商品标签和虚拟销量保存、转换及实际详情核验',()=>{
 const product=validateProduct({...lease.product,brand_ids:[2,3],tag_ids:[7,8],virtual_sales:123});
 const l={...lease,product};const p=buildOfficialProduct(l,cfg);
 assert.deepEqual(p.brand_id,[2,3]);assert.deepEqual(p.store_label_id,[7,8]);assert.equal(p.ficti,123);assert.equal(p.sales,0);assert.deepEqual(p.label_id,[]);
 const d={...p,id:42,store_label_id:[{id:7,label_name:'标签A'},{id:8,label_name:'标签B'}]};
 assert.equal(verifyOfficialProduct({status:200,data:{productInfo:d}},l,cfg).status,'succeeded');
 for(const patch of [{brand_id:[3]},{store_label_id:[{id:7}]},{ficti:0}])assert.equal(verifyOfficialProduct({status:200,data:{productInfo:{...d,...patch}}},l,cfg).status,'awaiting_review');
 for(const patch of [{brand_ids:[0]},{tag_ids:[7,7]},{tag_ids:['7']},{virtual_sales:-1},{virtual_sales:1.5}])assert.throws(()=>validateProduct({...product,...patch}));
 const old=validateProduct(lease.product);assert.deepEqual(old.brand_ids,[]);assert.deepEqual(old.tag_ids,[]);assert.equal(old.virtual_sales,0);
});
test('官方字段转换：下架、多SKU、运费映射，不触发来源自动覆盖',()=>{
 const p=buildOfficialProduct(lease,cfg);assert.equal(p.is_show,0);assert.equal(p.auto_on_time,0);assert.equal(p.soure_link,'');assert.equal(p.code,lease.marker);assert.deepEqual(p.cate_id,[116]);assert.equal(p.temp_id,7);assert.equal(p.freight,3);assert.equal(p.spec_type,1);assert.equal(p.attrs.length,2);assert.equal(p.attrs[0].detail['规格'],'白色 / 小号');assert.equal(p.attrs[1].code,'SKU-B');assert.equal(p.description.includes('<script>'),false);assert.equal(p.ficti,0);
});
test('缺少真实运费/分类、无效SKU、负数或重复规格在创建前拒绝',()=>{
 assert.throws(()=>buildOfficialProduct(lease,{...cfg,shippingTemplateId:0}));assert.throws(()=>buildOfficialProduct(lease,{...cfg,categoryMap:{}}));
 for(const patch of [{sku:'bad code'},{price:0},{stock:.5},{spec:'黑色 / 大号'}]){const p=structuredClone(lease);Object.assign(p.product.skus[0],patch);assert.throws(()=>buildOfficialProduct(p,cfg));}
});
test('单SKU有自定义规格也保留名称；无规格采用默认',()=>{
 const l=structuredClone(lease);l.product.skus=[l.product.skus[0]];assert.equal(buildOfficialProduct(l,cfg).spec_type,1);l.product.skus[0].spec='';const p=buildOfficialProduct(l,cfg);assert.equal(p.spec_type,0);assert.equal(p.attr.code,'SKU-A');
});
test('商城选中的分类ID直接发布，不依赖名称映射',()=>{
 const l={...lease,product:{...lease.product,category:'服饰 / 袜子',category_id:97}};
 assert.deepEqual(buildOfficialProduct(l,{...cfg,categoryMap:{}}).cate_id,[97]);
});
test('官方200不当成已核验成功；错误响应保守归为未知',()=>{
 assert.equal(officialCreateReceipt({status:200,msg:'保存成功'}).status,'awaiting_review');assert.equal(officialCreateReceipt({status:400}).status,'unknown');
 assert.equal(requireOfficialToken({status:200,data:{access_token:'secret',appwd:'not-returned'}}),'secret');assert.throws(()=>requireOfficialToken({status:200,data:{token:'legacy-only'}}));
});
test('详情核验：真实ID、编码、下架、分类和每行SKU价格库存匹配',()=>{
 const p=buildOfficialProduct(lease,cfg),d={...p,id:42};assert.equal(verifyOfficialProduct({status:200,data:d},lease,cfg).status,'succeeded');
 assert.equal(verifyOfficialProduct({status:200,data:{productInfo:d}},lease,cfg).status,'succeeded');
 assert.equal(verifyOfficialProduct({status:200,data:{productInfo:{...d,code:'OTHER'}}},lease,cfg).status,'awaiting_review');
 for(const patch of [{id:99},{code:'OTHER'},{is_show:1},{store_name:'其他商品'},{cate_id:[1]},{attrs:[]}])assert.equal(verifyOfficialProduct({status:200,data:{...d,...patch}},lease,cfg).status,'awaiting_review');
 for(const key of ['price','stock','cost']){const wrong=structuredClone(d);wrong.attrs[0][key]++;assert.equal(verifyOfficialProduct({status:200,data:wrong},lease,cfg).status,'awaiting_review');}
});
test('SKU独立图片经过保存、发布及详情核验，不统一写成首图',()=>{
 const l=structuredClone(lease);l.product.skus[0].image='https://example.com/red.jpg';l.product.skus[1].image='https://example.com/blue.jpg';l.product=validateProduct(l.product);
 const p=buildOfficialProduct(l,cfg);assert.equal(p.attrs[0].pic,l.product.skus[0].image);assert.equal(p.attrs[1].pic,l.product.skus[1].image);assert.equal(p.items[0].detail[1].pic,l.product.skus[1].image);
 const d={...p,id:42};assert.equal(verifyOfficialProduct({status:200,data:{productInfo:d}},l,cfg).status,'succeeded');
 d.attrs[1].pic=d.attrs[0].pic;assert.equal(verifyOfficialProduct({status:200,data:{productInfo:d}},l,cfg).status,'awaiting_review');
 for(const image of ['http://example.com/a.jpg','https://user:password@example.com/a.jpg','javascript:alert(1)']){const wrong=structuredClone(l.product);wrong.skus[0].image=image;assert.throws(()=>validateProduct(wrong));}
});
test('可导入工作流：凭据不入文件，预检先于领取，HTTP不自动重试',()=>{
 const w=JSON.parse(readFileSync(new URL('../workflows/publish-crmeb-official.json',import.meta.url)));
 assert.equal(w.active,false);assert.equal(w.nodes.some(n=>n.parameters?.url?.includes('/ops-bridge/')),false);
 const pre=w.nodes.find(n=>n.id==='preflight');const run=b=>vm.runInNewContext('(function(){'+pre.parameters.jsCode+'})()',{$json:{body:b}});
 const b={job_id:lease.job_id,action:'publish_draft',target:'crmeb-pro',callback:{url:'https://ops.mainapis.com/api/callback/'+lease.job_id,token:'a'.repeat(43)}};
 assert.equal(run(b)[0].json.action,'publish_draft');assert.throws(()=>run({...b,callback:{url:'https://evil.com',token:'a'.repeat(43)}}));
 const token=w.nodes.find(n=>n.id==='token');assert.equal(token.parameters.genericAuthType,'httpCustomAuth');assert.equal(token.credentials,undefined);
 const create=w.nodes.find(n=>n.id==='create');assert.equal(create.parameters.url,'https://xlupw.com/outapi/product');assert.equal(create.retryOnFail,false);
 assert.equal(w.connections['创建还是核对'].main[0][0].node,'锁定一次创建');assert.equal(w.connections['锁定一次创建'].main[0][0].node,'官方新增下架商品');
 for(const n of w.nodes.filter(n=>n.type==='n8n-nodes-base.code'))assert.doesNotThrow(()=>new vm.Script('(function(){'+n.parameters.jsCode+'})()'));
});
test('商品详情只使用独立详情图片，不使用主图或规格图片代替',()=>{
 const l=structuredClone(lease);l.product.detail_images=['https://example.com/detail.jpg'];
 const payload=buildOfficialProduct(l,cfg);assert.ok(payload.description.includes('https://example.com/detail.jpg'));assert.equal(payload.description.includes(l.product.images[0]),false);
 delete l.product.detail_images;assert.equal(buildOfficialProduct(l,cfg).description.includes('<img'),false);
});
