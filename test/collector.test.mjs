import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {collect1688} from '../extensions/1688-collector/collector.js';
import {validateProduct,assertPublishable} from '../core.mjs';
const location={protocol:'https:',hostname:'detail.1688.com',pathname:'/offer/123456.html',href:'https://detail.1688.com/offer/123456.html?tracking=1'};
function capture(root={},doc={},loc=location,diagnostic=false){return vm.runInNewContext('('+collect1688.toString()+')('+diagnostic+')',{
 location:loc,URL,window:{__INIT_DATA:root},document:{title:'测试商品 - 1688',querySelector:()=>null,querySelectorAll:()=>[],...doc}
});}
test('1688采集：仅返回商品字段，规范来源，保留规格并阻止未经定价审核',()=>{
 const data={offer:{subject:' 测试商品 ',imageList:['//cbu01.alicdn.com/img/a.jpg','https://cbu01.alicdn.com/img/a.jpg','https://evil.com/a.jpg'],skuInfo:{skuProps:[{pid:1,prop:'颜色',value:[{vid:2,name:'黑色'}]},{pid:3,prop:'尺码',value:[{vid:4,name:'M'}]}],skuMap:{'1:2;3:4':{skuId:'777',price:'12.50',canBookCount:123}}},token:'never-export',recommend:{subject:'错误商品',imageList:['https://cbu01.alicdn.com/wrong.jpg']}}};
 const result=JSON.parse(JSON.stringify(capture(data)));
 assert.equal(result.product.source_url,'https://detail.1688.com/offer/123456.html');assert.equal(result.product.title,'测试商品');assert.equal(result.product.images.length,1);
 assert.deepEqual(result.product.skus,[{sku:'ALI-777',spec:'颜色：黑色 / 尺码：M',cost:12.5,price:0,stock:0}]);
 assert.equal(JSON.stringify(result).includes('never-export'),false);assert.throws(()=>assertPublishable(validateProduct(result.product)));
});
test('1688采集：缺少页面状态时保守降级，不伪造价格或规格',()=>{
 const result=JSON.parse(JSON.stringify(capture({}, {querySelector:s=>s==='.title-text'?{textContent:'从页面读取标题'}:null})));
 assert.equal(result.product.title,'从页面读取标题');assert.equal(result.product.skus.length,0);assert.ok(result.warnings.some(x=>x.includes('未识别到完整 SKU')));
 const wrong=capture({}, {},{...location,hostname:'evil.com'});assert.ok(wrong.error);
 const large={skuMap:Object.fromEntries(Array.from({length:101},(_,i)=>['规格'+i,{skuId:i+1,price:2}]))};assert.equal(capture(large).product.skus.length,0);
});
test('商品标题优先于店铺标题，忽略平台说明，解析严格JSON赋值中的skuInfoMap',()=>{
 const hydration={offerId:'123456',subject:'真实商品',skuModel:{skuInfoMap:{'黑色>M':{skuId:'88',price:'3.98'}}}};
 const detail={textContent:'商品详情 【平台活动下价格】非分销场景的活动说明',querySelectorAll:()=>[]};
 const doc={querySelector:s=>s==='h1'?{textContent:'某某纺织品厂'}:s.includes('#desc-lazyload-container')?detail:null,querySelectorAll:s=>s==='script:not([src])'?[{textContent:'window.context = '+JSON.stringify(hydration)+';'}]:[]};
 const result=capture({},doc);assert.equal(result.product.title,'真实商品');assert.equal(result.product.description,'');assert.equal(result.product.skus.length,1);assert.equal(result.product.skus[0].cost,3.98);
});
test('诊断只导出结构，不包含商品字段值或敏感字段',()=>{
 const root={offer:{offerId:'123456',subject:'DO-NOT-EXPORT-TITLE',token:'DO-NOT-EXPORT-SECRET',skuModel:{skuInfoMap:{'颜色':{price:'987.65'}}}}};
 const d=capture(root,{},location,true);const out=JSON.stringify(d);assert.ok(d.diagnostics);assert.equal(d.product,undefined);assert.equal(out.includes('DO-NOT-EXPORT'),false);assert.equal(out.includes('987.65'),false);assert.equal(out.includes('token'),false);assert.equal(d.diagnostics.matchedSkuMap,true);
});
test('SKU数组读取明确名称；数组下标及无法还原的数字ID不可作规格名',()=>{
 const row={skuId:'123',price:'4.73'};
 assert.equal(capture({skuInfoMap:[row]}).product.skus.length,0);
 assert.equal(capture({skuInfoMap:{'0':row}}).product.skus.length,0);
 const parsed=capture({skuInfoMap:[{...row,specAttrs:'条纹黑色>均码'}]});assert.equal(parsed.product.skus[0].spec,'条纹黑色 / 均码');
 const partial=capture({skuInfoMap:[{...row,specAttrs:'黑色'},{...row,skuId:'124'}]});assert.equal(partial.product.skus.length,0);assert.ok(partial.warnings.some(x=>x.includes('不导入整组')));
});
test('真实诊断布局：优先完整skuModel，避免先发现的交易SKU数组抢占',()=>{
 const tradeMap=Array.from({length:64},(_,i)=>({skuId:String(1000+i),price:'4.73'}));
 const named=Object.fromEntries(Array.from({length:64},(_,i)=>['条纹款'+i+'&gt;均码',{skuId:String(1000+i),price:'3.98'}]));
 const root={result:{global:{globalData:{model:{offerDetail:{offerId:'123456',subject:'真实商品',skuProps:[]},tradeModel:{skuMap:tradeMap}}}},data:{Root:{fields:{dataJson:{offerBaseInfo:{offerId:'123456'},skuModel:{skuInfoMap:named,skuProps:[]}}}}}}};
 const result=capture(root);assert.equal(result.product.skus.length,64);assert.equal(result.product.skus[0].spec,'条纹款0 / 均码');assert.equal(result.product.skus[63].spec,'条纹款63 / 均码');assert.equal(result.product.skus[0].cost,3.98);
 const d=capture(root,{},location,true).diagnostics;assert.match(d.selectedSkuPath,/Root.fields.dataJson.skuModel$/);assert.equal(d.skuSchemas[0].rowCount,64);assert.ok(d.skuSchemas[0].rowKeys[0].includes('skuId'));assert.equal(JSON.stringify(d).includes('3.98'),false);
});
test('SKU配图按属性名或ID精确匹配，不按主图顺序猜测',()=>{
 const a='https://cbu01.alicdn.com/red.jpg',b='https://cbu01.alicdn.com/blue.jpg';
 const result=capture({skuModel:{skuProps:[{prop:'颜色',value:[{name:'红色',vid:1,imageUrl:a},{name:'蓝色',vid:2,imageUrl:b}]}],skuInfoMap:{'红色>M':{skuId:'1',price:5},'蓝色>M':{skuId:'2',price:6},'未知>M':{skuId:'3',price:7}}}});
 assert.equal(result.product.skus[0].image,a);assert.equal(result.product.skus[1].image,b);assert.equal(result.product.skus[2].image,undefined);assert.ok(result.warnings.some(x=>x.includes('1 个规格未匹配')));
 const ids=capture({skuProps:[{pid:7,prop:'颜色',value:[{vid:1,name:'红色',imageUrl:a}]}],skuInfoMap:{'7:1':{skuId:'4',price:5}}});assert.equal(ids.product.skus[0].image,a);
 const ambiguous=capture({skuProps:[{prop:'颜色',value:[{name:'红色',imageUrl:a},{name:'红色',imageUrl:b}]}],skuInfoMap:{'红色>M':{skuId:'5',price:5}}});assert.equal(ambiguous.product.skus[0].image,undefined);
});
test('插件权限限于手动选中页面和OPS；脚本可独立注入',()=>{
 const manifest=JSON.parse(readFileSync(new URL('../extensions/1688-collector/manifest.json',import.meta.url)));
 assert.deepEqual(manifest.host_permissions,['https://ops.mainapis.com/*']);assert.equal(manifest.content_scripts,undefined);assert.equal(manifest.permissions.includes('cookies'),false);
 const source=readFileSync(new URL('../extensions/1688-collector/popup.js',import.meta.url),'utf8');
 const fn=source.slice(source.indexOf('export async function importIntoOps'),source.indexOf("\n$('#send')")).replace('export ','');
 const run=context=>vm.runInNewContext('('+fn+')({source_url:"https://detail.1688.com/offer/123.html"})',context);
 return (async()=>{
  let writes=0;const response=await run({location:{origin:'https://ops.mainapis.com'},AbortSignal,fetch:async()=>({ok:true,json:async()=>({user:null})})});assert.match(response.error,/登录/);
  const out=await run({location:{origin:'https://ops.mainapis.com'},AbortSignal,fetch:async(url,options)=>{if(url==='/api/me')return {ok:true,json:async()=>({user:{sub:'allowed'},csrf:'csrf'})};writes++;assert.equal(options.headers['X-CSRF-Token'],'csrf');assert.equal(options.credentials,'same-origin');assert.equal(url,'/api/products');return {ok:true,json:async()=>({id:'draft-id'})};}});
  assert.equal(writes,1);assert.equal(out.id,'draft-id');
  const wrong=await run({location:{origin:'https://evil.com'}});assert.ok(wrong.error);
 })();
});
test('详情图区分主图与SKU配图，明确报告未加载的详情',()=>{
 const dom={querySelector:s=>s.startsWith('#desc-lazyload-container')?{innerText:'产品材质',querySelectorAll:selector=>selector==='img'?[{getAttribute:k=>k==='data-src'?'https://cbu01.alicdn.com/img/actual-detail.jpg':null,src:''}]:[]}:null};
 const r=JSON.parse(JSON.stringify(capture({offer:{offerId:123456,imageList:['https://cbu01.alicdn.com/img/main.jpg']}},dom)));
 assert.deepEqual(r.product.detail_images,['https://cbu01.alicdn.com/img/actual-detail.jpg']);assert.equal(r.product.images.includes(r.product.detail_images[0]),false);
 assert.ok(capture().warnings.some(x=>x.includes('未采集到真实商品详情图')));
 const saved=validateProduct({...r.product,source_url:'https://detail.1688.com/offer/123456.html'});assert.deepEqual(saved.detail_images,r.product.detail_images);
});
test('现代1688详情组件：穿透开放Shadow DOM，保留详情顺序并隔离SKU图片',()=>{
 const img=url=>({src:url,getAttribute:()=>null});
 const shadow={querySelectorAll:s=>s==='img'?[img('https://cbu01.alicdn.com/img/detail-1.jpg'),img('https://cbu01.alicdn.com/img/detail-2.jpg')]:[]};
 const host={tagName:'V-DETAIL-Y',shadowRoot:shadow};
 const container={innerText:'',querySelectorAll:s=>s==='*'?[host]:[]};
 const doc={querySelector:s=>s.startsWith('#desc-lazyload-container')?container:null};
 const r=JSON.parse(JSON.stringify(capture({offer:{offerId:123456,imageList:['https://cbu01.alicdn.com/img/main.jpg']}},doc)));
 assert.deepEqual(r.product.detail_images,['https://cbu01.alicdn.com/img/detail-1.jpg','https://cbu01.alicdn.com/img/detail-2.jpg']);
 assert.deepEqual(r.product.images,['https://cbu01.alicdn.com/img/main.jpg']);
 assert.equal(r.warnings.some(x=>x.includes('未采集到真实商品详情图')),false);
});
