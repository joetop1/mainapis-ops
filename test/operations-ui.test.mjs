import test from 'node:test';
import assert from 'node:assert/strict';
import {operationsPresentation,setupOperations} from '../public/operations.js';
function snapshot(){return {health:{ok:true,freeBytes:40*1024**3,totalBytes:100*1024**3},uptime:3700,worker:{enabled:true,online:true,queued:2,running:1,interrupted:0},tasks:{stalled:0,review:0},backup:{enabled:true,running:false,intervalHours:24,keep:14,lastSuccess:'2026-11-08T00:00:00Z',lastError:'',remote:{enabled:false}},alerts:{enabled:false}};}
test('运行图形展示实际容量，暂停及未启用保持中性，低磁盘和离线有明确状态',()=>{
 const s=snapshot();s.backup.lastError='test';assert.equal(operationsPresentation(s).summaryState,'warn');s.backup.lastError='';assert.equal(operationsPresentation(s).diskPercent,40);assert.equal(operationsPresentation(s).summaryState,'good');assert.equal(operationsPresentation(s).remoteState,'muted');assert.equal(operationsPresentation(s).alertState,'muted');
 s.worker.online=false;s.worker.paused=true;assert.equal(operationsPresentation(s).workerState,'muted');assert.equal(operationsPresentation(s).summaryState,'good');s.worker.paused=false;assert.equal(operationsPresentation(s).summaryState,'warn');
 s.health.freeBytes=1024**3;assert.equal(operationsPresentation(s).diskState,'warn');assert.equal(operationsPresentation(s).summaryState,'warn');s.health.freeBytes=100*1024**2;assert.equal(operationsPresentation(s).diskState,'error');delete s.health.totalBytes;assert.equal(operationsPresentation(s).diskPercent,null);
 s.health={ok:false,reason:'storage_unavailable'};assert.equal(operationsPresentation(s).summaryState,'error');assert.equal(operationsPresentation(s).diskPercent,null);
});
test('运行保障读取更新图形和文本，备份中保持按钮禁用，失败明确标注旧数据',async()=>{
 const nodes=new Map(),$=selector=>{if(!nodes.has(selector))nodes.set(selector,{textContent:'',dataset:{},hidden:false,disabled:false,value:0,setAttribute(k,v){this[k]=v;}});return nodes.get(selector);};let current=snapshot(),fail=false;
 const panel=setupOperations({$,isAdmin:()=>true,isVisible:()=>false,api:async()=>{if(fail)throw Error('network');return current;}});
 await panel.load();assert.equal($('#operationsDiskMeter').value,40);assert.equal($('#operationsQueued').textContent,2);assert.equal($('#operationsRemoteState').textContent,'未启用');assert.match($('#operationsBackup').textContent,/24小时/);assert.equal($('#operationsSummary').dataset.state,'good');
 current.backup.running=true;current.tasks.review=3;await panel.load();assert.equal($('#operationsBackupNow').disabled,true);assert.equal($('#operationsLocalState').textContent,'备份中');assert.equal($('#operationsTasks').textContent,'3 项待核对');
 fail=true;await panel.load();assert.equal($('#operationsSummary').textContent,'状态读取失败');assert.match($('#operationsStatus').textContent,/保留上次读取值/);assert.equal($('#operationsRefresh').disabled,false);panel.stop();
});
