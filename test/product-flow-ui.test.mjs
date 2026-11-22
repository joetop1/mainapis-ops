import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {replaceProduct,openMergedProduct,publicationActivity} from '../public/product-flow.js';
const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};

test('合并后直接打开指定商品，不依赖列表筛选或等待缓慢列表刷新',async()=>{
 const refresh=deferred(),calls=[],product={id:'merged',revision:1,title:'合并商品'};
 await openMergedProduct('merged',{api:async path=>{calls.push(path);return product;},apply:p=>calls.push(['apply',p.id]),edit:p=>calls.push(['edit',p.id]),refresh:()=>refresh.promise,notify:message=>calls.push(message)});
 assert.deepEqual(calls,['/api/products/merged',['apply','merged'],['edit','merged']]);
 refresh.resolve();
 const messages=[];
 await openMergedProduct('merged',{api:async()=>{throw Error('读取失败');},apply:()=>assert.fail(),edit:()=>assert.fail(),refresh:async()=>{},notify:m=>messages.push(m)});
 assert.match(messages[0],/商品已生成.*读取编辑资料失败/);
});

test('商品保存回执保留发布元信息并立即更新版本，旧版本不能回退新状态',()=>{
 const old={id:'p',revision:1,status:'draft',publications:[{status:'failed'}],collected_by:'alice'};
 const products=replaceProduct([old],{id:'p',revision:2,status:'pending_review',title:'已保存'});
 assert.equal(products[0].status,'pending_review');assert.equal(products[0].collected_by,'alice');assert.deepEqual(products[0].publications,old.publications);
 assert.equal(replaceProduct(products,old),products);
});

test('发布请求等待期间保留提交中，结果不明不假报成功，旧发布记录不能消除核对提示',()=>{
 const activity=publicationActivity(),previous={mall_connection_id:'m',revision:1,status:'failed'};
 activity.start('p',['m'],[previous]);
 activity.reconcile([{id:'p',publications:[previous]}]);
 assert.equal(activity.record('p','m').status,'submitting');
 activity.uncertain('p');activity.reconcile([{id:'p',publications:[previous]}]);
 assert.equal(activity.record('p','m').status,'unknown');
 const received={...previous,revision:2,status:'accepted'};
 activity.reconcile([{id:'p',publications:[received]}]);
 assert.equal(activity.record('p','m',received),received);
});

test('提交中的所选商城徽章立即带动画，未选商城保持原样',()=>{
 const activity=publicationActivity();activity.start('p',['a']);
 const context=vm.createContext({publicationProgress:activity,publicationMalls:(_p,malls)=>malls,mallRows:()=>[{id:'a',name:'商城甲'},{id:'b',name:'商城乙'}],labels:{submitting:'提交中'},esc:String});
 vm.runInContext(app.slice(app.indexOf('function publicationRows('),app.indexOf('function showPublicationDetails(')),context);
 const html=context.publicationBadges({id:'p',publications:[]});
 assert.match(html,/publication-circle submitting activity-indicator/);
 assert.match(html,/商城甲 · 提交中/);
 assert.match(html,/publication-circle none"[^>]*商城乙 · 未发布/);
});

test('保存成功立即采用服务器版本，后台刷新未结束也能按新版本审核',async()=>{
 const request=deferred(),refresh=deferred(),button={textContent:'保存商品',setAttribute(){},removeAttribute(){}},editor={open:true,close(){this.open=false;}},close={disabled:false};
 const fields=Object.fromEntries(['source_url','title','description','tag_ids','catalog_target','applicable_type','category_id','brand_id','virtual_sales','detail_images','images'].map(k=>[k,{value:''}]));
 Object.assign(fields.source_url,{value:'https://detail.1688.com/offer/123.html'});fields.title.value='已编辑';fields.catalog_target.value='crmeb-pro';fields.category_id.value='1';fields.virtual_sales.value='0';
 const form={elements:fields,querySelector:()=>button},nodes={productForm:form,editor,closeEditor:close,catalogMall:{value:'m'},specNames:{value:''}};
 const messages=[],updates=[],context=vm.createContext({$:s=>nodes[s.slice(1)],updateEditorReadiness:()=>({save:[]}),showEditorIssue:()=>assert.fail(),readProductAttributes:()=>[],rememberMapping(){},readSkuRows:()=>[{sku:'A',price:10,cost:2,stock:3}],specificationMatrix(){},confirmBilling:()=>assert.fail(),render(){},api:()=>request.promise,applyProduct:p=>updates.push(p),load:()=>refresh.promise,toast:m=>messages.push(m)});
 vm.runInContext("var editing={id:'p',revision:1},editorSaving=false,editorImageBusy=0,savingProducts=new Set(),editingMappings=new Map(),activeMappingId='m',editingSpecNames=[],catalog={categories:[{id:1,label:'商城分类'}],brands:[]},catalogRequest=0;",context);
 vm.runInContext(app.slice(app.indexOf("$('#productForm').onsubmit="),app.indexOf("$('#importButton').onclick=")),context);
 const saving=form.onsubmit({preventDefault(){},submitter:button,target:form});
 assert.equal(editor.open,true);assert.match(button.textContent,/正在保存/);assert.equal(close.disabled,true);
 // Enter/click during the pending write must not submit a second save.
 await form.onsubmit({preventDefault(){},submitter:button,target:form});
 request.resolve({ok:true,product:{id:'p',revision:2,status:'pending_review',category:'商城分类'}});
 await saving;
 assert.equal(editor.open,false);assert.equal(updates[0].revision,2);assert.equal(updates[0].status,'pending_review');
 assert.equal(vm.runInContext('editing.revision',context),2);assert.equal(close.disabled,false);assert.equal(button.textContent,'保存商品');
 refresh.resolve();
});

test('发布提交立即闪动，回执后成功商城保持执行态，失败商城可单独重试且不等待列表',async()=>{
 const request=deferred(),refresh=deferred(),activity=publicationActivity();
 const a={value:'a',checked:true,disabled:false,dataset:{}},b={value:'b',checked:true,disabled:false,dataset:{}},inputs=[a,b];
 const choices={querySelectorAll:selector=>selector.includes('data-import-images')?[]:selector.includes(':checked')?inputs.filter(i=>i.checked&&!i.disabled):inputs};
 const button={disabled:false,textContent:'提交',setAttribute(){},removeAttribute(){}},nodes={publishTargets:choices,publishSubmit:button,publishDialog:{},closePublish:{},publishResults:{}};
 const product={id:'p',revision:2,publications:[]};let requests=0,renders=0;
 const context=vm.createContext({$:selector=>nodes[selector.slice(1)]??(nodes[selector.slice(1)]={}),clearDialogFeedback(){},mallFor:id=>({type:'crmeb-pro',name:id}),confirmBilling:async()=>1,publicationProgress:activity,render:()=>renders++,load:()=>refresh.promise,toast(){},esc:String,api:()=>{requests++;return request.promise;}});
 context.state={products:[product]};context.publishing=product;
 vm.runInContext('var publishBusy=false,publishUncertain=false,publishResults=new Map(),stateRequest=0;',context);
 vm.runInContext(app.slice(app.indexOf("$('#publishForm').onsubmit="),app.indexOf("$('#refresh').onclick=")),context);
 const submit=nodes.publishForm.onsubmit({preventDefault(){},submitter:button});
 assert.equal(activity.record('p','a').status,'submitting');assert.ok(renders>0);assert.equal(button.disabled,true);
 await Promise.resolve();await nodes.publishForm.onsubmit({preventDefault(){},submitter:button});assert.equal(requests,1);
 request.resolve({results:[{ok:true,id:'job-a',connection_id:'a',target:'crmeb-pro'},{ok:false,connection_id:'b',target:'crmeb-pro',error:'缺少配置'}]});
 await submit;
 assert.equal(activity.has('p'),false);assert.equal(product.publications[0].status,'dispatching');assert.equal(product.publications[0].mall_connection_id,'a');
 assert.equal(a.disabled,true);assert.equal(b.disabled,false);assert.equal(button.disabled,false);assert.match(button.textContent,/重试未提交/);
 refresh.resolve();
});

test('商品列表先渲染，不被任务列表阻塞，变更之前发起的旧刷新不能覆盖保存回执',async()=>{
 const first=deferred(),second=deferred(),jobs=deferred(),nodes={collectionScope:{value:'mine'}};let calls=0,renders=0;
 const context=vm.createContext({$:s=>nodes[s.slice(1)],replaceProduct,publicationProgress:publicationActivity(),api:()=>++calls===1?first.promise:second.promise,render:()=>renders++,renderMallNames(){},refreshSetupShortcut(){},loadJobPage:()=>jobs.promise});
 vm.runInContext("var stateRequest=0,state={products:[]},page='products';"+app.slice(app.indexOf('function applyProduct('),app.indexOf('async function loadJobPage(')),context);
 const old=context.load();context.applyProduct({id:'p',revision:2,status:'pending_review'});
 first.resolve({products:[{id:'p',revision:1,status:'draft'}]});await old;
 assert.equal(context.state.products[0].revision,2);
 context.page='jobs';const load=context.load();second.resolve({products:[{id:'p',revision:2,status:'pending_review'}]});await new Promise(setImmediate);
 assert.ok(renders>=2);jobs.resolve();await load;
});
