import test from 'node:test';
import assert from 'node:assert/strict';
import {recoverPublicationReceipt} from '../public/product-flow.js';
const destinations=[{connection_id:'a',target:'tigshop'},{connection_id:'b',target:'crmeb-pro'}];
const a={connection_id:'a',target:'tigshop',id:'ja',ok:true},b={connection_id:'b',target:'crmeb-pro',id:'jb',ok:true};
test('断线后只查询同次请求，等待全部商城回执后恢复',async()=>{
 let calls=0;const result=await recoverPublicationReceipt({productId:'p',requestId:'request-123456789',destinations,wait:async()=>{},api:async(path,method)=>{assert.match(path,/request_id=request-123456789/);assert.equal(method,'GET');calls++;if(calls===1)throw Error('502');return {results:calls===2?[a]:[a,b]};}});
 assert.equal(calls,3);assert.deepEqual(result.results,[a,b]);
});
test('部分落库、重复商城、错误渠道或未知响应不能假报完整成功，也不重发POST',async()=>{
 for(const rows of [[],[a],[a,a],[a,{...b,target:'tigshop'}],[a,{...b,ok:false}]]){
 let calls=0;assert.equal(await recoverPublicationReceipt({productId:'p',requestId:'request-123456789',destinations,attempts:2,wait:async()=>{},api:async(_path,method)=>{assert.equal(method,'GET');calls++;return {results:rows};}}),null);assert.equal(calls,2);
 }
});
