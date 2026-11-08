import test from 'node:test';
import assert from 'node:assert/strict';
import {batchPrices,batchCosts} from '../public/pricing.js';
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

test('成本倍数配合向上x.9，不影响默认计算，全部模式支持且不降价',()=>{
 assert.deepEqual(batchPrices([13.2],'multiply','1.3'),['17.16']);
 assert.deepEqual(batchPrices([13.2],'multiply','1.3','nine'),['17.90']);
 assert.deepEqual(batchPrices([13.2],'percent','30','nine'),['17.90']);
 assert.deepEqual(batchPrices([17,17.9,17.95,18,0.01],'multiply',1,'nine'),['17.90','17.90','18.90','18.90','0.90']);
 assert.deepEqual(batchPrices([0.1],'add',0.8,'nine'),['0.90']);
 assert.deepEqual(batchPrices([0],'fixed',17.95,'nine'),['18.90']);
 assert.deepEqual(batchPrices([17.90001],'multiply',1,'nine'),['18.90']);
 assert.throws(()=>batchPrices([10],'multiply',0,'nine'));assert.throws(()=>batchPrices([10],'multiply',1,'other'));assert.throws(()=>batchPrices([99999999],'multiply',1,'nine'));
 for(let cents=1;cents<3000;cents++){const amount=cents/100,price=Number(batchPrices([amount],'multiply',1,'nine')[0]);assert.ok(price>=amount-1e-9);assert.equal(Math.round(price*100)%100,90);}
});

test('批量成本按分计算采购价和运费，默认只补缺失或零成本',()=>{
 assert.deepEqual(batchCosts(['',0,15.68],'13.20','0.35'),{values:['13.55','13.55','15.68'],unitCost:'13.55',changed:2});
 assert.deepEqual(batchCosts([1,2],'0.10','0.20','all'),{values:['0.30','0.30'],unitCost:'0.30',changed:2});
 assert.equal(batchCosts([5],'2','','missing').changed,0);
 assert.deepEqual(batchCosts([''],'0','0','all').values,['0.00']);
});
test('批量成本拒绝非法金额、超额和错误范围，不改原始数据',()=>{
 const costs=['',12];for(const value of ['',-1,'1.001',Infinity,'1e4'])assert.throws(()=>batchCosts(costs,value));
 assert.throws(()=>batchCosts(costs,99999999,0.01));assert.throws(()=>batchCosts(costs,10,0,'bad'));assert.throws(()=>batchCosts([],10));assert.throws(()=>batchCosts([-1],10));assert.deepEqual(costs,['',12]);
});
