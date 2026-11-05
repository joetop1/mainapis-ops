import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
test('货盘提交对未勾选、缺库存、服务端错误即时显示反馈，成功明确显示处理状态',async()=>{
 let selected=false,stock='',focused=false,calls=0,fail=false;
 const input=value=>({value,focus(){focused=true;},scrollIntoView(){}}),fields={spec:input('默认'),cost:input('2'),price:input('5'),stock:input(stock)};
 const card={dataset:{supplierIndex:'0'},querySelector:s=>s==='[data-confirm]'?{checked:selected}:input('商品'),querySelectorAll:()=>[{querySelector:s=>fields[s.match(/data-(\w+)/)[1]]}]};
 const nodes={supplierPreview:{querySelectorAll:()=>[card]},supplierStatus:{textContent:'',classList:{toggle(){}}},commitSupplier:{disabled:false,textContent:''}};
 const context=vm.createContext({$:s=>nodes[s.slice(1)],api:async()=>{calls++;if(fail)throw Error('OSS未启用');return {state:'processing'};},supplierRender:b=>{context.supplierBatch=b;}});
 vm.runInContext("var supplierBatch={id:'batch',products:[{key:'card'}]};",context);
 vm.runInContext(source.slice(source.indexOf('function supplierFeedback('),source.indexOf("$('#discardSupplier').onclick=")),context);
 await nodes.commitSupplier.onclick();assert.match(nodes.supplierStatus.textContent,/勾选/);assert.equal(calls,0);assert.equal(nodes.commitSupplier.disabled,false);
 selected=true;await nodes.commitSupplier.onclick();assert.match(nodes.supplierStatus.textContent,/库存.*未填写/);assert.equal(focused,true);assert.equal(calls,0);
 fields.stock.value='3';fail=true;await nodes.commitSupplier.onclick();assert.match(nodes.supplierStatus.textContent,/OSS未启用/);assert.equal(nodes.commitSupplier.disabled,false);
 fail=false;await nodes.commitSupplier.onclick();assert.equal(nodes.commitSupplier.textContent,'正在上传图片并导入…');assert.equal(nodes.commitSupplier.disabled,true);
});
