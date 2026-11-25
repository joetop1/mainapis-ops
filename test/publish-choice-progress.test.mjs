import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {publicationChoiceProgress,publicationActivity} from '../public/product-flow.js';
const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
test('商城卡片按真实阶段流动，创建任务不能显示成功，旧任务不冒充本次成功',()=>{
 const result={id:'new',ok:true};
 assert.equal(publicationChoiceProgress(undefined,result).state,'running');
 assert.equal(publicationChoiceProgress({job_id:'old',status:'succeeded'},result).state,'running');
 assert.equal(publicationChoiceProgress({job_id:'new',status:'accepted'},result).state,'running');
 assert.equal(publicationChoiceProgress({job_id:'new',status:'verifying'},result).state,'running');
 assert.equal(publicationChoiceProgress({job_id:'new',status:'succeeded'},result).text,'发布成功');
 assert.equal(publicationChoiceProgress({job_id:'new',status:'failed',message:'无库存'},result).state,'failed');
 assert.equal(publicationChoiceProgress({job_id:'new',status:'awaiting_review'},result).state,'review');
 assert.equal(publicationChoiceProgress({status:'unknown',previous:'old'},result).state,'review');
 assert.equal(publicationChoiceProgress(undefined,{ok:false,error:'未提交'}).state,'failed');
});
test('弹窗内轮询更新原商城卡片，确认成功后停止动画并只提示一次',()=>{
 const status={textContent:''},choice={dataset:{publishChoice:'a'},setAttribute(k,v){this[k]=v;},querySelector:()=>status};
 const nodes={publishDialog:{open:true},publishTargets:{querySelectorAll:()=>[choice]}};
 const result={id:'new',ok:true},product={id:'p',publications:[{mall_connection_id:'a',job_id:'new',status:'accepted'}]},messages=[];
 const context=vm.createContext({publishing:product,state:{products:[product]},publishResults:new Map([['a',result]]),publicationProgress:publicationActivity(),publicationChoiceProgress,mallFor:()=>({name:'小蓝优品'}),$:s=>nodes[s.slice(1)],toast:m=>messages.push(m)});
 vm.runInContext(source.slice(source.indexOf('function syncPublishChoices('),source.indexOf("$('#publishTargets').onchange=")),context);
 context.syncPublishChoices();assert.equal(choice.dataset.progress,'running');assert.equal(choice['aria-busy'],'true');
 product.publications[0].status='succeeded';context.syncPublishChoices();context.syncPublishChoices();
 assert.equal(choice.dataset.progress,'succeeded');assert.equal(status.textContent,'发布成功');assert.equal(choice['aria-busy'],'false');assert.deepEqual(messages,['小蓝优品 · 发布成功']);
 context.publishResults.clear();context.syncPublishChoices();assert.equal(choice.dataset.progress,'succeeded');
});
