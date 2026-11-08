import test from 'node:test';
import assert from 'node:assert/strict';
import {assetPresentation} from '../public/assets.js';
const now=Date.parse('2026-11-08T00:00:00Z');
const base={account:{available:0,frozen:0,exempt:false},enabled:false,storage:{active:false,exempt:false,storedBytes:0,reservedBytes:0,limitBytes:0,expires:null}};
test('资产小窗0点为有效余额，无套餐不编造天数和容量比例',()=>{const view=assetPresentation(base,now);assert.equal(view.available,'0');assert.equal(view.frozen,'0');assert.equal(view.plan,'无有效套餐');assert.equal(view.percent,null);assert.equal(view.mode,'未启用扣点');assert.equal(view.usage,'已登记 0.00 GB');});
test('剩余天数按到期时刻向上取整，预留容量计入占比，过期不显示有效',()=>{const data={...base,testMode:true,storage:{active:true,exempt:false,storedBytes:1024**3,reservedBytes:1024**3,limitBytes:4*1024**3,expires:'2026-11-09T01:00:00Z'}};const view=assetPresentation(data,now);assert.equal(view.plan,'剩余 2 天');assert.equal(view.percent,50);assert.equal(view.mode,'收费测试中');assert.match(view.pending,/1.00 GB/);assert.equal(assetPresentation(data,Date.parse(data.storage.expires)).plan,'套餐已到期');});
test('内部空间明确显示免额度，有已兑套餐时仍展示剩余天数',()=>{const data={...base,account:{...base.account,exempt:true},storage:{...base.storage,exempt:true}};assert.equal(assetPresentation(data,now).plan,'免额度限制');assert.equal(assetPresentation(data,now).mode,'内部免计费');data.storage={...data.storage,active:true,expires:'2026-11-08T01:00:00Z'};const view=assetPresentation(data,now);assert.equal(view.plan,'剩余 1 天');assert.match(view.planHint,/内部免额度/);});
