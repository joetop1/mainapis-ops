import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {suggestedMergeRows,mergeSelection} from '../public/merge-products.js';
const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
test('跨分页选中记录明确校验，重复源SKU编码给出不同建议，不改来源商品',()=>{
 const p=[{id:'a',skus:[{sku:'DEFAULT',spec:'默认'}]},{id:'b',skus:[{sku:'DEFAULT',spec:'大号'},{sku:'中文编码',spec:'小号'}]}],before=JSON.stringify(p),rows=suggestedMergeRows(p);assert.equal(rows.length,3);assert.equal(new Set(rows.map(r=>r.sku)).size,3);assert.equal(rows[1].original_sku,'DEFAULT');assert.equal(JSON.stringify(p),before);assert.equal(mergeSelection(p,new Set(['a','b'])).length,2);assert.throws(()=>mergeSelection(p,new Set(['a','missing'])));assert.throws(()=>mergeSelection([{id:'a',skus:[]},p[1]],new Set(['a','b'])));
});
test('编辑SKU行重新读取后仍保留原来源，与修改后的合并SKU编码区分',()=>{
 const original={url:'https://detail.1688.com/offer/1.html',sku:'OLD',product_id:'source-a',revision:2,spec:'小号'},values={sku:'RENAMED',cost:'3',price:'6',stock:'5',image:'https://example.com/sku.jpg',specValue0:'款式A'};
 const tr={dataset:{source:JSON.stringify(original)},querySelector:s=>({value:values[s.match(/data-key="([^"]+)"/)[1]]})};const context=vm.createContext({$:()=>({children:[tr]})});vm.runInContext('let editingSpecNames=["型号"];'+app.slice(app.indexOf('function readSkuRows()'),app.indexOf('function renderSkuHeader()')),context);const row=context.readSkuRows()[0];assert.equal(row.sku,'RENAMED');assert.equal(row.source.sku,'OLD');assert.equal(row.source.url,original.url);assert.equal(row.spec_values[0],'款式A');
});
test('未预览的合并不能创建，已预览后改设置会撤销确认状态',()=>{
 const nodes=new Map(['confirmMerge','mergePreview'].map(id=>[id,{disabled:false,replaceChildren(){this.cleared=true;}}])),context=vm.createContext({$:s=>nodes.get(s.slice(1))});vm.runInContext("let mergePending=null,mergePreviewKey='previewed';"+app.slice(app.indexOf('function invalidateMerge()'),app.indexOf('function lockMergeFields(')),context);context.invalidateMerge();assert.equal(nodes.get('confirmMerge').disabled,true);assert.equal(nodes.get('mergePreview').cleared,true);vm.runInContext("mergePending={request_id:'pending'};mergePreviewKey='known';",context);nodes.get('confirmMerge').disabled=false;context.invalidateMerge();assert.equal(nodes.get('confirmMerge').disabled,false);
});
