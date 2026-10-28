import test from 'node:test';
import assert from 'node:assert/strict';
import {buildShopxoProduct,verifyShopxoProduct} from '../shopxo-product.mjs';
import {createShopxoClient,shopxoCatalog,shopxoSignature,requireShopxoConnection} from '../shopxo-client.mjs';
const marker='OPS-'+'a'.repeat(32),lease={marker,candidate_id:'18',product:{catalog_target:'shopxo',category_id:2,title:'商品测试',brand_ids:[3],description:'文字&详情',attributes:[{name:'材质',value:'棉'}],images:['https://example.com/main.jpg'],detail_images:['https://example.com/d.jpg'],virtual_sales:100,spec_names:['颜色','尺寸'],skus:[{sku:'A',spec_values:['红','M'],price:12,cost:2,stock:3,image:'https://example.com/red.jpg'},{sku:'B',spec_values:['红','L'],price:13,cost:3,stock:4,image:'https://example.com/red.jpg'}],shopxo:{warehouseId:7}}};
function actual(){const p=buildShopxoProduct(lease,7);return {id:'18',marker,status:0,stock:7,cover:p.images[0],category_id:p.category_id,brand_id:p.brand_id,warehouse_id:7,title:p.title,images:p.images,detail_images:p.detail_images,content_html:p.content_html,spec_names:p.spec_names,skus:p.skus.map(s=>({...s,warehouse_stock:s.stock}))};}
test('ShopXO保留明确SKU组合、参考成本、图片文字参数与仓库；虚拟销量忽略且不修改源资料',()=>{
 const before=structuredClone(lease),p=buildShopxoProduct(lease,7);assert.deepEqual(lease,before);assert.equal(p.warehouse_id,7);assert.equal(p.skus.length,2);assert.match(p.content_html,/材质：棉/);assert.match(p.content_html,/文字&amp;详情/);assert.equal(p.virtual_sales,undefined);assert.equal(p.image_axis,0);assert.equal(verifyShopxoProduct(actual(),lease).status,'succeeded');
 for(const mutate of [v=>v.cover='',v=>v.detail_images=[],v=>v.warehouse_id=8,v=>v.status=1,v=>v.stock=0,v=>v.skus[0].warehouse_stock=0,v=>v.skus[0].stock=0,v=>v.skus[0].image='',v=>v.content_html='',v=>v.skus[0].cost=0]){const a=actual();mutate(a);assert.equal(verifyShopxoProduct(a,lease).status,'awaiting_review');}
});
test('ShopXO拒绝无法表达的规格配图与仓库、标签或金额，不产生笛卡尔组合',()=>{
 assert.throws(()=>buildShopxoProduct(lease,0));assert.throws(()=>buildShopxoProduct({...lease,product:{...lease.product,tag_ids:[1]}},7));assert.throws(()=>buildShopxoProduct({...lease,product:{...lease.product,skus:[{...lease.product.skus[0],price:1.234}]}},7));
 const p=structuredClone(lease.product);p.skus=[{sku:'1',spec_values:['红','M'],price:1,cost:0,stock:1,image:'https://example.com/1.jpg'},{sku:'2',spec_values:['红','L'],price:1,cost:0,stock:1,image:'https://example.com/2.jpg'},{sku:'3',spec_values:['蓝','M'],price:1,cost:0,stock:1,image:'https://example.com/3.jpg'}];assert.throws(()=>buildShopxoProduct({...lease,product:p},7),/规格图片/);
});
test('ShopXO仅调用固定签名POST入口，禁止重定向并保留不确定写入提示',async()=>{
 const connection={url:'https://mall.example.com',appid:'ops_12345678',appsecret:'a'.repeat(64)},calls=[];
 const client=createShopxoClient(connection,async(url,options)=>{const envelope=JSON.parse(options.body);assert.equal(envelope.sign,shopxoSignature(envelope.request,connection.appsecret));const request=JSON.parse(Buffer.from(envelope.request,'base64'));assert.equal(request.appid,connection.appid);calls.push({url,options,request});return {ok:true,text:async()=>JSON.stringify({code:0,data:{ok:true}})};});
 await client('capabilities');await client('create',{product:buildShopxoProduct(lease,7)});assert.equal(calls[1].url,'https://mall.example.com/mainapis-shopxo.php');assert.equal(calls[1].options.redirect,'error');assert.equal(calls[1].options.method,'POST');assert.ok(calls[1].options.dispatcher);assert.equal(calls[1].request.op,'create');await assert.rejects(client('delete'));assert.throws(()=>requireShopxoConnection({...connection,url:'https://other.example.com',appsecret:''},connection));
 const bad=createShopxoClient(connection,async()=>({ok:false,status:468,text:async()=>'<html>blocked</html>'}));await assert.rejects(bad('create'),/HTTP 468/);
});
test('ShopXO分类与仓库列表拒绝无效父级与循环',()=>{
 const caps={contract:'mainapis-shopxo-1',shopVersion:'6.9.2',features:['marker_receipt','warehouse_inventory','full_detail'],categories:[{id:1,parent_id:0,name:'父'},{id:2,parent_id:1,name:'子'}],brands:[{id:3,name:'品牌'}],warehouses:[{id:7,name:'仓库'}]};assert.deepEqual(shopxoCatalog(caps).categories[1].ids,[1,2]);assert.throws(()=>shopxoCatalog({...caps,categories:[{id:1,parent_id:2,name:'a'},{id:2,parent_id:1,name:'b'}]}));assert.throws(()=>shopxoCatalog({...caps,warehouses:[{id:7,name:'a'},{id:7,name:'b'}]}));
});
