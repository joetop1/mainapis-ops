import test from 'node:test';
import assert from 'node:assert/strict';
import {createYunzhongBridge,yunzhongCatalog} from '../yunzhong-bridge.mjs';
import {signYunzhong} from '../yunzhong-client.mjs';
import {buildYunzhongProduct,verifyYunzhongProduct} from '../yunzhong-product.mjs';
test('独立入口签名含时效和随机数，仅允许四个固定操作；失败不泄露原响应',async()=>{
 const calls=[],client=createYunzhongBridge({appid:'1',appsecret:'test-only-secret'},async(url,options)=>{calls.push({url,options});return {ok:true,text:async()=>JSON.stringify({result:1,data:{}})};});
 await client('capabilities');await client('create',{product:{marker:'x'}});
 const data=calls.map(({url,options})=>options.method==='POST'?JSON.parse(options.body):Object.fromEntries(new URL(url).searchParams));
 for(const p of data){const signed={...p};delete signed.i;delete signed.route;assert.equal(p.sign,signYunzhong(signed,'test-only-secret'));assert.ok(Math.abs(Number(p.timestamp)-Date.now()/1000)<10);assert.match(p.nonce,/^[0-9a-f]{32}$/);}
 assert.notEqual(data[0].nonce,data[1].nonce);assert.equal(calls[0].options.method,'GET');assert.equal(calls[1].options.method,'POST');
 assert.equal(new URL(calls[0].url).searchParams.get('route'),'mainapis-ops.index');assert.equal(new URL(calls[0].url).searchParams.get('i'),'1');
 await assert.rejects(client('query',{sql:'invalid'}));await assert.rejects(client('detail',{timestamp:0}));assert.equal(calls.length,2);
 const bad=createYunzhongBridge({appid:'1',appsecret:'test-only-secret'},async()=>({ok:true,text:async()=>JSON.stringify({result:0,msg:'sensitive-stack'})}));await assert.rejects(bad('capabilities'),e=>!e.message.includes('sensitive-stack'));
 assert.throws(()=>yunzhongCatalog({contract:'mainapis-yunzhong-1'}));
});
test('独立映射保存三级路径、正文参数和真实多维组合，任何关键读回差异都不判成功',()=>{
 const lease={marker:'OPS-'+'a'.repeat(32),candidate_id:'99',product:{catalog_target:'yunzhong',category_id:3,title:'商品',description:'文字<详情>',attributes:[{name:'材质',value:'棉'}],brand_ids:[7],images:['https://example.com/main.jpg'],detail_images:['https://example.com/detail.jpg'],spec_names:['颜色','尺寸'],skus:[{sku:'A',spec_values:['红','M'],cost:2,price:5,stock:3},{sku:'B',spec_values:['黑','L'],cost:3,price:6,stock:4}]}};
 const config={categoryLevel:3,categoryIds:[1,2,3],dispatchPrice:'0.00',compatibility:true},plan=buildYunzhongProduct(lease,config);
 assert.match(plan.content_html,/材质：棉/);assert.match(plan.content_html,/文字&lt;详情&gt;/);assert.equal(plan.options.option.length,2);
 const actual={id:'99',marker:lease.marker,status:0,title:'商品',brand_id:7,category_paths:[[1,2,3]],price:5,cost_price:2,stock:7,dispatch_type:1,dispatch_price:0,images:plan.base.thumb_url,content_html:plan.content_html,spec_names:['颜色','尺寸'],skus:plan.options.option.map((s,i)=>({sku:s.goods_sn,price:s.product_price,cost:s.cost_price,stock:s.stock,image:s.thumb,spec_values:lease.product.skus[i].spec_values}))};
 assert.equal(verifyYunzhongProduct(actual,lease,config).status,'succeeded');
 for(const mutate of [p=>p.category_paths=[[1,2]],p=>p.content_html='',p=>p.spec_names.reverse(),p=>p.skus[0].stock=50,p=>p.dispatch_price=9,p=>p.stock=0,p=>p.status=1,p=>p.images=[]]){const changed=structuredClone(actual);mutate(changed);assert.equal(verifyYunzhongProduct(changed,lease,config).status,'awaiting_review');}
});
