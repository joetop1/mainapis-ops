import test from 'node:test';
import assert from 'node:assert/strict';
import {batchPrices} from '../public/pricing.js';
test('批量售价：统一金额、逐SKU加价和百分比按分舍入',()=>{
 assert.deepEqual(batchPrices(Array(64).fill(4.73),'fixed','9.9'),Array(64).fill('9.90'));
 assert.deepEqual(batchPrices([4.73,8.2],'add','5'),['9.73','13.20']);
 assert.deepEqual(batchPrices([4.73,8.2],'percent','50'),['7.10','12.30']);
 assert.deepEqual(batchPrices([1.005],'fixed','1.005'),['1.01']);
});
test('无效输入与任一SKU异常时拒绝整批，统一金额不依赖成本',()=>{
 for(const value of ['',' ',NaN,Infinity,-1,0,1e10])assert.throws(()=>batchPrices([4.73],'fixed',value));
 assert.throws(()=>batchPrices([],'fixed',10));assert.throws(()=>batchPrices([4.73],'other',10));
 for(const cost of ['',-1,NaN,Infinity])assert.throws(()=>batchPrices([4.73,cost],'add',5));
 assert.deepEqual(batchPrices([''],'fixed',10),['10.00']);
 assert.throws(()=>batchPrices([99999999],'percent',100));
});
