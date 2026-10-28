import test from 'node:test';
import assert from 'node:assert/strict';
import {pageInfo,publicationMalls} from '../public/list-view.js';
test('未配置且无任务的商城不出现在发布徽章，已有任务的停用配置仍保留历史',()=>{
 const malls=[{id:'a',type:'yunzhong',configured:true},{id:'draft',type:'yunzhong',configured:false},{id:'history',type:'yunzhong',configured:false},{id:'legacy',type:'crmeb-store',legacy:1,configured:false}];
 assert.deepEqual(publicationMalls({publications:[]},malls).map(m=>m.id),['a']);
 assert.deepEqual(publicationMalls({publications:[{mall_connection_id:'history',status:'succeeded'},{target:'crmeb-store'}]},malls).map(m=>m.id),['a','history','legacy']);
});
test('列表分页限制每页数量，空列表及末页越界有确定结果',()=>{
 const page=pageInfo(45,3,20);assert.equal(page.start,41);assert.equal(page.end,45);assert.equal(page.offset,40);assert.equal(pageInfo(45,99,20).page,3);assert.equal(pageInfo(0,2,20).start,0);assert.equal(pageInfo(0,2,20).pages,1);assert.equal(pageInfo(45,1,999).pageSize,20);
});
