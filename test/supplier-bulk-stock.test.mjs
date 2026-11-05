import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
test('货盘批量库存支持选中或全部、填空或覆盖，已锁定批次与无效库存不修改',()=>{
 const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
 const a={value:'',disabled:false},b={value:'7',disabled:false},c={value:'',disabled:false};
 const card=(checked,inputs)=>({querySelector:()=>({checked}),querySelectorAll:()=>inputs});
 const nodes={supplierBulkStock:{value:'20'},supplierStockScope:{value:'selected'},supplierStockMode:{value:'fill'},supplierPreview:{querySelectorAll:()=>[card(true,[a,b]),card(false,[c])]}};
 const ctx=vm.createContext({$:id=>nodes[id.slice(1)],supplierBatch:{},supplierFeedback:()=>{}});
 vm.runInContext(source.slice(source.indexOf('function applySupplierStock(){'),source.indexOf("$('#applySupplierStock').onclick=")),ctx);
 ctx.applySupplierStock();assert.equal(a.value,'20');assert.equal(b.value,'7');assert.equal(c.value,'');
 nodes.supplierStockScope.value='all';nodes.supplierStockMode.value='overwrite';ctx.applySupplierStock();assert.equal(b.value,'20');assert.equal(c.value,'20');
 for(const value of ['','-1','1.5','2147483648']){nodes.supplierBulkStock.value=value;ctx.applySupplierStock();assert.equal(a.value,'20');}
 nodes.supplierBulkStock.value='0';ctx.supplierBatch.plan=[];ctx.applySupplierStock();assert.equal(a.value,'20');
 ctx.supplierBatch={};ctx.applySupplierStock();assert.equal(a.value,'0');assert.equal(b.value,'0');
});
