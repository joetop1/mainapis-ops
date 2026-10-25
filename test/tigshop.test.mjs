import test from 'node:test';
import assert from 'node:assert/strict';
import {buildTigshopProduct,verifyTigshopProduct,tigshopCreateReceipt} from '../tigshop.mjs';
const lease={marker:'OPS-'+'a'.repeat(32),candidate_id:'10',product:{catalog_target:'tigshop',category_id:1,brand_ids:[2],title:'商品',images:['https://example.com/main.jpg'],skus:[{sku:'a',spec:'红',price:80,cost:40,stock:2,image:'https://example.com/red.jpg'},{sku:'b',spec:'黑',price:160,cost:80,stock:3,image:'https://example.com/black.jpg'}]}};
const shipping={templateId:12};
const fx={sourceCurrency:'CNY',targetCurrency:'EUR',eurPerCny:0.125};
const detail=()=>{const e=buildTigshopProduct(lease,fx,shipping);return {code:0,data:{...e,productId:10,productList:e.productList.map(s=>({...s,skuData:s.attrs.map(a=>({name:a.attrName,value:a.attrValue}))}))}};};
test('maps EUR SKUs and individual images without existing IDs or source mutation',()=>{const before=structuredClone(lease);const e=buildTigshopProduct(lease,fx,shipping);assert.deepEqual(lease,before);assert.equal(e.shopId,0);assert.equal(e.productStatus,0);assert.equal(e.productList[0].skuPrice,'10.00');assert.equal(e.attrList.spe[0].attrList[1].attrPic,lease.product.skus[1].image);assert.equal(e.productList[0].skuId,undefined);assert.equal(e.productStock,5);});
test('verifies actual detail and rejects currency, owner, SKU and image mismatches',()=>{assert.equal(verifyTigshopProduct(detail(),lease,fx,shipping).status,'succeeded');for(const mutate of [d=>d.shopId=1,d=>d.productStatus=1,d=>d.productList[0].skuPrice='80',d=>d.productList[1].skuSn='a',d=>d.attrList.spe[0].attrList[0].attrPic='https://example.com/wrong.jpg']){const r=detail();mutate(r.data);assert.equal(verifyTigshopProduct(r,lease,fx,shipping).status,'awaiting_review');}});
test('creation success never claims verified success',()=>{assert.equal(tigshopCreateReceipt({code:0,data:'商品已添加'}).status,'awaiting_review');assert.equal(tigshopCreateReceipt({code:1001}).status,'unknown');});

test('requires an explicit shipping template',()=>{assert.throws(()=>buildTigshopProduct(lease,fx));const e=buildTigshopProduct(lease,fx,shipping);assert.equal(e.fixedShippingType,2);assert.equal(e.freeShipping,0);assert.equal(e.shippingTplId,12);});
import {readFileSync} from 'node:fs';
test('generated workflow uses independent credentials and preserved snapshot FX',()=>{
 const w=JSON.parse(readFileSync(new URL('../workflows/publish-tigshop.json',import.meta.url)));
 for(const n of w.nodes.filter(n=>['token','create','detail'].includes(n.id))){assert.equal(n.parameters.genericAuthType,'httpHeaderAuth');assert.equal(n.retryOnFail,false);assert.equal(n.parameters.headerParameters.parameters[0].name,'X-ADMIN-TYPE');}
 for(const n of w.nodes.filter(n=>n.type==='n8n-nodes-base.code'))assert.doesNotThrow(()=>new Function(n.parameters.jsCode));
 assert.equal(w.nodes.find(n=>n.id==='webhook').parameters.path,'ops-tigshop');
 assert.match(w.nodes.find(n=>n.id==='prepare').parameters.jsCode,/lease.product.tigshop/);
});
test('zero total stock is rejected before any create request can be claimed',()=>{const empty=structuredClone(lease);for(const sku of empty.product.skus)sku.stock=0;assert.throws(()=>buildTigshopProduct(empty,fx,shipping),/总库存必须大于/);});

test('supplies gallery and SKU thumbnail fields used by the Tigshop admin',()=>{
 const e=buildTigshopProduct(lease,fx,shipping);
 assert.equal(e.picThumb,lease.product.images[0]);
 assert.equal(e.imgList[0].picThumb,lease.product.images[0]);
 for(const [i,a] of e.attrList.spe[0].attrList.entries())assert.equal(a.attrPicThumb,lease.product.skus[i].image);
});
