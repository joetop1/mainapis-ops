import test from 'node:test';
import assert from 'node:assert/strict';
import {setupSameStyle} from '../public/same-style.js';
test('同款整理窗口明确对应货盘SKU，预览后生成；失败重试保持同一请求',async()=>{
 const stock={id:'s',revision:2,supplier_import:{},title:'货盘<商品>',images:[],skus:[{sku:'BAR',spec:'50ml',cost:2,price:3,stock:4}]};
 const ref={id:'r',revision:3,title:'参考商品',images:['https://example.com/a.png'],detail_images:['https://example.com/d.png'],skus:[{sku:'REF',spec:'50ml'}]};
 const fields={value:{value:'50ml'},match:{value:'REF'}},row={dataset:{styleProduct:'s',styleSku:'BAR'},querySelector:s=>s==='[data-style-value]'?fields.value:fields.match};
 const nodes=new Map();for(const id of ['sameStyleReferenceTitle','copySameStyleTitle','useSameStyleTitle','sameStyleStatus','confirmSameStyle','sameStyleRows','sameStyleForm','sameStyleProducts','sameStyleReference','sameStyleMain','sameStyleTitle','sameStyleDimension','sameStyleImages','sameStylePreview','sameStyleDialog','closeSameStyle','previewSameStyle','sameStyleMedia'])nodes.set(id,{value:'',disabled:false,textContent:'',innerHTML:'',querySelectorAll:()=>[],addEventListener(){},replaceChildren(){},showModal(){this.open=true;},close(){this.open=false;}});
 nodes.get('sameStyleRows').querySelectorAll=()=>[row];nodes.get('sameStyleForm').querySelectorAll=()=>[nodes.get('sameStyleTitle'),nodes.get('sameStyleReference'),nodes.get('confirmSameStyle')];
 let copied='',selectedText=false;nodes.get('sameStyleReferenceTitle').focus=()=>{};nodes.get('sameStyleReferenceTitle').select=()=>{selectedText=true;};
 const clipboard={writeText:async value=>{copied=value;}};
 const products=[stock,ref],selected=new Set(['s','r']),calls=[];let edits=0,attempt=0;
 setupSameStyle({clipboard,$:s=>nodes.get(s.slice(1)),esc:v=>String(v).replaceAll('<','&lt;').replaceAll('>','&gt;'),context:()=>({products,selected}),toast(){},edit(){edits++;},load:async()=>{products.push({id:'new'});},api:async(path,method,body)=>{calls.push({path,body});if(path.endsWith('merge-preview'))return {product:{title:'新商品',skus:[{}],images:[],detail_images:[]},warnings:[]};if(!attempt++)throw Error('网络断开');return {id:'new'};}});
 // Emulate browser select value after options are inserted.
 nodes.get('sameStyleReference').value='r';nodes.get('sameStyleProducts').onclick();nodes.get('sameStyleMain').value='s';
 assert.equal(nodes.get('sameStyleDialog').open,true);assert.match(nodes.get('sameStyleRows').innerHTML,/货盘&lt;商品&gt;/);assert.match(nodes.get('sameStyleRows').innerHTML,/selected/);
 assert.equal(nodes.get('sameStyleReferenceTitle').value,ref.title);await nodes.get('copySameStyleTitle').onclick();assert.equal(copied,ref.title);clipboard.writeText=async()=>{throw Error('denied');};await nodes.get('copySameStyleTitle').onclick();assert.equal(selectedText,true);nodes.get('useSameStyleTitle').onclick();assert.equal(nodes.get('sameStyleTitle').value,ref.title);
 await nodes.get('previewSameStyle').onclick();assert.equal(nodes.get('confirmSameStyle').disabled,false);assert.equal(calls[0].body.reference_id,'r');assert.deepEqual(calls[0].body.rows,[{product_id:'s',original_sku:'BAR',value:'50ml',reference_sku:'REF'}]);
 await nodes.get('sameStyleForm').onsubmit({preventDefault(){}});assert.equal(nodes.get('sameStyleTitle').disabled,true);assert.equal(nodes.get('confirmSameStyle').disabled,false);
 await nodes.get('sameStyleForm').onsubmit({preventDefault(){}});assert.equal(calls[1].body.request_id,calls[2].body.request_id);assert.equal(edits,1);assert.equal(selected.size,0);assert.equal(nodes.get('sameStyleDialog').open,false);
});
