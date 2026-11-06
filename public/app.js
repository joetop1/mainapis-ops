import {setupSameStyle,styleSourceIds} from './same-style.js';
import {applyBulkMapping} from './bulk-settings.js';
import {suggestedMergeRows,mergeSelection} from './merge-products.js';
import {productMallMappings} from './mall-mappings.js';
import {pageInfo,publicationMalls} from './list-view.js';
import {normalizeProductAttributes,descriptionWithAttributes,productAttributesFromJSON} from './product-attributes.js';
import {compareVersions,safariCollectorVersion} from './collector-version.js';
import {specificationMatrix,remapSpecificationValues,matchSpecificationImport} from './specifications.js';
import {channelConfiguration,yunzhongConfiguration} from './connection-status.js';
import {detailImagesFromJSON,detailHTML} from './detail-images.js';
import {batchPrices} from './pricing.js';
import {matchSkuImages} from './sku-images.js';
const $=s=>document.querySelector(s);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let me={},state={products:[],jobs:[],targets:[]},page='products',filter='all',editing=null,publishing=null,catalog=null,catalogRequest=0;
const selectedMalls={},settingsRequests={};
const mergeSelected=new Set();let mergingProducts=[],mergeRequestId='',mergePreviewKey='',mergePending=null;
let editingMappings=new Map(),activeMappingId='',publishResults=new Map(),publishUncertain=false;
let productPage=1,productSize=20,jobPageNumber=1,jobSize=20,jobView={rows:[],page:1,pages:1,total:0,start:0,end:0},jobRequest=0,jobLoading=false;
const mallRows=()=>state.malls||state.targets.map(t=>({...t,type:t.id,id:t.connection_id||t.id}));
const mallFor=(id,type)=>mallRows().find(m=>m.id===id)||mallRows().find(m=>m.type===type&&m.legacy)||mallRows().find(m=>m.type===type);
const labels={draft:'待整理',approved:'审核通过',dispatching:'发送中',accepted:'执行中',unknown:'需核对',succeeded:'发布成功',failed:'执行失败',awaiting_review:'待核对商品ID',verifying:'核对中'};
const date=v=>new Date(v).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
function clearDialogFeedback(dialog){dialog?.querySelectorAll('[data-dialog-feedback]').forEach(node=>node.remove());}
function toast(message,{error=false}={}){
 const global=$('#toast');clearTimeout(toast.timer);global.classList.add('hidden');
 const dialog=document.activeElement?.closest('dialog[open]')||[...document.querySelectorAll('dialog[open]')].at(-1);
 if(dialog){
  let notice=dialog.querySelector('[data-dialog-feedback]');
  if(!notice){notice=document.createElement('p');notice.dataset.dialogFeedback='';(dialog.querySelector('.form-body')||dialog).append(notice);}
  notice.className='dialog-feedback'+(error?' is-error':'');notice.setAttribute('role',error?'alert':'status');notice.textContent=message;
  notice.scrollIntoView({block:'nearest'});return;
 }
 global.textContent=message;global.classList.remove('hidden');toast.timer=setTimeout(()=>global.classList.add('hidden'),4500);
}
document.addEventListener('close',event=>{if(event.target.tagName==='DIALOG')clearDialogFeedback(event.target);},true);
async function api(path,method='GET',body,signal){
 const type=path.match(/^\/api\/connections\/(crmeb-pro|crmeb-store|tigshop|yunzhong|shopxo)(?:\/|$)/)?.[1];
 if(type&&selectedMalls[type])path+=(path.includes('?')?'&':'?')+'connection_id='+encodeURIComponent(selectedMalls[type]);
 const selector=type?document.querySelector('[data-mall-selector="'+type+'"]'):null;
 if(selector){settingsRequests[type]=(settingsRequests[type]||0)+1;selector.disabled=true;$('#addMall').disabled=true;}
 try{const r=await fetch(path,{method,signal,headers:method==='GET'?{}:{'Content-Type':'application/json','X-CSRF-Token':me.csrf},body:body===undefined?undefined:JSON.stringify(body)});const data=await r.json();if(!r.ok)throw Object.assign(Error(data.error||'请求失败'),{httpStatus:r.status});return data;}
 finally{if(selector){settingsRequests[type]--;selector.disabled=settingsRequests[type]>0;$('#addMall').disabled=Object.values(settingsRequests).some(n=>n>0);}}
}

function empty(columns,title,description){return `<tr><td colspan="${columns}" class="empty"><div class="empty-icon">▦</div><strong>${title}</strong><p>${description}</p></td></tr>`;}
const channelParts={'crmeb-pro':{},'crmeb-store':{},tigshop:{}};
function recordConnectionPart(target,key,value){
 channelParts[target][key]=value;
 const part=$('#'+target+'-'+key+'-part');
 const partName=key==='publishing'?'发布通道':target==='tigshop'?'API Token':'商城授权';
 part.textContent=partName+' · '+(value.error?'读取失败':value.configured?(key==='publishing'?'已配置':'已保存'):'未配置');part.classList.toggle('is-saved',!value.error&&!!value.configured);
 if(target==='tigshop'){
  const template=$('#tigshop-template-part');template.textContent=value.error?'运费模板 · 读取失败':value.templateId?'运费模板 · '+value.templateId:'运费模板 · 未配置';template.classList.toggle('is-saved',!value.error&&!!value.templateId);
 }

 const status=channelConfiguration(target,channelParts[target]);
 const card=document.querySelector('[data-channel="'+target+'"]');card.dataset.state=status.state;
 $('#'+target+'-connection-badge').textContent=status.label;
 $('#'+target+'-connection-summary').textContent=status.detail;
 $('#'+target+'-connection-action').textContent=status.state==='configured'?'管理配置':status.state==='partial'?'完善配置':status.state==='unconfigured'?'开始配置':'查看配置';
 const details=$('#'+target+'-connection-details');
 if(status.ready&&!details.dataset.hydrated){details.open=['unconfigured','partial'].includes(status.state);details.dataset.hydrated='true';}
 if(target!=='tigshop'&&key==='publishing'){
  $('#'+target+'-publishing-badge').textContent=value.error?'读取失败':value.configured?'已配置':'未配置';
  if(!value.error&&!value.configured)card.querySelector('.channel-advanced').open=true;
 }
 const all=Object.keys(channelParts).map(t=>channelConfiguration(t,channelParts[t]));
 if(state.malls){$('#connectionCounts').textContent=state.malls.filter(m=>m.configured).length+' 个已配置 · '+state.malls.filter(m=>!m.configured).length+' 个待配置';return;}
 const counts=[['configured','已配置'],['partial','待完善'],['unconfigured','未配置'],['error','读取失败'],['loading','读取中']].map(([key,label])=>{const n=all.filter(s=>s.state===key).length;return n?n+' 个'+label:'';}).filter(Boolean);
 $('#connectionCounts').textContent=counts.join(' · ');
}
function publicationRows(product){return publicationMalls(product,mallRows()).map(mall=>({mall,record:product.publications?.find(row=>row.mall_connection_id===mall.id||!row.mall_connection_id&&row.target===mall.type&&mall.legacy)}));}
function publicationBadges(product){
 const rows=publicationRows(product);
 if(!rows.length)return '<span class="hint">暂无商城</span>';
 return '<div class="product-publications publication-circles">'+rows.map(({mall,record})=>{const status=record?.status||'none',label=status==='succeeded'?'已发布':status==='none'?'未发布':labels[status]||'需核对',mark=mall.badge||Array.from(mall.name||'商')[0],description=mall.name+' · '+label+(record?' · v'+record.revision:'');return '<button type="button" class="publication-circle '+esc(status)+'" data-publications="'+esc(product.id)+'" title="'+esc(description)+'" aria-label="'+esc(description)+'，查看发布记录">'+esc(mark)+'</button>';}).join('')+'</div>';
}
function showPublicationDetails(product){
 $('#publicationTitle').textContent=product.title||'商品发布记录';
 $('#publicationRevision').textContent='商品当前版本 v'+product.revision+'；以下为发布核对记录，商城当前上下架状态请到商城查看。';
 $('#publicationRows').innerHTML=publicationRows(product).map(({mall,record})=>{const status=record?.status||'none',label=status==='succeeded'?'已发布':status==='failed'?'失败':status==='none'?'未发布':labels[status]||'需核对';return `<tr><td>${esc(mall.name)}<small>${esc(mall.system)}</small></td><td><span class="badge ${esc(status)}">${esc(label)}</span></td><td>${record?'v'+esc(record.revision)+(record.revision!==product.revision?'（历史版本）':''):'—'}</td><td>${esc(record?.remote_id||'—')}</td></tr>`;}).join('')||empty(4,'暂无商城发布记录','配置商城后即可查看发布情况');
 $('#publicationDialog').showModal();
}
$('#closePublication').onclick=()=>$('#publicationDialog').close();
let stateRequest=0;
async function load(){const request=++stateRequest,scope=$('#collectionScope').value,result=await api('/api/state?collection_scope='+scope);if(request!==stateRequest||scope!==$('#collectionScope').value)return;state=result;await loadJobPage();if(request!==stateRequest)return;render();renderMallNames();}
async function loadJobPage(){const request=++jobRequest;jobLoading=true;updateJobPager();try{const data=await api('/api/jobs?page='+jobPageNumber+'&page_size='+jobSize+'&task_scope='+$('#jobScope').value+'&mall='+encodeURIComponent($('#jobMall').value)+'&status='+$('#jobStatus').value);if(request!==jobRequest)return;jobView=data;jobPageNumber=data.page;}finally{if(request===jobRequest){jobLoading=false;updateJobPager();}}}
function updateJobPager(){$('#jobPrev').disabled=jobLoading||jobPageNumber<=1;$('#jobNext').disabled=jobLoading||jobPageNumber>=jobView.pages;$('#jobPageSize').disabled=jobLoading;}
function renderMallNames(){
 for(const target of state.targets){
  const rows=mallRows().filter(m=>m.type===target.id),selector=document.querySelector('[data-mall-selector="'+target.id+'"]');
  if(!rows.some(m=>m.id===selectedMalls[target.id]))selectedMalls[target.id]=rows.find(m=>m.legacy)?.id||rows[0]?.id;
  if(selector){selector.replaceChildren(...rows.map(m=>new Option(m.name+(m.configured?'':'（待配置）'),m.id)));selector.value=selectedMalls[target.id];}
  const mall=mallFor(selectedMalls[target.id],target.id);
  const domain=document.querySelector('[data-mall-domain="'+target.id+'"]');if(domain)domain.textContent=mall?.url||'尚未填写商城地址';
  document.querySelectorAll('[data-mall-title="'+target.id+'"]').forEach(node=>node.textContent=mall?.name||target.name);
  const form=document.querySelector('[data-mall-profile="'+target.id+'"]');if(form&&document.activeElement!==form.elements.mall_name)form.elements.mall_name.value=mall?.name||target.name;
  if(form&&document.activeElement!==form.elements.mall_badge)form.elements.mall_badge.value=mall?.badge||'';
  const option=$('#catalogTarget').querySelector('option[value="'+target.id+'"]');if(option)option.textContent=target.system;
 }
}
function fillCatalogMalls(id){const type=$('#catalogTarget').value,rows=mallRows().filter(m=>m.type===type);$('#catalogMall').replaceChildren(...rows.map(m=>new Option(m.name,m.id)));$('#catalogMall').value=rows.some(m=>m.id===id)?id:rows.find(m=>m.legacy)?.id||rows[0]?.id||'';}
async function loadMallSettings(type){
 const details=type==='shopxo'?$('#shopxoDetails'):type==='yunzhong'?$('#yunzhongDetails'):$('#'+type+'-connection-details');details.open=true;
 if(type==='shopxo')return loadShopxoConnection();
 if(type==='yunzhong')return loadYunzhongConnection();
 if(type==='tigshop'){await loadTigshopConnection();return loadNotifications(type);}
 if(['crmeb-pro','crmeb-store'].includes(type))await loadNotifications(type);
 await loadCrmebAuthConnections([type]);await loadCrmebPublishConnections([type]);
 const mall=mallFor(selectedMalls[type],type);document.querySelector('[data-crmeb-publishing="'+type+'"]').closest('details').classList.toggle('hidden',!mall?.legacy);
}
for(const selector of document.querySelectorAll('[data-mall-selector]'))selector.onchange=async()=>{
 const type=selector.dataset.mallSelector;selectedMalls[type]=selector.value;
 const card=selector.closest('article');if(channelParts[type])channelParts[type]={};card.querySelectorAll('input[type="password"]').forEach(input=>input.value='');
 card.querySelectorAll('[data-profile-status]').forEach(node=>node.textContent='');renderMallNames();
 try{await loadMallSettings(type);}catch(error){toast(error.message,{error:true});}
};
$('#addMall').onclick=()=>{$('#addMallForm').reset();$('#addMallDialog').showModal();};
$('#closeAddMall').onclick=()=>$('#addMallDialog').close();
$('#addMallForm').onsubmit=async event=>{event.preventDefault();const form=event.target,button=event.submitter;button.disabled=true;try{const r=await api('/api/malls','POST',{system:form.elements.system.value,name:form.elements.name.value});selectedMalls[r.connection.system]=r.connection.id;await load();$('#addMallDialog').close();await loadMallSettings(r.connection.system);toast('商城已添加，请填写并测试连接');}catch(error){toast(error.message,{error:true});}finally{button.disabled=false;}};
for(const form of document.querySelectorAll('[data-mall-profile]'))form.onsubmit=async event=>{
 event.preventDefault();const button=form.querySelector('button'),status=form.querySelector('[data-profile-status]');button.disabled=true;
 try{await api('/api/connections/'+form.dataset.mallProfile+'/profile','POST',{name:form.elements.mall_name.value,badge:form.elements.mall_badge.value});await load();status.textContent='商城名称与标识已保存';}catch(error){status.textContent=error.message;}finally{button.disabled=false;}
};
function render(){
 for(const id of mergeSelected)if(!state.products.some(p=>p.id===id))mergeSelected.delete(id);updateMergeSelection();
 const role=state.team?.role||'admin';
 const canPublish=role!=='editor';
 $('#merchantSettings').classList.toggle('hidden',role!=='admin');
 $('#connectionMemberHint').classList.toggle('hidden',role==='admin');
 $('#username').textContent=me.user.name+(state.team?' · '+state.team.name:'');
 $('#jobScopeLabel').classList.toggle('hidden',!state.team);
 const selectedJobMall=$('#jobMall').value;$('#jobMall').replaceChildren(new Option('全部商城',''),...mallRows().map(m=>new Option(m.name,m.id)));$('#jobMall').value=selectedJobMall;
 $('#collectionScope').classList.toggle('hidden',!state.team);
 $('#total').textContent=state.products.length;$('#drafts').textContent=state.products.filter(p=>p.status==='draft').length;$('#approved').textContent=state.products.filter(p=>p.status==='approved').length;$('#success').textContent=state.jobs.filter(j=>j.status==='succeeded').length;
 const usedStyleSources=styleSourceIds(state.products),showStyleSources=$('#showStyleSources').checked;
 const search=$('#search').value.toLowerCase(),products=state.products.filter(p=>(showStyleSources||!usedStyleSources.has(p.id))&&(filter==='all'||p.status===filter)&&`${p.title} ${p.source_url} ${(p.skus||[]).map(s=>s.source?.url||'').join(' ')}`.toLowerCase().includes(search));
 const productPaging=pageInfo(products.length,productPage,productSize);productPage=productPaging.page;
 $('#count').textContent=`第 ${productPaging.start}–${productPaging.end} 件 / 筛选结果 ${products.length} 件（已加载 ${state.products.length} 件，最多 1000 件）`;
 $('#productPageInfo').textContent=productPaging.page+' / '+productPaging.pages+' 页';$('#productPrev').disabled=productPage<=1;$('#productNext').disabled=productPage>=productPaging.pages;
 $('#productRows').innerHTML=products.slice(productPaging.offset,productPaging.offset+productPaging.pageSize).map(p=>`<tr><td><input type="checkbox" data-merge-select="${esc(p.id)}" aria-label="选择商品：${esc(p.title||p.source_url)}" ${mergeSelected.has(p.id)?'checked':''}></td><td><div class="product-cell">${p.images[0]?`<img class="thumb" loading="lazy" referrerpolicy="no-referrer" src="${esc(p.images[0])}" alt="">`:'<div class="thumb">▧</div>'}<div><div class="title" title="${esc(p.title||p.source_url)}">${esc(p.title||'待采集 · '+p.source_url.match(/offer\/(\d+)/)?.[1])}</div><small>${esc(p.category||'尚未分类')} · v${p.revision}</small>${state.team?'<small>采集：'+esc(p.collected_by===me.user.sub?'我':p.collector_name||p.collected_by||'历史采集人未知')+'</small>':''}</div></div></td><td>${p.supplier_import?'<span>货盘 · '+esc(p.supplier_import.supplier)+'</span>':`<a href="${esc(p.source_url)}" target="_blank" rel="noopener noreferrer">1688 ↗</a>`}${p.same_style?'<small>货盘同款整理商品</small>':p.merge_sources?'<small>多链接合并商品</small>':''}${usedStyleSources.has(p.id)?'<small>已用于同款整理，原记录保留</small>':''}</td><td>${p.skus.length} 个 SKU${p.spec_names?.length?`<small>${esc(p.spec_names.join(' × '))}</small>`:''}<small>${p.skus.length?'¥ '+Math.min(...p.skus.map(s=>s.price)).toFixed(2)+' 起':'尚未录入价格'}</small></td><td><span class="badge ${p.status}">${labels[p.status]}</span></td><td>${publicationBadges(p)}</td><td>${date(p.updated)}</td><td><button class="text" data-edit="${p.id}">编辑</button>${!canPublish?'':p.status==='approved'?`<button class="text" data-publish="${p.id}">发布</button>`:`<button class="text" data-approve="${p.id}">审核</button>`}</td></tr>`).join('')||empty(8,'采集箱已准备好','添加 1688 商品链接，或导入采集器整理好的 JSON 商品资料。');
 $('#jobRows').innerHTML=jobView.rows.map(j=>`<tr><td>${esc(j.product_title||state.products.find(p=>p.id===j.product_id)?.title||'商品记录')}<small>${j.id.slice(0,8)} · v${j.revision}</small>${state.team?'<small>发起：'+esc(j.initiated_by===me.user.sub?'我':j.initiator_name||j.initiated_by||'历史发起人未知')+'</small>':''}</td><td>${esc(mallFor(j.mall_connection_id,j.target)?.name||j.target)}</td><td><span class="badge ${j.status}">${labels[j.status]||esc(j.status)}</span></td><td>${esc(j.message||'等待执行')}${canPublish&&j.id==='650b74d9-6d5e-4174-9245-4d45163e3699'&&j.status==='unknown'&&j.message.includes('商品总库存必须大于0')?`<button class="text" data-recover-stock="${j.id}">核对未入库并结束任务</button>`:''}${j.fx?`<small>1 EUR = ${esc(j.fx.cnyPerEur)} CNY · 汇率日期 ${esc(j.fx.rateDate)}</small>`:''}${j.remote_id?`<small>商城商品 ID：${esc(j.remote_id)}</small>`:''}${j.claimed?`<small>任务编码：${esc(j.marker)}</small>`:''}${canPublish&&j.target==='yunzhong'&&j.claimed&&j.status==='unknown'&&!j.remote_id&&j.message.includes('兼容扩展返回 HTTP 400')?`<button class="text" data-recover-yunzhong="${j.id}">核对未入库并恢复原任务</button>`:''}${canPublish&&['crmeb-pro','crmeb-store','tigshop','yunzhong','shopxo'].includes(j.target)&&j.claimed&&!['succeeded','failed'].includes(j.status)?`<button class="text" data-verify="${j.id}">填写商品 ID 核对</button>`:''}${canPublish&&['crmeb-pro','crmeb-store','tigshop','yunzhong','shopxo'].includes(j.target)&&!j.claimed&&['accepted','unknown'].includes(j.status)?`<button class="text" data-retry="${j.id}">重发未领取任务</button>`:''}</td><td>${date(j.created)}</td></tr>`).join('')||empty(5,'还没有发布任务','审核商品后，选择一个目标商城创建发布任务。');
 $('#jobCount').textContent='第 '+jobView.start+'–'+jobView.end+' 条 / 共 '+jobView.total+' 条记录';$('#jobPageInfo').textContent=jobPageNumber+' / '+jobView.pages+' 页';updateJobPager();
 $('#connectionScope').textContent=state.team?'当前团队：'+state.team.name+' · 管理员配置后由团队共享':'当前个人工作空间';
 $('#connectionSystemStatus').textContent=(me.demo?'本地演示登录':'统一账号已登录')+' · 商品工作流状态请在发布任务中查看。';
}
document.querySelectorAll('[data-page]').forEach(b=>b.onclick=()=>{page=b.dataset.page;document.querySelectorAll('[data-page]').forEach(x=>x.classList.toggle('active',x===b));for(const p of ['products','jobs','connections','team','systemSettings'])$('#'+p).classList.toggle('hidden',p!==page);const titles={products:'商品采集箱',jobs:'发布任务',connections:'连接与配置',team:'团队管理',systemSettings:'系统设置'};$('#heading').textContent=$('#breadcrumb').textContent=titles[page];$('#subtitle').textContent={products:'让每一份货源资料，成为准备好上架的商品。',jobs:'从任务接收到商城入库，每一步都有记录。',connections:'连接你的账号、工作流与商城。',team:'共同维护商品，按角色完成整理、审核和发布。',systemSettings:'管理站点名称、图标和登录页展示。'}[page];$('#productActions').classList.toggle('hidden',page!=='products');if(page==='systemSettings'){loadSystemInfo();loadImageStorage();}if(page==='team')loadTeam().catch(e=>toast(e.message));if(page==='connections'){loadCollectorDownload();if((state.team?.role||'admin')==='admin'){loadYunzhongConnection();loadShopxoConnection();loadCrmebAuthConnections();loadCrmebPublishConnections();loadNotifications();loadNotifications('crmeb-store');loadNotifications('tigshop');loadTigshopConnection().catch(e=>{$('#tigshopConnectionStatus').textContent=e.message;recordConnectionPart('tigshop','auth',{error:true});});}}});
document.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{filter=b.dataset.filter;productPage=1;document.querySelectorAll('[data-filter]').forEach(x=>x.classList.toggle('active',x===b));render();});$('#search').oninput=()=>{productPage=1;render();};
let editingSpecNames=[];
function readSkuRows(){
 return [...$('#skuRows').children].map(tr=>{
  const value=key=>tr.querySelector('[data-key="'+key+'"]').value;
  const row={...(tr.dataset.source?{source:JSON.parse(tr.dataset.source)}:{}),sku:value('sku'),cost:Number(value('cost')),price:Number(value('price')),stock:Number(value('stock')),image:value('image')};
  if(editingSpecNames.length){row.spec_values=editingSpecNames.map((_,i)=>value('specValue'+i));row.spec=row.spec_values.some(Boolean)?row.spec_values.join(' / '):tr.dataset.legacySpec||'';}
  else row.spec=value('spec');
  return row;
 });
}
function renderSkuHeader(){
 const columns=['SKU 编码',...(editingSpecNames.length?editingSpecNames:['规格（原文本）']),'成本 ¥','售价 ¥','库存','SKU 图片',''];
 $('#skuHeaderRow').innerHTML=columns.map(name=>'<th>'+esc(name)+'</th>').join('');
 $('#specDimensionStatus').textContent=editingSpecNames.length?'当前维度：'+editingSpecNames.join(' × ')+'。每行对应一个真实 SKU，按列填写各规格值。':'当前为单列规格。多维度商品请设置颜色、尺码等列；已有合并文字需逐项核对，不自动拆分。';
}
function skuRow(s={sku:'',spec:'',cost:0,price:0,stock:0}){
 const tr=document.createElement('tr');tr.dataset.legacySpec=s.spec||'';if(s.source)tr.dataset.source=JSON.stringify(s.source);
 const fields=[{key:'sku',value:s.sku},...(editingSpecNames.length?editingSpecNames.map((name,i)=>({key:'specValue'+i,value:s.spec_values?.[i]||'',label:name})):[{key:'spec',value:s.spec}]),...['cost','price','stock'].map(key=>({key,value:s[key]}))];
 tr.innerHTML=fields.map(({key,value,label})=>`<td><input aria-label="${esc(label||key)}" data-key="${key}" value="${esc(value)}" ${['cost','price','stock'].includes(key)?`type="number" min="0" step="${key==='stock'?'1':'0.01'}"`:'type="text"'} required></td>`).join('')+'<td><button type="button" class="text" data-remove-sku>×</button></td>';
 if(editingSpecNames.length&&s.spec&&(!s.spec_values||s.spec_values.some(v=>!v))){const old=document.createElement('small');old.textContent='原规格：'+s.spec;tr.firstElementChild.append(old);}
 if(s.source){const note=document.createElement('small'),link=document.createElement('a');link.href=s.source.url;link.target='_blank';link.rel='noopener noreferrer';link.textContent='原来源 ↗ · '+s.source.sku;note.append(link);tr.firstElementChild.append(note);}
 const cell=document.createElement('td'),img=document.createElement('img');img.className='thumb';img.alt='规格图片';img.referrerPolicy='no-referrer';img.loading='lazy';
 const input=document.createElement('input');input.type='url';input.dataset.key='image';input.setAttribute('aria-label','SKU 图片地址');input.placeholder='未设置时使用商品首图';input.value=s.image||'';
 const show=()=>{img.hidden=!input.value;if(input.value.startsWith('https://'))img.src=input.value;else img.removeAttribute('src');};input.oninput=show;show();const local=document.createElement('input');local.type='file';local.accept='image/png,image/jpeg,image/webp,image/gif';local.setAttribute('aria-label','上传本地SKU图片');local.onchange=()=>uploadEditorImages([...local.files],null,tr).finally(()=>{local.value='';});cell.append(img,input,local);tr.insertBefore(cell,tr.lastElementChild);tr.querySelector('[data-remove-sku]').onclick=()=>tr.remove();$('#skuRows').append(tr);
}
$('#specificationsFile').onchange=async e=>{
 try{
  const file=e.target.files[0];if(!file)return;if(file.size>2*1024*1024)throw Error('文件请小于 2 MB');
  const data=JSON.parse(await file.text()),product=Array.isArray(data.products)?(data.products.length===1?data.products[0]:null):data;
  if(!product)throw Error('请选择仅包含当前商品的采集文件');
  const result=matchSpecificationImport($('#productForm').elements.source_url.value,readSkuRows(),product);
  editingSpecNames=result.names;$('#specNames').value=editingSpecNames.join(', ');renderSkuHeader();$('#skuRows').innerHTML='';result.skus.forEach(skuRow);
  toast('已按 SKU 编码补回规格维度，价格、成本、库存和配图保留；核对后保存。');
 }catch(e){toast(e.message);}finally{e.target.value='';}
};
$('#applySpecNames').onclick=()=>{
 try{
  const next=$('#specNames').value.split(/[,，]/).map(v=>v.trim()).filter(Boolean),rows=remapSpecificationValues(readSkuRows(),editingSpecNames,next);
  editingSpecNames=next;$('#specNames').value=next.join(', ');renderSkuHeader();$('#skuRows').innerHTML='';rows.forEach(skuRow);
  toast('规格列已更新，请核对每行的规格值后保存；价格和库存保留。');
 }catch(e){toast(e.message);}
};
let editorImageGeneration=0,editorImageBusy=0;
const imageFields={images:'mainImageGallery',detail_images:'detailImageGallery'};
function imageLinks(field){return $('#productForm').elements[field].value.split('\n').map(x=>x.trim()).filter(Boolean);}
let imageDrag=null;
function moveGalleryImage(field,from,to){
 const links=imageLinks(field);if(!Number.isInteger(from)||!Number.isInteger(to)||from<0||to<0||from>=links.length||to>=links.length||from===to)return;
 links.splice(to,0,links.splice(from,1)[0]);$('#productForm').elements[field].value=links.join('\n');renderImageGallery(field);
}
function renderImageGallery(field){
 const gallery=$('#'+imageFields[field]),links=imageLinks(field);gallery.replaceChildren();
 if(!links.length){const hint=document.createElement('p');hint.className='hint';hint.textContent=field==='images'?'尚未添加主图':'尚未添加详情图';gallery.append(hint);return;}
 links.forEach((url,index)=>{
  const card=document.createElement('div');card.className='image-card';card.draggable=true;
  card.ondragstart=e=>{if(e.target.closest('.image-card-actions')){e.preventDefault();return;}imageDrag={field,index};e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain','mainapis-image');card.classList.add('dragging');};
  card.ondragover=e=>{if(imageDrag?.field!==field)return;e.preventDefault();e.dataTransfer.dropEffect='move';card.classList.add('drop-target');};
  card.ondragleave=()=>card.classList.remove('drop-target');
  card.ondrop=e=>{if(imageDrag?.field!==field)return;e.preventDefault();const from=imageDrag.index;imageDrag=null;moveGalleryImage(field,from,index);};
  card.ondragend=()=>{imageDrag=null;gallery.querySelectorAll('.image-card').forEach(node=>node.classList.remove('dragging','drop-target'));};
  const preview=document.createElement('button');preview.type='button';preview.className='image-preview';preview.setAttribute('aria-label',`放大${field==='images'?'主图':'详情图'} ${index+1}`);
  const img=document.createElement('img');img.draggable=false;img.alt=`图片 ${index+1}`;img.loading='lazy';img.referrerPolicy='no-referrer';
  // Reject unsafe schemes in editable links before assigning a browser URL.
  let safe=false;try{const parsed=new URL(url);safe=parsed.protocol==='https:'&&!parsed.username&&!parsed.password;}catch{}
  if(safe)img.src=url;
  const error=document.createElement('span');error.className='image-load-error';error.textContent=safe?'图片加载失败，可放大重试':'请填写有效的 HTTPS 图片地址';error.hidden=safe;
  img.onerror=()=>{error.hidden=false;img.hidden=true;};
  preview.append(img,error);preview.disabled=!safe;
  preview.onclick=()=>{$('#imageViewerTitle').textContent=`${field==='images'?'主图':'详情图'} ${index+1}`;$('#imageViewerImage').src=url;$('#imageViewer').showModal();};
  const footer=document.createElement('div');footer.className='image-card-actions';
  const label=document.createElement('span');label.textContent=field==='images'&&index===0?'1 · 主图':String(index+1);
  const remove=document.createElement('button');remove.type='button';remove.className='text';remove.textContent='删除';remove.setAttribute('aria-label',`删除${field==='images'?'主图':'详情图'} ${index+1}`);
  remove.onclick=()=>{const current=imageLinks(field);current.splice(index,1);$('#productForm').elements[field].value=current.join('\n');renderImageGallery(field);};
  const moves=document.createElement('div');moves.className='image-reorder';
  for(const [text,offset] of [['←',-1],['→',1]]){const button=document.createElement('button');button.type='button';button.className='text';button.textContent=text;button.disabled=index+offset<0||index+offset>=links.length;button.setAttribute('aria-label',(offset<0?'前移':'后移')+'图片 '+(index+1));button.onclick=()=>{moveGalleryImage(field,index,index+offset);gallery.children[index+offset]?.querySelector('.image-reorder button:not(:disabled)')?.focus();};moves.append(button);}
  footer.append(label,moves,remove);card.append(preview,footer);gallery.append(card);
 });
}
async function uploadEditorImages(files,field,row=null){
 if(!files.length)return;const generation=editorImageGeneration,save=$('#productForm').querySelector('button[type=submit]'),status=$('#localImageStatus');let completed=0,acquired=false;
 try{
  if(editorImageBusy)throw Error('请等待当前图片上传完成，再选择其他图片');
  if(row&&files.length!==1)throw Error('每个SKU一次上传一张图片');
  if(field&&imageLinks(field).length+files.length>(field==='images'?30:100))throw Error(field==='images'?'主图最多30张，请先删除多余图片':'详情图最多100张，请先删除多余图片');
  if(files.some(file=>file.size>10*1024*1024))throw Error('单张图片最大10MB');
  editorImageBusy++;acquired=true;save.disabled=true;
  for(const [index,file]of files.entries()){
   if(generation!==editorImageGeneration||!$('#editor').open)throw Error('编辑窗口已关闭或切换，未继续上传');
   status.textContent='正在上传图片 '+(index+1)+'/'+files.length+'：'+file.name;
   const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(Error('图片读取失败'));reader.readAsDataURL(file);});
   const result=await api('/api/images/upload','POST',{data});
   if(generation!==editorImageGeneration||!$('#editor').open)throw Error('编辑窗口已关闭或切换，图片未加入商品');
   if(row){if(!row.isConnected)throw Error('该SKU已移除，图片未加入商品');const input=row.querySelector('[data-key="image"]');input.value=result.url;input.dispatchEvent(new Event('input'));}
   else{const links=imageLinks(field);if(links.length>=(field==='images'?30:100))throw Error('图片数量已达上限，上传图片未加入图库');if(!links.includes(result.url))links.push(result.url);$('#productForm').elements[field].value=links.join('\n');renderImageGallery(field);}
   completed++;
  }
  status.textContent='已上传 '+completed+' 张图片，请检查并保存商品。';toast(status.textContent);
 }catch(e){if(generation===editorImageGeneration){status.textContent=(completed?'已加入 '+completed+' 张图片；':'')+e.message;toast(status.textContent,{error:true});}}
 finally{if(generation===editorImageGeneration){if(acquired)editorImageBusy--;save.disabled=editorImageBusy>0;}}
}
$('#shortenProductImages').onclick=async()=>{
 const generation=editorImageGeneration,save=$('#productForm').querySelector('button[type=submit]');let acquired=false,done=0;
 try{if(editorImageBusy)throw Error('请等待当前图片上传完成');const skuInputs=[...$('#skuRows').querySelectorAll('[data-key="image"]')],urls=[...new Set([...imageLinks('images'),...imageLinks('detail_images'),...skuInputs.map(input=>input.value).filter(Boolean)])].filter(url=>url.length>128);if(!urls.length)return toast('当前图片地址长度无需修复');editorImageBusy++;acquired=true;save.disabled=true;
 for(const [index,url]of urls.entries()){if(generation!==editorImageGeneration||!$('#editor').open)throw Error('编辑窗口已切换，停止修复');$('#localImageStatus').textContent='正在修复图片地址 '+(index+1)+'/'+urls.length;const result=await api('/api/images/shorten','POST',{url});if(generation!==editorImageGeneration||!$('#editor').open)throw Error('编辑窗口已切换，图片未加入商品');for(const field of ['images','detail_images']){$('#productForm').elements[field].value=imageLinks(field).map(value=>value===url?result.url:value).join('\n');renderImageGallery(field);}for(const input of $('#skuRows').querySelectorAll('[data-key="image"]'))if(input.value===url){input.value=result.url;input.dispatchEvent(new Event('input'));}done++;}
 $('#localImageStatus').textContent='已修复 '+done+' 张图片的地址，请保存商品。';toast($('#localImageStatus').textContent);
 }catch(e){if(generation===editorImageGeneration){$('#localImageStatus').textContent=(done?'已修复 '+done+' 张；':'')+e.message;toast($('#localImageStatus').textContent,{error:true});}}finally{if(generation===editorImageGeneration){if(acquired)editorImageBusy--;save.disabled=editorImageBusy>0;}}
};
$('#localMainImages').onchange=event=>uploadEditorImages([...event.target.files],'images').finally(()=>{event.target.value='';});
$('#localDetailImages').onchange=event=>uploadEditorImages([...event.target.files],'detail_images').finally(()=>{event.target.value='';});
for(const field of Object.keys(imageFields))$('#productForm').elements[field].addEventListener('input',()=>renderImageGallery(field));
$('#closeImageViewer').onclick=()=>{$('#imageViewer').close();$('#imageViewerImage').removeAttribute('src');};
function attributeRow(row={name:'',value:''}){
 const item=document.createElement('div');item.className='attribute-row';
 const name=document.createElement('input');name.value=row.name;name.maxLength=60;name.placeholder='参数名称，例如：材质';name.setAttribute('aria-label','参数名称');name.dataset.attributeName='';
 const value=document.createElement('input');value.value=row.value;value.maxLength=1000;value.placeholder='参数内容';value.setAttribute('aria-label','参数内容');value.dataset.attributeValue='';
 const remove=document.createElement('button');remove.type='button';remove.className='text';remove.textContent='删除';remove.onclick=()=>item.remove();item.append(name,value,remove);$('#attributeRows').append(item);
}
function readProductAttributes(){return normalizeProductAttributes([...$('#attributeRows').children].map(row=>({name:row.querySelector('[data-attribute-name]').value,value:row.querySelector('[data-attribute-value]').value})));}
$('#addProductAttribute').onclick=()=>attributeRow();
$('#productAttributesFile').onchange=async event=>{
 try{const file=event.target.files[0];if(!file)return;if(file.size>2*1024*1024)throw Error('采集文件请小于 2 MB');const rows=productAttributesFromJSON($('#productForm').elements.source_url.value,JSON.parse(await file.text()));if($('#attributeRows').children.length&&!confirm('用文件中的产品参数替换当前参数？其他商品资料不变。'))return;$('#attributeRows').replaceChildren();rows.forEach(attributeRow);toast('已补充 '+rows.length+' 项产品参数，请核对后保存');}catch(error){toast(error.message);}finally{event.target.value='';}
};
function edit(p=null){editorImageGeneration++;editorImageBusy=0;$('#productForm').querySelector('button[type=submit]').disabled=false;$('#localImageStatus').textContent='';editing=p;editingMappings=new Map(productMallMappings(p||{}).map(m=>[m.catalog_connection_id,m]));$('#editorTitle').textContent=p?'编辑商品':'添加商品';const f=$('#productForm');f.reset();$('#attributeRows').replaceChildren();normalizeProductAttributes(p?.attributes).forEach(attributeRow);f.elements.catalog_target.value=p?.catalog_target||'crmeb-pro';fillCatalogMalls(p?.catalog_connection_id);activeMappingId=$('#catalogMall').value;if(p&&p.mall_mappings===undefined&&!editingMappings.has(activeMappingId))editingMappings.set(activeMappingId,productMallMappings({...p,catalog_connection_id:activeMappingId})[0]);f.elements.applicable_type.value=String(p?.applicable_type??0);$('#storeScopeField').classList.toggle('hidden',f.elements.catalog_target.value!=='crmeb-store');$('#batchPriceMode').onchange();for(const key of ['source_url','title','description'])f.elements[key].value=p?.[key]||'';f.elements.tag_ids.value=(p?.tag_ids||[]).join(',');f.elements.virtual_sales.value=p?.virtual_sales??0;f.elements.source_url.readOnly=!!p;f.elements.source_url.type=p?.supplier_import?'hidden':'url';f.elements.source_url.closest('label').classList.toggle('hidden',!!p?.supplier_import);f.elements.images.value=p?.images.join('\n')||'';f.elements.detail_images.value=(p?.detail_images||[]).join('\n');for(const field of Object.keys(imageFields))renderImageGallery(field);editingSpecNames=[...(p?.spec_names||[])];$('#specNames').value=editingSpecNames.join(', ');renderSkuHeader();$('#skuRows').innerHTML='';(p?.skus||[]).forEach(skuRow);$('#sourcingHint').textContent=p?.supplier_import?`供应商：${p.supplier_import.supplier}；货盘：${p.supplier_import.filename}；原分类：${p.supplier_import.category_hint||'无'}；采购箱规：${p.supplier_import.packaging||'未提供'}。` :p?.sourcing?`1688 采购参考价：${p.sourcing.purchase_price||'未提供'}；代发价：${p.sourcing.dropship_price||'未提供'}；来源类目：${p.sourcing.category||'未提供'}；来源标签：${p.sourcing.tags||'未提供'}；供应商销量：${p.sourcing.supplier_sales||'未提供'}（不计入商城销量）。请补充完整规格，再确认成本、售价与库存。`:'';renderMergeSources(p);$('#editor').showModal();$('#editor .form-body').scrollTop=0;updateEditorTop();renderMappingSummary();loadCatalogOptions(p).catch(e=>{$('#catalogStatus').textContent=e.message;});}
function catalogLoadFailed(kind,id){
 const select=$('#'+kind+'Select');select.innerHTML='<option value="0">'+(kind==='brand'?'不设置品牌':'请选择分类')+'</option>'+(id?'<option value="'+Number(id)+'">原'+(kind==='brand'?'品牌':'分类')+' ID '+Number(id)+'（读取失败，尚未校验）</option>':'');select.value=String(id);select.disabled=false;
 $('#'+kind+'Matches').textContent='读取失败，请刷新重试'+(kind==='brand'?'；也可选择不设置品牌。':'。');
}
async function loadCatalogOptions(p=null,force=false){
 for(const kind of ['category','brand']){$('#'+kind+'Search').value='';$('#'+kind+'Matches').textContent='';$('#'+kind+'Select').size=1;}
 const request=++catalogRequest;catalog=null;const target=p?.catalog_target||$('#catalogTarget').value;
 const categoryId=p?.category_id||0,brandIds=p?.brand_ids||[],brandId=brandIds.at(-1)||0;
 $('#categorySelect').innerHTML=`<option value="${categoryId}">${esc(categoryId?(p?.category||'原分类')+'（等待校验）':'正在读取商城分类…')}</option>`;
 $('#brandSelect').innerHTML=`<option value="${brandId}">${esc(brandId?'原品牌（等待校验）':'不设置品牌')}</option>`;
 $('#categorySelect').disabled=$('#brandSelect').disabled=true;
 $('#catalogStatus').textContent='正在从所选商城读取分类和品牌…';
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
 try{
  const connectionId=p?.catalog_connection_id||$('#catalogMall').value;const data=await api('/api/catalog/'+target+'?connection_id='+encodeURIComponent(connectionId)+(force?'&refresh=1':''),'GET',undefined,controller.signal);if(request!==catalogRequest)return;catalog=data;
  if(data.categoryError)catalogLoadFailed('category',categoryId);
  if(data.brandError)catalogLoadFailed('brand',brandId);
  if(!data.categoryError){
   const missing=categoryId&&!data.categories.some(x=>x.id===categoryId);
   $('#categorySelect').innerHTML='<option value="0">请从商城分类中选择</option>'+data.categories.map(x=>`<option value="${x.id}">${esc(x.label)}（${x.id}）</option>`).join('')+(missing?`<option value="${categoryId}">原分类已不可用，请重新选择</option>`:'');
   $('#categorySelect').value=String(categoryId);$('#categorySelect').disabled=false;
  }
  if(!data.brandError){
   const missing=brandId&&!data.brands.some(x=>x.id===brandId);
   $('#brandSelect').innerHTML='<option value="0">不设置品牌</option>'+data.brands.map(x=>`<option value="${x.id}">${esc(x.label)}（${x.id}）</option>`).join('')+(missing?`<option value="${brandId}">原品牌未在商城可见列表中，请重新选择</option>`:'');
   $('#brandSelect').value=String(brandId);$('#brandSelect').disabled=false;
  }
  $('#catalogStatus').textContent=[data.notice,data.categoryError,data.brandError,!data.categories.length&&!data.categoryError?'商城未返回可见分类。':'',!data.brands.length&&!data.brandError?'商城未返回可见品牌，可先不设置品牌。':'',!categoryId&&p?.category?'原分类：'+p.category+'，请从商城列表重新选择。':''].filter(Boolean).join(' ');
 }catch(e){if(request===catalogRequest){catalogLoadFailed('category',categoryId);catalogLoadFailed('brand',brandId);$('#catalogStatus').textContent='读取商城选项失败，请点刷新重试：'+(e.name==='AbortError'?'商城响应超时':e.message);}}finally{clearTimeout(timer);}
}
function filterCatalog(kind){
 const input=$('#'+kind+'Search'),select=$('#'+kind+'Select'),status=$('#'+kind+'Matches');
 if(select.disabled||!catalog)return;
 const query=input.value.trim().toLocaleLowerCase(),rows=kind==='category'?catalog.categories:catalog.brands;
 const selected=select.value,previous=[...select.options].find(o=>o.value===selected);
 const matches=rows.filter(row=>(row.label+' '+row.id).toLocaleLowerCase().includes(query));
 const selectedRow=rows.find(row=>String(row.id)===selected);
 const pinned=selected!=='0'&&!matches.some(row=>String(row.id)===selected)?(selectedRow?`<option value="${selected}">当前：${esc(selectedRow.label)}（${selected}）</option>`:previous?`<option value="${selected}">${esc(previous.textContent)}</option>`:''):'';
 select.innerHTML='<option value="0">'+(kind==='category'?'请选择分类':'不设置品牌')+'</option>'+pinned+matches.map(row=>`<option value="${row.id}">${esc(row.label)}（${row.id}）</option>`).join('');
 select.value=selected;select.size=query?Math.min(7,Math.max(2,select.options.length)):1;
 status.textContent=query?`匹配 ${matches.length} 项${matches.length?'，请在下方选择':'，请更换关键词'}。`:'';
}
for(const kind of ['category','brand']){
 $('#'+kind+'Search').oninput=()=>filterCatalog(kind);
 $('#'+kind+'Search').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();$('#'+kind+'Select').focus();}};
}
function currentMapping(){
 const f=$('#productForm'),old=editingMappings.get(activeMappingId)||{},categoryId=Number(f.elements.category_id.value)||0,brandId=Number(f.elements.brand_id.value)||0;
 const brand=catalog?.brands?.find(x=>x.id===brandId),category=catalog?.categories?.find(x=>x.id===categoryId);
 return {catalog_connection_id:activeMappingId,catalog_target:mallFor(activeMappingId)?.type||old.catalog_target||$('#catalogTarget').value,category_id:categoryId,category:category?.label||(categoryId===old.category_id?old.category:'')||'',brand_ids:brand?.ids||(brandId===old.brand_ids?.at(-1)?old.brand_ids:brandId?[brandId]:[]),tag_ids:f.elements.tag_ids.value.trim()?f.elements.tag_ids.value.trim().split(/[,，\s]+/).map(Number):[],...((mallFor(activeMappingId)?.type||old.catalog_target)==='crmeb-store'?{applicable_type:Number(f.elements.applicable_type.value)}:{})};
}
function rememberMapping(){if(!activeMappingId)return;if($('#categorySelect').disabled||$('#brandSelect').disabled)return;editingMappings.set(activeMappingId,currentMapping());}
function renderMappingSummary(){
 const rows=mallRows().filter(m=>m.configured||m.id===activeMappingId||editingMappings.has(m.id));
 $('#mallMappingSummary').innerHTML=rows.map(m=>{const saved=editingMappings.get(m.id),label=saved?.category_id?saved.category||'分类ID '+saved.category_id:'待选择分类',brand=saved?.brand_ids?.length?'品牌已设置':'不设置品牌';return '<button type="button" class="mapping-choice '+(m.id===activeMappingId?'active':'')+'" data-mapping-mall="'+esc(m.id)+'" aria-pressed="'+(m.id===activeMappingId)+'"><strong>'+esc(m.name)+'</strong><small>'+esc(label+' · '+brand)+(m.configured?'':' · 连接待配置')+'</small></button>';}).join('');
}
function switchMapping(id){
 const mall=mallFor(id);if(!mall)return;rememberMapping();activeMappingId=mall.id;$('#catalogTarget').value=mall.type;fillCatalogMalls(mall.id);
 const mapping=editingMappings.get(mall.id)||{catalog_target:mall.type,catalog_connection_id:mall.id,category_id:0,category:'',brand_ids:[],tag_ids:[],applicable_type:0};
 $('#storeScopeField').classList.toggle('hidden',mall.type!=='crmeb-store');const f=$('#productForm');f.elements.applicable_type.value=String(mapping.applicable_type??0);f.elements.tag_ids.value=(mapping.tag_ids||[]).join(',');renderMappingSummary();loadCatalogOptions(mapping);
}
$('#mallMappingSummary').onclick=event=>{const button=event.target.closest('[data-mapping-mall]');if(button)switchMapping(button.dataset.mappingMall);};
$('#catalogTarget').onchange=()=>{const target=$('#catalogTarget').value,id=mallRows().find(m=>m.type===target&&m.configured)?.id||mallFor(null,target)?.id;switchMapping(id);};
$('#catalogMall').onchange=()=>switchMapping($('#catalogMall').value);
for(const id of ['categorySelect','brandSelect'])$('#'+id).addEventListener('change',()=>{rememberMapping();renderMappingSummary();});
$('#refreshCatalog').onclick=()=>{
 rememberMapping();loadCatalogOptions(editingMappings.get(activeMappingId)||currentMapping(),true);
};
function updateMergeSelection(){const count=mergeSelected.size;$('#mergeSelectedCount').textContent='已选 '+count+' 条';$('#mergeProducts').disabled=count<2||count>20||state.products.some(p=>mergeSelected.has(p.id)&&p.supplier_import);$('#sameStyleProducts').disabled=!state.products.some(p=>mergeSelected.has(p.id)&&p.supplier_import);$('#bulkProductSettings').disabled=!count;$('#clearMergeSelection').disabled=!count;}
$('#productRows').addEventListener('change',event=>{const input=event.target.closest('[data-merge-select]');if(!input)return;if(input.checked){if(mergeSelected.size>=100){input.checked=false;toast('每次最多选择100条商品');return;}mergeSelected.add(input.dataset.mergeSelect);}else mergeSelected.delete(input.dataset.mergeSelect);updateMergeSelection();});
$('#clearMergeSelection').onclick=()=>{mergeSelected.clear();render();};
function renderMergeSources(product){const refs=product?.merge_sources||[],sources=refs.length?refs:(product?.skus||[]).filter(s=>s.source).map(s=>({product_id:s.source.product_id,revision:s.source.revision,url:s.source.url}));$('#editorMergeSources').classList.toggle('hidden',!sources.length);$('#editorMergeSourcesList').innerHTML=sources.map(ref=>{const original=state.products.find(p=>p.id===ref.product_id);return ref.url.startsWith('supplier:')?'<p>货盘：'+esc(original?.title||ref.product_id)+' · '+esc(original?.supplier_import?.supplier||'原供应商')+' · v'+esc(ref.revision)+'</p>':'<p>采集：<a href="'+esc(ref.url)+'" target="_blank" rel="noopener noreferrer">'+esc(original?.title||ref.url)+'</a> · v'+esc(ref.revision)+'</p>';}).join('')+(product?.same_style?.matches||[]).map(r=>'<p>货盘SKU '+esc(r.sku)+' → '+(r.reference_sku?'采集SKU '+esc(r.reference_sku):'未对应，保留货盘配图')+'</p>').join('');}
function readMergeInput(){return {products:mergingProducts.map(p=>({id:p.id,revision:p.revision})),main_id:$('#mergeMain').value,title:$('#mergeTitle').value,dimension:$('#mergeDimension').value,images:$('#mergeImages').value,details:$('#mergeDetails').value,rows:[...$('#mergeSkuRows').children].map(tr=>({product_id:tr.dataset.productId,original_sku:tr.dataset.originalSku,sku:tr.querySelector('[data-merge-code]').value,value:tr.querySelector('[data-merge-value]').value}))};}
function invalidateMerge(){if(mergePending)return;mergePreviewKey='';$('#confirmMerge').disabled=true;$('#mergePreview').replaceChildren();}
function lockMergeFields(locked){$('#mergeForm .form-body').querySelectorAll('input,select').forEach(el=>el.disabled=locked);$('#previewMerge').disabled=locked;}
$('#mergeProducts').onclick=()=>{try{mergingProducts=mergeSelection(state.products,mergeSelected);mergeRequestId=crypto.randomUUID();mergePending=null;mergePreviewKey='';lockMergeFields(false);$('#confirmMerge').disabled=true;$('#confirmMerge').textContent='生成合并商品';$('#mergePreview').replaceChildren();clearDialogFeedback($('#mergeDialog'));$('#mergeMain').replaceChildren(...mergingProducts.map(p=>new Option(p.title||p.source_url,p.id)));$('#mergeTitle').value=mergingProducts[0].title;$('#mergeDimension').value='型号';$('#mergeImages').value='all';$('#mergeDetails').value='main';
 $('#mergeSkuRows').innerHTML=suggestedMergeRows(mergingProducts).map(row=>{const product=mergingProducts.find(p=>p.id===row.product_id),sku=product.skus.find(s=>s.sku===row.original_sku);return '<tr data-product-id="'+esc(product.id)+'" data-original-sku="'+esc(sku.sku)+'"><td>'+esc(product.title)+'<small>'+esc(sku.spec||'默认规格')+'</small><a href="'+esc(sku.source?.url||product.source_url)+'" target="_blank" rel="noopener noreferrer">原来源 ↗</a><small>原编码：'+esc(sku.source?.sku||sku.sku)+'</small></td><td><input data-merge-code aria-label="合并SKU编码" maxlength="64" required value="'+esc(row.sku)+'"></td><td><input data-merge-value aria-label="合并规格值" maxlength="100" required value="'+esc(row.value)+'"></td><td>成本 ¥'+esc(sku.cost)+'<small>售价 ¥'+esc(sku.price)+' · 库存 '+esc(sku.stock)+'</small></td></tr>';}).join('');$('#mergeDialog').showModal();}catch(error){toast(error.message,{error:true});}};
$('#closeMerge').onclick=()=>$('#mergeDialog').close();
$('#mergeForm').addEventListener('input',invalidateMerge);$('#mergeForm').addEventListener('change',invalidateMerge);
$('#mergeMain').addEventListener('change',()=>{$('#mergeTitle').value=mergingProducts.find(p=>p.id===$('#mergeMain').value)?.title||'';});
$('#previewMerge').onclick=async()=>{const button=$('#previewMerge');button.disabled=true;clearDialogFeedback($('#mergeDialog'));try{const input=readMergeInput(),key=JSON.stringify(input),result=await api('/api/products/merge-preview','POST',input);if(key!==JSON.stringify(readMergeInput()))return;mergePreviewKey=key;$('#mergePreview').innerHTML='<h3>合并预览：'+esc(result.product.title)+'</h3><p>'+result.product.skus.length+'个SKU · '+result.product.images.length+'张主图 · '+result.product.detail_images.length+'张详情图</p><p>'+esc(result.product.skus.map(s=>s.spec+'（'+s.sku+'）').join('；'))+'</p>'+result.warnings.map(text=>'<p class="notice">'+esc(text)+'</p>').join('');$('#confirmMerge').disabled=false;}catch(error){invalidateMerge();toast(error.message,{error:true});}finally{button.disabled=false;}};
$('#mergeForm').onsubmit=async event=>{event.preventDefault();const button=event.submitter;button.disabled=true;clearDialogFeedback($('#mergeDialog'));try{if(!mergePending){const input=readMergeInput();if(JSON.stringify(input)!==mergePreviewKey)throw Error('请先预览当前合并设置');mergePending={...input,request_id:mergeRequestId};}lockMergeFields(true);const result=await api('/api/products/merge','POST',mergePending);mergePending=null;mergeSelected.clear();$('#mergeDialog').close();await load();const product=state.products.find(p=>p.id===result.id);if(product)edit(product);toast(result.reused?'已找到同一次合并生成的商品，请核对':'已生成待整理商品，请核对全部规格、详情和商城映射后重新审核');}catch(error){if(!mergePending||error.httpStatus&&error.httpStatus<500){mergePending=null;lockMergeFields(false);invalidateMerge();toast(error.message,{error:true});}else{button.textContent='重试确认同一次合并';toast('合并结果未确认。可点击下方按钮核对同一请求，不会再次生成。'+error.message,{error:true});}}finally{button.disabled=!mergePending&&!mergePreviewKey;}};
$('#newButton').onclick=()=>edit();$('#closeEditor').onclick=()=>$('#editor').close();$('#addSku').onclick=()=>skuRow();
$('#detailImagesFile').onchange=async e=>{
 try{const file=e.target.files[0];if(!file)return;if(file.size>2*1024*1024)throw Error('采集文件请小于 2 MB');const images=detailImagesFromJSON($('#productForm').elements.source_url.value,JSON.parse(await file.text()));$('#productForm').elements.detail_images.value=images.join('\n');renderImageGallery('detail_images');toast(`已填入 ${images.length} 张详情图，请检查后保存商品`);}catch(e){toast(e.message);}finally{e.target.value='';}
};
$('#copyDetailHTML').onclick=async()=>{
 try{const f=$('#productForm');const html=detailHTML(descriptionWithAttributes(f.elements.description.value,readProductAttributes()),f.elements.detail_images.value.split('\n').map(x=>x.trim()).filter(Boolean));await navigator.clipboard.writeText(html);toast('详情 HTML 已复制，可粘贴到商城商品详情的源码编辑框后保存');}catch(e){toast(e.message||'复制失败，请检查浏览器剪贴板权限');}
};
$('#skuImagesFile').onchange=async e=>{
 try{
  const file=e.target.files[0];if(!file)return;if(file.size>2*1024*1024)throw Error('配图文件请小于 2 MB');
  const data=JSON.parse(await file.text());if(data.products?.length!==1)throw Error('请选择只含当前商品的采集 JSON');
  const rows=[...$('#skuRows').children],updates=matchSkuImages($('#productForm').elements.source_url.value,rows.map(r=>r.querySelector('[data-key="sku"]').value),data.products[0]);
  const map=new Map(updates.map(x=>[x.sku,x.image]));
  for(const row of rows){const url=map.get(row.querySelector('[data-key="sku"]').value);if(!url)continue;const input=row.querySelector('[data-key="image"]');input.value=url;input.dispatchEvent(new Event('input'));}
  toast(`已匹配 ${updates.length} 个规格图片，价格库存保持不变；检查后保存商品`);
 }catch(e){toast(e.message);}finally{e.target.value='';}
};
$('#batchPriceMode').onchange=()=>{
 const mode=$('#batchPriceMode').value;
 $('#batchPriceLabel').textContent=mode==='percent'?'加价比例 %':mode==='add'?'每件加价 ¥':'统一售价 ¥';
 $('#batchPriceHint').textContent=mode==='percent'?'售价 = 每个规格成本 ×（1 + 比例 ÷ 100），结果四舍五入到分。':'应用会更新下方全部规格的售价；点击「保存商品」后才会保存。';
};
$('#applyBatchStock').onclick=()=>{
 try{
  const raw=$('#batchStockValue').value.trim(),value=Number(raw);
  if(!raw||!Number.isSafeInteger(value)||value<0||value>2147483647)throw Error('库存请填写 0–2147483647 的整数');
  const inputs=[...$('#skuRows').querySelectorAll('input[data-key="stock"]')];
  if(!inputs.length)throw Error('请先添加 SKU 规格');
  if($('#catalogTarget').value==='tigshop'&&value*inputs.length>2147483647)throw Error('Tigshop 全部规格的总库存超出上限');
  inputs.forEach(input=>{input.value=String(value);});
  toast(`已将 ${inputs.length} 个规格的库存分别设为 ${value}，请检查后保存商品`);
 }catch(e){toast(e.message);}
};
$('#applyBatchPrice').onclick=()=>{
 try{
  const rows=[...$('#skuRows').children];
  const prices=batchPrices(rows.map(row=>row.querySelector('[data-key="cost"]').value),$('#batchPriceMode').value,$('#batchPriceValue').value);
  rows.forEach((row,i)=>{row.querySelector('[data-key="price"]').value=prices[i];});
  toast(`已设置 ${prices.length} 个规格的售价，请检查后保存商品`);
 }catch(e){toast(e.message);}
};
$('#productRows').onclick=async e=>{const b=e.target.closest('button');if(!b)return;try{if(b.dataset.publications)showPublicationDetails(state.products.find(p=>p.id===b.dataset.publications));if(b.dataset.edit)edit(state.products.find(p=>p.id===b.dataset.edit));if(b.dataset.approve){const p=state.products.find(p=>p.id===b.dataset.approve);if(!confirm('确认图片、分类、所有规格与售价无误，将当前版本标记为审核通过？'))return;await api('/api/products/'+p.id+'/approve','POST',{revision:p.revision});await load();toast('审核通过，可以创建发布任务');}if(b.dataset.publish){await loadImageStorageAvailability();openPublish(state.products.find(p=>p.id===b.dataset.publish));}}catch(e){toast(e.message);}};
$('#productForm').onsubmit=async e=>{e.preventDefault();const b=e.submitter;b.disabled=true;try{const f=e.target,p={};if(editorImageBusy)throw Error('图片仍在上传，请等待完成后保存商品');for(const k of ['source_url','title','description'])p[k]=f.elements[k].value;p.attributes=readProductAttributes();const tags=f.elements.tag_ids.value.trim();p.tag_ids=tags?tags.split(/[,，\s]+/).map(Number):[];p.catalog_target=f.elements.catalog_target.value;p.catalog_connection_id=$('#catalogMall').value;if(p.catalog_target==='crmeb-store')p.applicable_type=Number(f.elements.applicable_type.value);p.category_id=Number(f.elements.category_id.value);p.category=catalog?.categories.find(x=>x.id===p.category_id)?.label||'';const brandId=Number(f.elements.brand_id.value);const brand=catalog?.brands.find(x=>x.id===brandId);if(brandId&&!brand&&brandId!==editingMappings.get(activeMappingId)?.brand_ids?.at(-1))throw Error('请刷新后选择有效商城品牌');p.brand_ids=brand?.ids||editingMappings.get(activeMappingId)?.brand_ids||[];rememberMapping();p.mall_mappings=[...editingMappings.values()];p.virtual_sales=Number(f.elements.virtual_sales.value);p.detail_images=f.elements.detail_images.value.split('\n').map(x=>x.trim()).filter(Boolean);p.images=f.elements.images.value.split('\n').map(x=>x.trim()).filter(Boolean);const pendingNames=$('#specNames').value.split(/[,，]/).map(v=>v.trim()).filter(Boolean);if(JSON.stringify(pendingNames)!==JSON.stringify(editingSpecNames))throw Error('请先点击应用规格列，再保存商品');p.skus=readSkuRows();if(editingSpecNames.length)p.spec_names=[...editingSpecNames];specificationMatrix(p);if(editing){p.revision=editing.revision;if(editing.sourcing)p.sourcing=editing.sourcing;}await api(editing?'/api/products/'+editing.id:'/api/products',editing?'PUT':'POST',p);$('#editor').close();await load();toast('商品已保存为待整理');}catch(e){toast(e.message);}finally{b.disabled=editorImageBusy>0;}};
$('#importButton').onclick=()=>{$('#importResult').textContent='';$('#importDialog').showModal();};$('#closeImport').onclick=()=>$('#importDialog').close();$('#importFile').onchange=async e=>{const file=e.target.files[0];if(file){if(file.size>2*1024*1024)return toast('文件请小于 2 MB');$('#importText').value=await file.text();}};
$('#importForm').onsubmit=async e=>{e.preventDefault();const b=e.submitter;b.disabled=true;try{const r=await api('/api/import','POST',(/^[\s\uFEFF]*[\[{]/.test($('#importText').value)?JSON.parse($('#importText').value.replace(/^\uFEFF/,'')):{table:$('#importText').value}));$('#importResult').textContent=r.results.map(x=>`第 ${x.index+1} 件：${x.ok?'导入成功':x.error}`).join('\n');await load();toast(`成功导入 ${r.results.filter(x=>x.ok).length} 件商品`);}catch(e){toast(e.message);}finally{b.disabled=false;}};
$('#closePublish').onclick=()=>$('#publishDialog').close();
function openPublish(product){
 publishing=product;publishResults=new Map();publishUncertain=false;$('#publishTitle').textContent=product.title;$('#publishResults').replaceChildren();$('#publishSubmit').disabled=false;$('#publishSubmit').textContent='提交所选商城任务';
 const mappings=productMallMappings(product),rows=mallRows().filter(m=>m.configured);
 const available=new Set(imageStorageAvailability.filter(x=>x.available).map(x=>x.id));
 $('#publishTargets').innerHTML=rows.map(m=>{const mapping=mappings.find(x=>x.catalog_connection_id===m.id&&x.catalog_target===m.type),record=product.publications?.find(x=>x.mall_connection_id===m.id||!x.mall_connection_id&&x.target===m.type&&m.legacy),legacy=product.mall_mappings===undefined&&!product.category_id,ready=!!mapping?.category_id||legacy,locked=!!record&&!(record.status==='failed'&&record.can_republish===true),reason=locked?'已有'+(labels[record.status]||'发布')+'任务，请在任务列表核对或重试':ready?(mapping?.category||product.category||'兼容旧分类'):'尚未设置分类，请编辑商品';
 return '<div class="publish-choice"><input data-publish-mall type="checkbox" value="'+esc(m.id)+'" '+(ready&&!locked?'checked':'disabled')+'><span><strong>'+esc(m.name)+'</strong><small>'+esc(m.system+' · '+reason)+'</small><label class="image-transfer-choice"><input data-import-images="'+esc(m.id)+'" type="checkbox" '+(available.has(m.id)&&ready&&!locked?'':'disabled')+'>转存图片到OPS存储'+(available.has(m.id)?'（默认关闭）':'（未配置或域名未授权）')+'</label></span></div>';}).join('')||'<p class="hint">请先配置商城连接。</p>';
 $('#publishDialog').showModal();
}
$('#publishTargets').onchange=()=>{clearDialogFeedback($('#publishDialog'));$('#publishSubmit').disabled=publishUncertain||!$('#publishTargets').querySelectorAll('input[data-publish-mall]:checked:not(:disabled)').length;};
$('#publishForm').onsubmit=async event=>{
 event.preventDefault();const button=event.submitter;button.disabled=true;clearDialogFeedback($('#publishDialog'));let uncertain=false;
 try{const checked=[...$('#publishTargets').querySelectorAll('input[data-publish-mall]:checked:not(:disabled)')];if(!checked.length)throw Error('请至少选择一个已设置分类的商城');
 const destinations=checked.map(input=>({connection_id:input.value,target:mallFor(input.value)?.type,import_images:!![...$('#publishTargets').querySelectorAll('[data-import-images]')].find(x=>x.dataset.importImages===input.value)?.checked}));
 let result;try{result=await api('/api/products/'+publishing.id+'/publish','POST',{revision:publishing.revision,destinations});}catch(error){if(error.httpStatus&&error.httpStatus<500)throw error;uncertain=true;throw Error('提交结果未确认，请先刷新发布任务列表核对，避免重复提交。'+error.message);}
 if(!Array.isArray(result.results)||result.results.length!==destinations.length||new Set(result.results.map(r=>r.connection_id)).size!==destinations.length||result.results.some(r=>!destinations.some(d=>d.connection_id===r.connection_id)||typeof r.ok!=='boolean')){uncertain=true;throw Error('提交回执不完整，请先核对发布任务列表，未自动重试。');}
 for(const row of result.results){publishResults.set(row.connection_id,row);if(row.ok){const input=[...$('#publishTargets').querySelectorAll('input')].find(x=>x.value===row.connection_id);if(input){input.checked=false;input.disabled=true;}const transfer=[...$('#publishTargets').querySelectorAll('[data-import-images]')].find(x=>x.dataset.importImages===row.connection_id);if(transfer)transfer.disabled=true;}}
 $('#publishResults').innerHTML=[...publishResults.values()].map(row=>'<p class="dialog-feedback '+(row.ok?'':'is-error')+'"><strong>'+esc(mallFor(row.connection_id)?.name||row.target)+'</strong> · '+esc(row.ok?'任务已创建，请在发布任务查看执行结果':row.error)+'</p>').join('');
 button.textContent=[...publishResults.values()].some(r=>!r.ok)?'重试未提交商城':'提交所选商城任务';await load();
 }catch(error){toast(error.message,{error:true});}finally{publishUncertain=uncertain;button.disabled=uncertain||!$('#publishTargets').querySelectorAll('input[data-publish-mall]:checked:not(:disabled)').length;}
};
$('#refresh').onclick=()=>load().catch(e=>toast(e.message));$('#logout').onclick=async()=>{try{await api('/auth/logout','POST',{});location.reload();}catch(e){toast(e.message);}};
async function init(){try{me=await api('/api/me');applyBranding(me.branding);$('#systemSettingsNav').classList.toggle('hidden',!me.systemAdmin);$('#systemVersion').textContent=me.system?`系统 v${me.system.version} · ${me.system.build}`:'系统版本未知';$('#mode').textContent=me.demo?'本地演示 · 不执行发布':'内部运营空间';if(!me.user){$('#login').classList.remove('hidden');$('#loginHint').textContent=me.demo?'演示模式仅限本机，所有数据保存在本机数据库。':me.authReady?'使用你的统一账号继续。':'服务已启动，等待管理员配置 Casdoor 应用和账号允许名单。';return;}$('#username').textContent=me.user.name;$('#logout').classList.remove('hidden');$('#workspace').classList.remove('hidden');await load();setInterval(()=>{if(['products','jobs'].includes(page)&&!document.querySelector('dialog[open]'))load().catch(()=>{});},10000);}catch(e){toast(e.message);}}
init();

$('#jobRows').onclick=async e=>{const b=e.target.closest('button');if(!b)return;try{if(b.dataset.recoverYunzhong){const r=await api('/api/jobs/'+b.dataset.recoverYunzhong+'/recover-uncreated','POST',{});toast(r.message);}if(b.dataset.recoverStock){const r=await api('/api/jobs/'+b.dataset.recoverStock+'/recover-zero-stock','POST',{});toast(r.message);}if(b.dataset.verify){const id=prompt('从商城仓库找到任务编码对应的商品，输入数字商品 ID。此操作只读取详情核对，不会再次创建商品。');if(id===null)return;await api('/api/jobs/'+b.dataset.verify+'/verify','POST',{remote_id:id.trim()});toast('核对请求已提交，请等待结果');}if(b.dataset.retry){if(!confirm('仅重发尚未领取创建操作的任务；已领取的创建操作不会被重复执行。继续？'))return;await api('/api/jobs/'+b.dataset.retry+'/retry','POST',{});toast('已重发同一任务');}await load();}catch(e){toast(e.message);}};

let tigshopConnection=null,tigshopFX=null;
async function loadTigshopConnection(){
 tigshopConnection=await api('/api/connections/tigshop');$('#tigshopUrl').value=tigshopConnection.url;
 recordConnectionPart('tigshop','auth',tigshopConnection);
 $('#tigshopToken').placeholder=tigshopConnection.configured?'已保存 Token；留空保留，输入新值可更换':'填写 API Token';
 $('#tigshopConnectionStatus').textContent=tigshopConnection.configured?'已保存 API Token · 最近连接检查 '+date(tigshopConnection.testedAt):'请填写 API Token，然后测试连接。';
 if(tigshopConnection.templateId&&!$('#tigshopTemplate').querySelector('option[value="'+tigshopConnection.templateId+'"]'))$('#tigshopTemplate').innerHTML=`<option value="${tigshopConnection.templateId}">已保存模板 ${tigshopConnection.templateId}（测试连接可读取名称）</option>`;
 if(tigshopConnection.templateId)$('#tigshopTemplate').value=String(tigshopConnection.templateId);
}
function tigshopBusy(busy){for(const id of ['testTigshop','saveTigshop','tigshopToken','tigshopTemplate','tigshopUrl'])$('#'+id).disabled=busy;}
$('#testTigshop').onclick=async()=>{
 tigshopBusy(true);$('#tigshopConnectionStatus').textContent='正在检查 Token、分类、品牌及运费模板…';
 try{
  const result=await api('/api/connections/tigshop/test','POST',{url:$('#tigshopUrl').value.trim(),token:$('#tigshopToken').value.trim()});
  const current=Number($('#tigshopTemplate').value)||tigshopConnection?.templateId||0;
  $('#tigshopTemplate').innerHTML='<option value="0">请选择运费模板</option>'+result.templates.map(t=>`<option value="${t.id}">${esc(t.name)}（${t.id}）${t.isDefault?' · 商城默认':''}</option>`).join('');
  const selected=result.templates.some(t=>t.id===current)?current:result.templates.find(t=>t.isDefault)?.id||0;$('#tigshopTemplate').value=String(selected);
  $('#tigshopConnectionStatus').textContent=`连接成功：${result.categories} 个分类、${result.brands} 个品牌。请选择模板并保存。`;
 }catch(e){$('#tigshopConnectionStatus').textContent=e.message;}finally{tigshopBusy(false);}
};
$('#tigshopConnectionForm').onsubmit=async e=>{
 e.preventDefault();tigshopBusy(true);
 try{await api('/api/connections/tigshop','POST',{url:$('#tigshopUrl').value.trim(),token:$('#tigshopToken').value.trim(),templateId:Number($('#tigshopTemplate').value)});$('#tigshopToken').value='';await loadTigshopConnection();await load();toast('Tigshop 连接已保存');}
 catch(e){$('#tigshopConnectionStatus').textContent=e.message;}finally{tigshopBusy(false);}
};
function previewTigshopEUR(){const amount=Number($('#tigshopCnyPreview').value);$('#tigshopEurPreview').textContent=tigshopFX&&Number.isFinite(amount)&&amount>=0?`约 €${(Math.round((amount*tigshopFX.eurPerCny+Number.EPSILON)*100)/100).toFixed(2)}`:'';}
$('#tigshopCnyPreview').oninput=previewTigshopEUR;
$('#refreshTigshopFX').onclick=async()=>{
 $('#refreshTigshopFX').disabled=true;$('#tigshopFXStatus').textContent='正在读取欧洲央行最新参考报价…';
 try{tigshopFX=await api('/api/connections/tigshop/fx');$('#tigshopFXStatus').textContent=`1 欧元 = ${tigshopFX.cnyPerEur} 人民币 · 报价日期 ${tigshopFX.rateDate}。这是每日参考报价，非实时成交价。`;previewTigshopEUR();}
 catch(e){tigshopFX=null;previewTigshopEUR();$('#tigshopFXStatus').textContent=e.message;}finally{$('#refreshTigshopFX').disabled=false;}
};

async function loadCrmebAuthConnections(targets=['crmeb-pro','crmeb-store']){
 await Promise.all(targets.map(async target=>{
  try{const c=await api('/api/connections/'+target+'/auth');recordConnectionPart(target,'auth',c);$('#'+target+'-appsecret').placeholder=c.configured?'已保存 AppSecret；留空保留，输入新值可更换':'填写 AppSecret';$('#'+target+'-appid').value=c.appid;document.querySelector('[data-mall-url="'+target+'"]').value=c.url;document.querySelector('[data-mall-shipping="'+target+'"]').value=c.shippingTemplateId||'';const mall=mallFor(selectedMalls[target],target);document.querySelector('[data-mall-url="'+target+'"]').readOnly=!!mall?.legacy;document.querySelector('[data-mall-shipping="'+target+'"]').closest('label').classList.toggle('hidden',!!mall?.legacy);$('#'+target+'-brand-status').textContent=c.configured?'商城发布凭证已保存'+(c.testedAt?' · '+date(c.testedAt):''):'请填写此商城的 AppID 和 AppSecret，发布时由 OPS 统一获取授权。';}
  catch(e){$('#'+target+'-brand-status').textContent=e.message;recordConnectionPart(target,'auth',{error:true});}
 }));
}
async function saveCrmebAuthConnection(target,testOnly){
 const form=document.querySelector('[data-crmeb-auth="'+target+'"]');
 form.querySelectorAll('input,button').forEach(x=>x.disabled=true);
 $('#'+target+'-brand-status').textContent='正在验证商城授权…';
 try{
  const r=await api('/api/connections/'+target+'/auth'+(testOnly?'/test':''),'POST',{url:document.querySelector('[data-mall-url="'+target+'"]').value.trim(),shippingTemplateId:Number(document.querySelector('[data-mall-shipping="'+target+'"]').value),appid:$('#'+target+'-appid').value.trim(),appsecret:$('#'+target+'-appsecret').value});
  if(!testOnly){$('#'+target+'-appsecret').value='';await load();await loadCrmebAuthConnections([target]);await loadCrmebPublishConnections([target]);}
  $('#'+target+'-brand-status').textContent=r.message+(testOnly?'。请点击保存连接。':'');
 }catch(e){$('#'+target+'-brand-status').textContent=e.message;}finally{form.querySelectorAll('input,button').forEach(x=>x.disabled=false);}
}
for(const form of document.querySelectorAll('[data-crmeb-auth]'))form.onsubmit=e=>{e.preventDefault();saveCrmebAuthConnection(form.dataset.crmebAuth,false);};
for(const button of document.querySelectorAll('[data-test-auth]'))button.onclick=()=>saveCrmebAuthConnection(button.dataset.testAuth,true);

async function loadCrmebPublishConnections(targets=['crmeb-pro','crmeb-store']){
 await Promise.all(targets.map(async target=>{
  const mall=mallFor(selectedMalls[target],target),advanced=document.querySelector('[data-crmeb-publishing="'+target+'"]').closest('details');advanced.classList.toggle('hidden',!mall?.legacy);
  if(mall&&!mall.legacy){recordConnectionPart(target,'publishing',{configured:mall.configured});$('#'+target+'-connection-summary').textContent=mall.configured?'独立商城连接已配置，使用 OPS 直连下架入库':'请填写该商城地址、授权及真实运费模板 ID';return;}
  try{const c=await api('/api/connections/'+target+'/publishing');recordConnectionPart(target,'publishing',c);$('#'+target+'-publish-token').placeholder=c.configured?'已配置密钥；留空保留，输入新值可更换':'填写 Webhook 密钥';$('#'+target+'-publish-url').value=c.url;$('#'+target+'-publish-status').textContent=c.configured?`已配置发布连接（${c.source==='page'?'页面保存':'原服务器配置'}），密钥不回显。可测试入口或填写新密钥后保存。`:'请填写生产 Webhook 地址和密钥。';}
  catch(e){$('#'+target+'-publish-status').textContent=e.message;recordConnectionPart(target,'publishing',{error:true});}
 }));
}
async function saveCrmebPublishing(target,testOnly){
 const form=document.querySelector('[data-crmeb-publishing="'+target+'"]');form.querySelectorAll('input,button').forEach(x=>x.disabled=true);
 $('#'+target+'-publish-status').textContent=testOnly?'正在测试入口鉴权…':'正在保存发布配置…';
 try{
  const r=await api('/api/connections/'+target+'/publishing'+(testOnly?'/test':''),'POST',{url:$('#'+target+'-publish-url').value.trim(),token:$('#'+target+'-publish-token').value.trim()});
  $('#'+target+'-publish-status').textContent=(r.httpStatus?'HTTP '+r.httpStatus+' · ':'')+r.message+(testOnly&&r.ok?' 点击「保存发布连接」后才会生效。':'');
  if(!testOnly){$('#'+target+'-publish-token').value='';await loadCrmebPublishConnections([target]);await load();$('#'+target+'-publish-status').textContent=r.message;toast('发布通道已保存');}
 }catch(e){$('#'+target+'-publish-status').textContent=e.message;}finally{form.querySelectorAll('input,button').forEach(x=>x.disabled=false);}
}
for(const form of document.querySelectorAll('[data-crmeb-publishing]'))form.onsubmit=e=>{e.preventDefault();saveCrmebPublishing(form.dataset.crmebPublishing,false);};
for(const button of document.querySelectorAll('[data-test-publishing]'))button.onclick=()=>saveCrmebPublishing(button.dataset.testPublishing,true);

let teamState=null;
async function loadTeam(){
 teamState=await api('/api/team');const t=teamState.team;
 $('#teamTitle').textContent=t?t.name:'创建团队工作区';
 $('#teamStatus').textContent=t?'当前角色：'+({admin:'管理员',reviewer:'审核员',editor:'编辑'}[t.role])+' · 商品和任务由团队共享。':'当前为个人工作区。创建团队后，可添加同事共同维护商品。';
 $('#createTeamForm').classList.toggle('hidden',!!t);$('#teamMemberForm').classList.toggle('hidden',!t||t.role!=='admin');
 $('#teamMembers').innerHTML=teamState.members.map(m=>`<p><code>${esc(m.sub)}</code> · ${esc({admin:'管理员',reviewer:'审核员',editor:'编辑'}[m.role])} · ${m.active?'已启用':'已停用'}${t.role==='admin'?` <button class="text" data-member-sub="${esc(m.sub)}" data-member-role="${esc(m.role)}">修改角色</button><button class="text" data-toggle-member="${esc(m.sub)}" data-member-role="${esc(m.role)}" data-member-active="${m.active?0:1}">${m.active?'停用':'启用'}</button>`:''}</p>`).join('');
 $('#teamEvents').innerHTML=teamState.events.map(e=>`<p><small>${date(e.created)} · ${esc(e.actor)}</small>${esc(({ 'product.create':'添加商品','product.edit':'编辑商品','product.approve':'审核商品','job.create':'创建发布任务','job.claim_create':'领取发布操作','job.succeeded':'发布核对成功','job.unknown':'任务需核对','job.verify_requested':'请求核对商品','job.retry_unclaimed':'重发未领取任务','team.created':'创建团队','team.member_updated':'修改团队成员'})[e.action]||e.action)} · ${esc(e.object_id)}</p>`).join('')||'<p class="hint">暂无团队操作记录。</p>';
}
$('#createTeamForm').onsubmit=async e=>{
 e.preventDefault();const button=e.submitter;button.disabled=true;
 try{await api('/api/team','POST',{name:$('#teamName').value.trim()});await load();await loadTeam();toast('团队已创建，你的商品和任务已并入共享工作区');}catch(e){toast(e.message);}finally{button.disabled=false;}
};
$('#teamMemberForm').onsubmit=async e=>{
 e.preventDefault();const button=e.submitter;button.disabled=true;
 try{await api('/api/team/members','POST',{sub:$('#teamMemberSub').value.trim(),role:$('#teamMemberRole').value,active:1});await loadTeam();toast('成员已保存，可使用自己的 Casdoor 账号登录');}catch(e){toast(e.message);}finally{button.disabled=false;}
};
$('#teamMembers').onclick=async e=>{
 const b=e.target.closest('button');if(!b)return;
 if(b.dataset.memberSub){$('#teamMemberSub').value=b.dataset.memberSub;$('#teamMemberRole').value=b.dataset.memberRole;return;}
 if(b.dataset.toggleMember){try{await api('/api/team/members','POST',{sub:b.dataset.toggleMember,role:b.dataset.memberRole,active:Number(b.dataset.memberActive)});await load();await loadTeam();}catch(e){toast(e.message);}}
};

async function loadCollectorDownload(){
 $('#collectorDownloadStatus').textContent='正在读取插件版本…';$('#refreshCollectorDownload').classList.add('hidden');
 try{
  const release=await api('/api/extensions/1688-collector');
  $('#collectorVersion').textContent='最新版 v'+release.version;
  detectCollectorVersion(release.version);
  $('#collectorDownload').classList.remove('hidden');
  $('#collectorDownloadStatus').textContent='当前版本 v'+release.version+' · '+Math.ceil(release.bytes/1024)+' KB · 适用于 Chrome / Edge';
 }catch(e){$('#collectorVersion').textContent='暂不可用';$('#collectorDownload').classList.add('hidden');$('#collectorDownloadStatus').textContent=e.message;$('#refreshCollectorDownload').classList.remove('hidden');}
}
let collectorProbe=()=>{};
function detectCollectorVersion(chromiumVersion){
 collectorProbe();
 const nonce=crypto.randomUUID(),node=$('#collectorInstalledStatus');
 node.textContent='正在检测此浏览器已安装的插件…';
 const received=event=>{
  if(event.source!==window||event.origin!==location.origin||event.data?.type!=='mainapis:collector:version'||event.data.nonce!==nonce)return;
  const {channel,version}=event.data;if(!['safari','chromium'].includes(channel))return;
  const latest=channel==='safari'?safariCollectorVersion:chromiumVersion;
  const compared=compareVersions(version,latest);if(compared===null)return;
  clearTimeout(timer);
  node.textContent=`已安装 ${channel==='safari'?'Safari':'Chrome / Edge'} v${version} · `+(compared<0?`发现新版 v${latest}，请${channel==='safari'?'通过 TestFlight / App Store 更新':'下载新版 ZIP，替换原插件目录后，在扩展管理页点击重新加载'}`:compared===0?'已是最新版本':'高于系统提供的版本');
  node.classList.toggle('collector-update-needed',compared<0);
 };
 window.addEventListener('message',received);
 const timer=setTimeout(()=>{node.textContent='未检测到版本响应：可能尚未安装、未启用、未允许访问 OPS，或仍使用不支持检测的旧版插件。旧版需先手动更新一次，再刷新本页。';$('#refreshCollectorDownload').classList.remove('hidden');},2000);
 collectorProbe=()=>{clearTimeout(timer);window.removeEventListener('message',received);node.classList.remove('collector-update-needed');};
 window.postMessage({type:'mainapis:collector:query',nonce},location.origin);
}
$('#refreshCollectorDownload').onclick=loadCollectorDownload;

let yunzhongAvailableVersion='';
async function loadYunzhongRelease(){
 try {
  const r=await api('/api/extensions/yunzhong-bridge');yunzhongAvailableVersion=r.version;
  $('#yunzhongRelease').textContent=`最新扩展 v${r.version} · ${Math.ceil(r.bytes/1024)} KB · SHA256：${r.sha256}`;
  const path='/tmp/mainapis-yunzhong-'+r.version,php='docker exec CONTAINER php '+path+'/';
  const unpack=`mkdir -p ${path}\ntar -xzf /tmp/${r.filename} -C ${path}\ndocker cp ${path} CONTAINER:${path}\n`;
  $('#yunzhongInstallCommands').textContent=unpack+php+'install.php --check SHOP_ROOT DOCUMENT_ROOT\n# 仅预检 ok:true 后执行：\n'+php+'install.php --install SHOP_ROOT DOCUMENT_ROOT\n# Swoole 环境：\n'+php+'install.php --adapt-swoole SHOP_ROOT DOCUMENT_ROOT\n# 成功后安排重载：\ndocker restart CONTAINER';
  $('#yunzhongUpdateCommands').textContent=unpack+php+'apply-update.php --check SHOP_ROOT\n# 仅检查 ok:true 后执行：\n'+php+'apply-update.php --apply SHOP_ROOT\n# 仅更新 ok:true 后重载：\ndocker restart CONTAINER';
 }catch(e){$('#yunzhongRelease').textContent='扩展下载信息读取失败：'+e.message;}
}
$('#yunzhongReleaseRefresh').onclick=async()=>{await loadYunzhongRelease();await loadYunzhongConnection();};
async function loadYunzhongConnection(){
 try{await loadYunzhongRelease();const c=await api('/api/connections/yunzhong');$('#yunzhongInstalledVersion').textContent=c.mode==='bridge'&&c.testedAt?'远端扩展（最近测试）：'+(c.bridgeVersion?'v'+c.bridgeVersion:'版本未知，请重新测试并保存')+' · '+c.testedAt+(c.bridgeVersion&&yunzhongAvailableVersion&&c.bridgeVersion!==yunzhongAvailableVersion?' · 与下载版本不同，请测试连接并核对更新说明':''):'远端版本：尚未验证独立入口；请测试连接并保存';$('#yunzhongUrl').value=c.url;$('#yunzhongSiteLabel').textContent=c.url+' · '+c.version;$('#yunzhongAppid').value=c.appid;$('#yunzhongMode').value=c.mode||'official';updateYunzhongMode();$('#yunzhongCategoryLevel').value=c.categoryLevel||'';$('#yunzhongDispatchPrice').value=c.dispatchPrice||'';$('#yunzhongSecret').placeholder=c.configured?'已保存，留空保留原密钥':'填写 API 应用 APP_Secret';const status=yunzhongConfiguration(c);$('#yunzhongBadge').textContent=status.label;$('#yunzhongCard').dataset.state=status.state;$('#yunzhongDetails').open=!c.configured;$('#yunzhongStatus').textContent=status.detail;}catch(error){$('#yunzhongBadge').textContent='读取失败';$('#yunzhongStatus').textContent=error.message;}
}
async function saveYunzhongConnection(testOnly){
 const form=$('#yunzhongForm');form.querySelectorAll('input,select,button').forEach(node=>node.disabled=true);$('#yunzhongStatus').textContent='正在测试签名并读取分类…';
 try{const result=await api('/api/connections/yunzhong'+(testOnly?'/test':''),'POST',{url:$('#yunzhongUrl').value.trim(),mode:$('#yunzhongMode').value,appid:$('#yunzhongAppid').value.trim(),appsecret:$('#yunzhongSecret').value,dispatchPrice:$('#yunzhongDispatchPrice').value.trim(),categoryLevel:Number($('#yunzhongCategoryLevel').value)});if(!testOnly){$('#yunzhongSecret').value='';await loadYunzhongConnection();}$('#yunzhongStatus').textContent=result.message;$('#yunzhongCategories').replaceChildren(...result.categories.map(row=>{const li=document.createElement('li');li.textContent=row.label+'（'+row.id+'）';return li;}));}catch(error){$('#yunzhongStatus').textContent=error.message;}finally{form.querySelectorAll('input,select,button').forEach(node=>node.disabled=false);}
}
$('#yunzhongForm').onsubmit=event=>{event.preventDefault();saveYunzhongConnection(false);};
$('#yunzhongTest').onclick=()=>saveYunzhongConnection(true);

function updateYunzhongMode(){$('#yunzhongCategoryModeField').classList.toggle('hidden',$('#yunzhongMode').value==='bridge');}
$('#yunzhongMode').onchange=updateYunzhongMode;

$('#collectionScope').onchange=async()=>{mergeSelected.clear();productPage=1;try{await load();}catch(e){toast(e.message);}};
$('#productPrev').onclick=()=>{productPage--;render();$('#products').scrollIntoView({block:'start'});};
$('#productNext').onclick=()=>{productPage++;render();$('#products').scrollIntoView({block:'start'});};
$('#productPageSize').onchange=()=>{productSize=Number($('#productPageSize').value);productPage=1;render();};
async function changeJobPage(next,size=jobSize){const previous=jobPageNumber,previousSize=jobSize;jobPageNumber=next;jobSize=size;try{await loadJobPage();render();$('#jobs').scrollIntoView({block:'start'});}catch(error){jobPageNumber=previous;jobSize=previousSize;$('#jobPageSize').value=String(previousSize);updateJobPager();toast(error.message);}}
for(const id of ['jobScope','jobMall','jobStatus'])$('#'+id).onchange=()=>changeJobPage(1);
$('#jobPrev').onclick=()=>changeJobPage(jobPageNumber-1);
$('#jobNext').onclick=()=>changeJobPage(jobPageNumber+1);
$('#jobPageSize').onchange=()=>changeJobPage(1,Number($('#jobPageSize').value));
const editorBody=$('#editor .form-body'),editorTop=$('#editorBackToTop');
function updateEditorTop(){editorTop.classList.toggle('hidden',editorBody.scrollTop<350);}
editorBody.addEventListener('scroll',updateEditorTop,{passive:true});
editorTop.onclick=()=>editorBody.scrollTo({top:0,behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
const backToTop=$('#backToTop');
function updateBackToTop(){backToTop.classList.toggle('hidden',window.scrollY<350);}
window.addEventListener('scroll',updateBackToTop,{passive:true});updateBackToTop();
backToTop.onclick=()=>window.scrollTo({top:0,behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});

async function loadShopxoConnection(){
 try{
  const c=await api('/api/connections/shopxo');$('#shopxoUrl').value=c.url;$('#shopxoAppid').value=c.appid;$('#shopxoSecret').placeholder=c.configured?'已保存，留空保留原密钥':'填写独立扩展生成的64位密钥';
  $('#shopxoWarehouse').replaceChildren(new Option(c.warehouseId?'已保存仓库 '+c.warehouseId:'请先测试连接',String(c.warehouseId||0)));
  $('#shopxoBadge').textContent=c.configured&&c.warehouseId?'已配置':'待配置';$('#shopxoCard').dataset.state=c.configured&&c.warehouseId?'configured':'unconfigured';$('#shopxoDetails').open=!c.configured;
  $('#shopxoStatus').textContent=c.testedAt?'最近测试 '+c.testedAt+' · 扩展 '+(c.bridgeVersion||'未知'):'请先安装商城独立扩展，再测试并保存连接';
  const release=await api('/api/extensions/shopxo-bridge');$('#shopxoRelease').textContent='扩展 v'+release.version+' · '+Math.ceil(release.bytes/1024)+' KB · SHA256：'+release.sha256;
 }catch(error){$('#shopxoStatus').textContent=error.message;$('#shopxoBadge').textContent='读取失败';}
}
async function saveShopxoConnection(testOnly){
 const form=$('#shopxoForm');form.querySelectorAll('input,select,button').forEach(node=>node.disabled=true);
 try{
  const r=await api('/api/connections/shopxo'+(testOnly?'/test':''),'POST',{url:$('#shopxoUrl').value.trim(),appid:$('#shopxoAppid').value.trim(),appsecret:$('#shopxoSecret').value.trim(),warehouseId:Number($('#shopxoWarehouse').value)});
  if(testOnly){const saved=$('#shopxoWarehouse').value;$('#shopxoWarehouse').replaceChildren(new Option('请选择实际仓库','0'),...r.warehouses.map(w=>new Option(w.name+'（'+w.id+'）',String(w.id))));if(r.warehouses.some(w=>String(w.id)===saved))$('#shopxoWarehouse').value=saved;}
  else{$('#shopxoSecret').value='';await load();await loadShopxoConnection();}
  $('#shopxoStatus').textContent=r.message;
 }catch(error){$('#shopxoStatus').textContent=error.message;}finally{form.querySelectorAll('input,select,button').forEach(node=>node.disabled=false);}
}
$('#shopxoTest').onclick=()=>saveShopxoConnection(true);
$('#shopxoForm').onsubmit=event=>{event.preventDefault();saveShopxoConnection(false);};

let bulkMappingContext=null,bulkMappingCatalog=null,bulkMappingRequest=0;
async function loadBulkMappingCatalog(){const request=++bulkMappingRequest;bulkMappingCatalog=null;$('#applyBulkMapping').disabled=true;$('#bulkMappingCategory').disabled=$('#bulkMappingBrand').disabled=true;$('#bulkMappingStatus').textContent='正在读取目标商城分类和品牌…';try{const mall=mallFor($('#bulkMappingMall').value),data=await api('/api/catalog/'+mall.type+'?connection_id='+encodeURIComponent(mall.id));if(request!==bulkMappingRequest)return;bulkMappingCatalog=data;$('#bulkMappingCategory').innerHTML='<option value="0">不修改分类</option>'+(data.categories||[]).map(c=>'<option value="'+c.id+'">'+esc(c.label)+'</option>').join('');$('#bulkMappingBrand').innerHTML='<option value="0">不修改品牌</option>'+(data.brands||[]).map(b=>'<option value="'+b.id+'">'+esc(b.label)+'</option>').join('');$('#bulkMappingCategory').disabled=!!data.categoryError;$('#bulkMappingBrand').disabled=!!data.brandError;$('#bulkMappingStatus').textContent=[data.categoryError,data.brandError,data.notice].filter(Boolean).join(' ')||'已读取，可选择分类、品牌之一或同时设置。';$('#applyBulkMapping').disabled=false;}catch(e){if(request===bulkMappingRequest)$('#bulkMappingStatus').textContent=e.message;}}
function openBulkMappings(context){if(!context.keys.length)return toast('请先勾选需要批量设置的商品');bulkMappingContext=context;$('#bulkMappingCount').textContent='应用到 '+context.keys.length+' 件'+(context.kind==='supplier'?'货盘商品（导入时保存）':'采集箱商品（修改后重新审核）');$('#bulkMappingMall').innerHTML=mallRows().filter(m=>m.configured).map(m=>'<option value="'+esc(m.id)+'">'+esc(m.name+' · '+m.system)+'</option>').join('');$('#bulkMappingMode').value='fill';$('#bulkMappingDialog').showModal();loadBulkMappingCatalog();}
$('#bulkMappingMall').onchange=()=>loadBulkMappingCatalog();
$('#closeBulkMapping').onclick=()=>{$('#bulkMappingDialog').close();bulkMappingRequest++;};
$('#bulkProductSettings').onclick=()=>openBulkMappings({kind:'products',keys:[...mergeSelected],products:state.products.filter(p=>mergeSelected.has(p.id)).map(p=>({id:p.id,revision:p.revision}))});
$('#bulkSupplierSettings').onclick=()=>{if(!supplierBatch||supplierBatch.plan)return supplierFeedback('已开始导入的批次不能修改设置，请创建新预览。',true);const cards=[...$('#supplierPreview').querySelectorAll('[data-supplier-index]')].filter(el=>el.querySelector('[data-confirm]').checked);openBulkMappings({kind:'supplier',keys:cards.map(el=>supplierBatch.products[Number(el.dataset.supplierIndex)].key),batchId:supplierBatch.id});};
$('#bulkMappingForm').onsubmit=async event=>{event.preventDefault();const button=$('#applyBulkMapping');button.disabled=true;try{if(!bulkMappingCatalog)throw Error('请先读取商城分类和品牌');const mall=mallFor($('#bulkMappingMall').value),category=(bulkMappingCatalog.categories||[]).find(c=>c.id===Number($('#bulkMappingCategory').value)),brand=(bulkMappingCatalog.brands||[]).find(b=>b.id===Number($('#bulkMappingBrand').value));if(!category&&!brand)throw Error('请至少选择分类或品牌之一');const mapping={catalog_connection_id:mall.id,catalog_target:mall.type,category_id:category?.id||0,category:category?.label||'',brand_ids:brand?.ids||[],tag_ids:[]},mode=$('#bulkMappingMode').value;
 if(bulkMappingContext.kind==='supplier'){if(supplierBatch.id!==bulkMappingContext.batchId||supplierBatch.plan)throw Error('货盘批次状态已变化，请重新选择');for(const key of bulkMappingContext.keys){const next=applyBulkMapping({mall_mappings:supplierDraftMappings.get(key)||[]},mapping,mode);supplierDraftMappings.set(key,next.mall_mappings);}for(const el of $('#supplierPreview').querySelectorAll('[data-supplier-index]')){const key=supplierBatch.products[Number(el.dataset.supplierIndex)].key;el.querySelector('.supplier-mapping-summary').textContent=(supplierDraftMappings.get(key)||[]).map(m=>(mallFor(m.catalog_connection_id)?.name||'商城')+'：'+(m.category||'未设分类')+' / 品牌ID '+(m.brand_ids?.join(',')||'未设')).join('；')||'尚未设置商城分类和品牌';}$('#bulkMappingDialog').close();supplierFeedback('已为 '+bulkMappingContext.keys.length+' 件货盘商品设置映射，点击导入后保存。');}
 else{const result=await api('/api/products/bulk-settings','POST',{products:bulkMappingContext.products,mapping,mode});await load();const failures=result.results.filter(r=>!r.ok);$('#bulkMappingStatus').textContent='成功 '+result.results.filter(r=>r.ok).length+' 件；失败 '+failures.length+' 件。'+failures.map(r=>r.error).join('；')+' 已修改商品需重新审核。';if(!failures.length){$('#bulkMappingDialog').close();toast('批量设置完成，已修改商品需重新审核');}else{bulkMappingContext.products=bulkMappingContext.products.filter(p=>failures.some(r=>r.id===p.id));bulkMappingContext.keys=bulkMappingContext.products.map(p=>p.id);}}
 }catch(e){$('#bulkMappingStatus').textContent=e.message;}finally{button.disabled=false;}};
let supplierBatch=null,supplierPoll=null,supplierDraftMappings=new Map();
function applySupplierStock(){
 if(!supplierBatch||supplierBatch.plan)return supplierFeedback('已开始导入的批次不能修改库存，请创建新预览。',true);
 const raw=$('#supplierBulkStock').value.trim(),stock=Number(raw);
 if(!raw||!Number.isSafeInteger(stock)||stock<0||stock>2147483647)return supplierFeedback('库存请填写 0–2147483647 的整数。',true);
 const all=$('#supplierStockScope').value==='all',overwrite=$('#supplierStockMode').value==='overwrite';
 const cards=[...$('#supplierPreview').querySelectorAll('[data-supplier-index]')].filter(card=>all||card.querySelector('[data-confirm]').checked);
 if(!cards.length)return supplierFeedback('请先勾选商品，或将应用范围切换为全部预览商品。',true);
 let count=0;
 for(const card of cards)for(const input of card.querySelectorAll('[data-stock]'))if(!input.disabled&&(overwrite||!input.value.trim())){input.value=String(stock);count++;}
 supplierFeedback('已为 '+cards.length+' 件商品中的 '+count+' 个SKU设置库存，每个SKU为 '+stock+'；请核对后导入。');
}
$('#applySupplierStock').onclick=applySupplierStock;
function supplierSkuRow(s={},locked=false){return '<div data-supplier-sku><label>条码 / SKU编码（可空）<input data-barcode value="'+esc(s.barcode??s.sku??'')+'" maxlength="100" '+(locked?'disabled':'')+' placeholder="空缺时生成内部编码"></label><label>规格<input data-spec value="'+esc(s.spec??'')+'" '+(locked?'disabled':'')+'></label><label>成本（元）<input data-cost type="number" min="0" step="0.01" value="'+esc(s.cost??'')+'" '+(locked?'disabled':'')+'></label><label>售价（元）<input data-price type="number" min="0.01" step="0.01" value="'+esc(s.price??'')+'" '+(locked?'disabled':'')+'></label><label>库存<input data-stock type="number" min="0" step="1" value="'+esc(s.stock??'')+'" '+(locked?'disabled':'')+'></label><button type="button" class="text" data-remove-supplier-sku '+(locked?'disabled':'')+'>删除SKU</button></div>';}
$('#supplierPreview').onclick=event=>{
 const button=event.target.closest('[data-add-supplier-sku],[data-remove-supplier-sku]');if(!button||button.disabled||supplierBatch?.plan)return;
 const card=button.closest('[data-supplier-index]'),rows=card.querySelector('.supplier-skus');
 if(button.hasAttribute('data-remove-supplier-sku')){if(rows.children.length<=1)return supplierFeedback('每件商品至少保留一个SKU。',true);button.closest('[data-supplier-sku]').remove();}
 else{if(rows.children.length>=50)return supplierFeedback('每件商品最多50个SKU。',true);const p=supplierBatch.products[Number(card.dataset.supplierIndex)];rows.insertAdjacentHTML('beforeend',supplierSkuRow({cost:p.cost??'',price:p.price??''}));rows.lastElementChild.querySelector('[data-spec]').focus();}
 card.querySelector('[data-confirm]').checked=false;supplierFeedback('SKU已调整，请重新核对条码、规格、价格和库存，并勾选确认。');
};
const supplierScroll=$('#supplierDialog'),supplierTop=$('#supplierBackToTop');
function updateSupplierTop(){supplierTop.classList.toggle('hidden',supplierScroll.scrollTop<350);}
supplierScroll.addEventListener('scroll',updateSupplierTop,{passive:true});
supplierTop.onclick=()=>supplierScroll.scrollTo({top:0,behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
function supplierRender(batch){clearTimeout(supplierPoll);if(supplierBatch?.id!==batch.id)supplierDraftMappings=new Map();supplierBatch=batch;$('#bulkSupplierSettings').disabled=!!batch.plan;for(const id of ['supplierBulkStock','supplierStockScope','supplierStockMode','applySupplierStock'])$('#'+id).disabled=!!batch.plan;$('#supplierStatus').classList.remove('is-error');$('#commitSupplier').textContent=batch.state==='processing'?'正在上传图片并导入…':batch.state==='done'?'导入完成':batch.state==='partial'?'重试失败商品':'导入已确认商品到采集箱';$('#parseSupplier').disabled=batch.state==='processing';sessionStorage.setItem('ops-supplier-batch',batch.id);const assets=new Map(batch.assets.map(a=>[a.id,a.url])),locked=!!batch.plan;$('#commitSupplier').disabled=batch.state==='processing'||batch.state==='done';$('#discardSupplier').disabled=batch.state==='processing';$('#supplierPreview').innerHTML=batch.products.map((p,i)=>{const plan=batch.plan?.find(x=>x.key===p.key),done=batch.results.find(x=>x.key===p.key),skus=plan?.skus||(p.barcodes.length?p.barcodes:['']).map(code=>({barcode:code,spec:p.barcodes.length>1?'':'默认',cost:p.cost??'',price:p.price??'',stock:''}));return '<article class="supplier-card" data-supplier-index="'+i+'"><label><input data-confirm type="checkbox" '+(plan?'checked':'')+' '+(locked?'disabled':'')+'>我已核对这件商品及SKU对应关系</label><div class="supplier-pictures">'+p.images.map(id=>'<img loading="lazy" src="'+esc(assets.get(id))+'" alt="原表嵌入图片">').join('')+'</div><label>商品名称<input data-title value="'+esc(plan?.title||p.title)+'" '+(locked?'disabled':'')+'></label><small>'+esc(p.category_hint+' · '+p.sheet+' 第'+p.row+'行')+'</small><p class="hint">'+esc(p.warnings.join('；'))+'</p><p>'+esc(p.attributes.map(a=>a.name+'：'+a.value).join('；'))+'</p><p class="supplier-mapping-summary">'+esc((plan?.mall_mappings||supplierDraftMappings.get(p.key)||[]).map(m=>(mallFor(m.catalog_connection_id)?.name||'商城')+'：'+(m.category||'未设分类')+' / 品牌ID '+(m.brand_ids?.join(',')||'未设')).join('；')||'尚未设置商城分类和品牌')+'</p><small>箱规：'+esc(p.packaging||'未提供')+'</small><div class="supplier-skus">'+skus.map(s=>supplierSkuRow(s,locked)).join('')+'</div><button type="button" class="text" data-add-supplier-sku '+(locked?'disabled':'')+'>＋新增SKU</button><small>原表条码参考：'+esc(p.barcodes.join('、')||'未提供')+'（不随增减修改）</small>'+(done?'<p class="hint">'+esc(done.ok?(done.duplicate?'已存在，跳过重复商品':'已导入为待整理商品'):done.error)+'</p>':'')+'</article>';}).join('');$('#supplierStatus').textContent='识别 '+batch.products.length+' 件商品 · '+({ready:'请逐件核对后勾选',processing:'正在上传图片并导入…',done:'本次导入完成',partial:'部分失败，点击导入按钮可重试原批次'}[batch.state]||'可重试原批次');if(batch.state==='processing'){clearTimeout(supplierPoll);supplierPoll=setTimeout(async()=>{try{supplierRender(await api('/api/supplier-imports/'+batch.id));if(supplierBatch.state!=='processing')await load();}catch(e){supplierFeedback('状态读取失败，可关闭后重新打开货盘查看；不要重复新建导入。'+e.message,true);}},1500);}}
$('#supplierImportButton').onclick=async()=>{$('#supplierDialog').showModal();updateSupplierTop();const id=sessionStorage.getItem('ops-supplier-batch');if(id&&!supplierBatch){try{supplierRender(await api('/api/supplier-imports/'+id));}catch{sessionStorage.removeItem('ops-supplier-batch');}}};
$('#closeSupplier').onclick=()=>$('#supplierDialog').close();
$('#supplierUploadForm').onsubmit=async e=>{e.preventDefault();if(supplierBatch?.state==='processing')return;const file=$('#supplierFile').files[0];if(!file)return;if(file.size>35*1024*1024)return toast('文件请小于35MB');$('#parseSupplier').disabled=true;$('#supplierStatus').textContent='正在上传和解析…';try{const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(Error('文件读取失败'));reader.readAsDataURL(file);});supplierRender(await api('/api/supplier-imports','POST',{supplier:$('#supplierName').value,filename:file.name,data}));}catch(e){$('#supplierStatus').textContent=e.message;}finally{$('#parseSupplier').disabled=supplierBatch?.state==='processing';}};
function supplierFeedback(message,error=false){const status=$('#supplierStatus');status.textContent=message;status.classList.toggle('is-error',error);}
function supplierSelectedItems(){
 const cards=[...$('#supplierPreview').querySelectorAll('[data-supplier-index]')].filter(el=>el.querySelector('[data-confirm]').checked);
 if(!cards.length)throw Error('请先勾选至少一件商品的“我已核对这件商品及SKU对应关系”。');
 return cards.map(el=>{
  const title=el.querySelector('[data-title]');
  const invalid=(input,message)=>{input.focus();input.scrollIntoView({block:'center'});throw Error(message);};
  if(!title.value.trim())invalid(title,'请填写已勾选商品的名称。');
  const seen=new Set(),codes=new Set();const rows=[...el.querySelectorAll('[data-supplier-sku]')];if(!rows.length||rows.length>50)throw Error('每件商品需保留1至50个SKU。');const skus=rows.map((row,index)=>{
   const barcodeInput=row.querySelector('[data-barcode]'),barcode=barcodeInput?.value.trim()||'';if(barcode&&(!/^[A-Za-z0-9._-]{1,100}$/.test(barcode)||codes.has(barcode)))invalid(barcodeInput,'条码或SKU编码格式不正确，或与本商品其他SKU重复。');if(barcode)codes.add(barcode);const values={barcode};for(const k of ['spec','cost','price','stock']){const input=row.querySelector('[data-'+k+']'),value=input.value.trim(),number=Number(value);if(!value)invalid(input,'“'+title.value+'”第'+(index+1)+'个SKU的'+({spec:'规格',cost:'成本',price:'售价',stock:'库存'}[k])+'尚未填写。');if(k==='spec'){if(seen.has(value))invalid(input,'同一商品的规格不能重复，请核对规格与条码。');seen.add(value);}else if(!Number.isFinite(number)||number<0||k==='price'&&number<=0||k==='stock'&&!Number.isSafeInteger(number))invalid(input,'“'+title.value+'”的'+({cost:'成本应为非负数',price:'售价必须大于0',stock:'库存须为非负整数'}[k])+'。');values[k]=value;}return values;
  });
  return {key:supplierBatch.products[Number(el.dataset.supplierIndex)].key,confirmed:true,title:title.value,skus,mall_mappings:supplierDraftMappings.get(supplierBatch.products[Number(el.dataset.supplierIndex)].key)||[]};
 });
}
$('#commitSupplier').onclick=async()=>{
 if(!supplierBatch)return supplierFeedback('请先读取货盘并生成预览。',true);
 const button=$('#commitSupplier');button.disabled=true;button.textContent='正在提交…';
 try{const items=supplierBatch.plan||supplierSelectedItems();supplierFeedback('正在提交 '+items.length+' 件商品，随后上传图片并导入，请稍候…');const batch=await api('/api/supplier-imports/'+supplierBatch.id+'/commit','POST',{items});supplierRender(batch);if(batch.state==='processing')button.textContent='正在上传图片并导入…';}
 catch(e){supplierFeedback(e.message,true);button.disabled=false;}
 finally{if(supplierBatch?.state!=='processing')button.textContent='导入已确认商品到采集箱';}
};
$('#discardSupplier').onclick=async()=>{if(!supplierBatch)return;try{await api('/api/supplier-imports/'+supplierBatch.id,'DELETE');supplierBatch=null;sessionStorage.removeItem('ops-supplier-batch');$('#supplierPreview').replaceChildren();$('#supplierStatus').textContent='预览已删除，已导入商品和OSS图片保留。';$('#commitSupplier').disabled=true;$('#discardSupplier').disabled=true;}catch(e){$('#supplierStatus').textContent=e.message;}};
let imageStorageAvailability=[];
async function loadImageStorageAvailability(){try{imageStorageAvailability=(await api('/api/image-storage/availability')).malls;}catch{imageStorageAvailability=[];}}
async function loadImageStorage(){try{const c=await api('/api/image-storage');$('#imageStorageEnabled').checked=!!c.enabled;for(const [id,key]of [['Bucket','bucket'],['Region','region'],['Origin','publicOrigin']])$('#imageStorage'+id).value=c[key]||'';$('#imageStorageAllowed').value=(c.allowedOrigins||[]).join('\n');$('#imageStorageKey').value='';$('#imageStorageSecret').value='';$('#imageStorageStatus').textContent=c.credentialsSaved?'凭据已加密保存；留空保留。':'尚未配置，所有商城默认使用外链。';}catch(e){$('#imageStorageStatus').textContent=e.message;}}
function imageStorageInput(){return {enabled:$('#imageStorageEnabled').checked,bucket:$('#imageStorageBucket').value,region:$('#imageStorageRegion').value,publicOrigin:$('#imageStorageOrigin').value,allowedOrigins:$('#imageStorageAllowed').value,accessKeyId:$('#imageStorageKey').value,accessKeySecret:$('#imageStorageSecret').value};}
async function saveOrTestImageStorage(test){const controls=[...$('#imageStorageForm').querySelectorAll('input,textarea,button')];controls.forEach(x=>x.disabled=true);$('#imageStorageStatus').textContent=test?'正在上传测试图片并读取…':'正在保存…';try{const r=await api('/api/image-storage'+(test?'/test':''),'POST',imageStorageInput());if(!test)await loadImageStorage();$('#imageStorageStatus').textContent=test?r.message:'已保存，发布时仍默认不转存图片。';}catch(e){$('#imageStorageStatus').textContent=e.message;}finally{controls.forEach(x=>x.disabled=false);}}
$('#imageStorageForm').onsubmit=e=>{e.preventDefault();saveOrTestImageStorage(false);};
$('#imageStorageTest').onclick=()=>saveOrTestImageStorage(true);
setupSameStyle({$,esc,context:()=>({products:state.products,selected:mergeSelected}),api,load,edit,toast});
$('#showStyleSources').onchange=()=>{productPage=1;render();};
const systemFields={name:'systemInfoName',brand:'systemInfoBrand',title:'systemInfoTitle',login_heading:'systemLoginHeading',description:'systemDescription'};
let systemInfoRevision=null,stagedSystemImages={},systemImageUrls={},systemUploadRequests={},systemImageBusy=new Set();
function applyBranding(info){if(!info)return;document.title=info.title;$('#siteIcon').href=info.icon_url;$('#brandName').textContent=info.brand;$('#brandSystemName').textContent=info.name;document.querySelector('a.brand').setAttribute('aria-label',info.name+'首页');$('#loginHeading').textContent=info.login_heading;$('#loginDescription').textContent=info.description;$('#brandMark').classList.toggle('hidden',!!info.logo_url);$('#brandLogo').classList.toggle('hidden',!info.logo_url);if(info.logo_url)$('#brandLogo').src=info.logo_url;else $('#brandLogo').removeAttribute('src');}
function clearSystemImageDrafts(){for(const url of Object.values(systemImageUrls))URL.revokeObjectURL(url);systemImageUrls={};stagedSystemImages={};systemImageBusy.clear();for(const slot of ['icon','logo']){systemUploadRequests[slot]=(systemUploadRequests[slot]||0)+1;$('#system'+(slot==='icon'?'Icon':'Logo')+'File').value='';}}
function fillSystemInfo(info){systemInfoRevision=info.revision;clearSystemImageDrafts();for(const [key,id] of Object.entries(systemFields))$('#'+id).value=info[key];$('#systemIconPreview').src=info.icon_url;$('#systemLogoPreview').classList.toggle('hidden',!info.logo_url);if(info.logo_url)$('#systemLogoPreview').src=info.logo_url;else $('#systemLogoPreview').removeAttribute('src');$('#systemTitlePreview').textContent=info.title;$('#saveSystemInfo').disabled=false;}
async function loadSystemInfo(){if(!me.systemAdmin)return;$('#saveSystemInfo').disabled=true;$('#systemInfoStatus').textContent='正在读取…';try{fillSystemInfo(await api('/api/system-settings'));$('#systemInfoStatus').textContent='已读取全站设置。';}catch(error){$('#systemInfoStatus').textContent=error.message;}}
$('#systemInfoTitle').addEventListener('input',()=>$('#systemTitlePreview').textContent=$('#systemInfoTitle').value);
$('#reloadSystemInfo').onclick=()=>loadSystemInfo();
for(const slot of ['icon','logo']){const label=slot==='icon'?'Icon':'Logo',file=$('#system'+label+'File'),preview=$('#system'+label+'Preview');
 file.onchange=async()=>{const request=systemUploadRequests[slot]=(systemUploadRequests[slot]||0)+1;let localUrl;try{const image=file.files[0];if(!image)return;systemImageBusy.add(slot);$('#saveSystemInfo').disabled=true;$('#systemInfoStatus').textContent='正在读取图片…';if(image.size>1024*1024)throw Error('每张图片最大1MB');if(image.type==='image/svg+xml'||!(/\.(png|jpe?g|webp)$/i.test(image.name)||slot==='icon'&&/\.ico$/i.test(image.name)))throw Error('请选择PNG、JPEG、WebP图片；Icon另支持ICO');localUrl=URL.createObjectURL(image);await new Promise((resolve,reject)=>{const check=new Image();check.onload=()=>check.naturalWidth<=4096&&check.naturalHeight<=4096?resolve():reject(Error('图片宽高不能超过4096像素'));check.onerror=()=>reject(Error('图片无法读取，请换一张'));check.src=localUrl;});const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(Error('图片读取失败'));reader.readAsDataURL(image);});if(request!==systemUploadRequests[slot]){URL.revokeObjectURL(localUrl);return;}if(systemImageUrls[slot])URL.revokeObjectURL(systemImageUrls[slot]);systemImageUrls[slot]=localUrl;stagedSystemImages[slot]={data};preview.src=localUrl;preview.classList.remove('hidden');$('#systemInfoStatus').textContent='图片已预览，保存后全站生效。';}catch(error){if(localUrl)URL.revokeObjectURL(localUrl);if(request===systemUploadRequests[slot]){$('#systemInfoStatus').textContent=error.message;file.value='';}}finally{if(request===systemUploadRequests[slot]){systemImageBusy.delete(slot);$('#saveSystemInfo').disabled=systemImageBusy.size>0||systemInfoRevision===null;}}};
 $('#removeSystem'+label).onclick=()=>{systemUploadRequests[slot]=(systemUploadRequests[slot]||0)+1;if(systemImageUrls[slot]){URL.revokeObjectURL(systemImageUrls[slot]);delete systemImageUrls[slot];}stagedSystemImages[slot]=null;systemImageBusy.delete(slot);$('#saveSystemInfo').disabled=systemImageBusy.size>0||systemInfoRevision===null;file.value='';if(slot==='icon')preview.src='/default-icon.svg';else{preview.removeAttribute('src');preview.classList.add('hidden');}$('#systemInfoStatus').textContent='保存后恢复默认。';};
}
$('#systemInfoForm').onsubmit=async event=>{event.preventDefault();if(systemInfoRevision===null)return;if(systemImageBusy.size){$('#systemInfoStatus').textContent='请等待图片读取完成再保存。';return;}const fields=[...$('#systemInfoForm').querySelectorAll('input,textarea,button')];fields.forEach(el=>el.disabled=true);$('#systemInfoStatus').textContent='正在保存…';try{const payload={revision:systemInfoRevision,...Object.fromEntries(Object.entries(systemFields).map(([key,id])=>[key,$('#'+id).value])),...stagedSystemImages};const saved=await api('/api/system-settings','POST',payload);applyBranding(saved);fillSystemInfo(saved);$('#systemInfoStatus').textContent='已保存，当前页面已生效；其他标签页刷新后生效。';}catch(error){$('#systemInfoStatus').textContent=error.message;}finally{fields.forEach(el=>el.disabled=false);}};

function notificationElement(type,id){return $('#'+(type==='tigshop'?id.replace(/^notification/,'tigshopNotification'):type==='crmeb-store'?id.replace(/^notification/,'storeNotification'):id));}
function renderNotifications(data,type='crmeb-pro'){
 const node=id=>notificationElement(type,id);
 node('notificationEnabled').checked=data.enabled;node('notificationPaid').checked=data.paid;node('notificationRefund').checked=data.refund;
 node('notificationWebhook').placeholder=data.hasWebhook?'已加密保存，留空保留当前接收群':'粘贴企业微信消息推送Webhook';
 for(const [id,key] of Object.entries({notificationTokenUrl:'tokenUrl',notificationPushAccount:'pushAccount',notificationPushPassword:'pushPassword',notificationPaidUrl:'paidUrl',notificationRefundUrl:'refundUrl',notificationIgnoreUrl:'ignoreUrl',notificationRelayPaidUrl:'relayPaidUrl',notificationRelayRefundUrl:'relayRefundUrl',notificationRelayPaidTemplate:'relayPaidTemplate',notificationRelayRefundTemplate:'relayRefundTemplate'}))if(node(id))node(id).value=data[key]||'';
 node('notificationTest').disabled=!data.enabled;
 if(type==='tigshop'){node('notificationCurrency').value=data.currency||'';node('notificationTimeZone').value=data.timeZone||'';}
 const poll=data.refundPoll;node('notificationRefundStatus').textContent=poll?.error?'退款检查失败：'+poll.error:poll?.enabled?'退款补拉已启用，每分钟检查'+(poll.last_success?'；最近成功：'+date(poll.last_success):'；正在建立首次检查记录'):'退款补拉尚未启用，请点击检查按钮。';
 if(type==='crmeb-store'){
  node('notificationRefundStatus').textContent='多门店使用原生事件转接；请复制下方地址和模板到商城通知设置。无需启用旧退款补拉。';
  const target=node('notificationRelayRecords'),states={pending:'等待读取（失败自动重试）',working:'正在读取',done:'已核对并转入发送队列',failed:'读取失败'};
  if(target)target.innerHTML='<h3>商城原生接收记录</h3>'+((data.relayRecords||[]).map(r=>'<div class="notification-record"><span>'+esc(r.kind==='paid'?'付款':'退款申请')+' · '+esc(r.order_sn)+' · '+esc(states[r.status]||r.status)+' · '+date(r.created)+'</span><small>'+esc(r.error)+'</small>'+(r.status==='failed'?'<button type="button" class="text" data-relay-retry="'+esc(r.id)+'">重试读取资料</button>':'')+'</div>').join('')||'<p class="hint">尚未收到商城原生通知。权限检查和测试消息不代表实际付款／退款已接入。</p>');
 }
 if(type==='tigshop')node('notificationRefundStatus').textContent=['paid','refund'].map(kind=>{const p=data.tigshopPoll?.[kind],name=kind==='paid'?'付款':'退款申请';return name+'：'+(p?.error?p.error:p?.enabled?'每分钟检查'+(p.last_success?'，最近成功 '+date(p.last_success):'，等待首次检查'):'尚未启用接口检查');}).join('；');
 const statuses={paused:'已暂停',pending:'等待发送',sending:'发送中',sent:'已发送',failed:'发送失败',uncertain:'需核对群消息'},kinds={paid:'付款成功',refund:'申请退款',test:'连接测试'};
 node('notificationRecords').innerHTML='<h3>最近通知记录</h3>'+(data.records.length?data.records.map(row=>'<div class="notification-record"><span>'+esc(kinds[row.kind]||row.kind)+' · '+esc(statuses[row.status]||row.status)+' · '+date(row.created)+'</span><small>'+esc(row.error)+'</small>'+(['failed','uncertain'].includes(row.status)?'<button type="button" class="text" data-notification-retry="'+esc(row.id)+'">核对后重新发送</button>':'')+'</div>').join(''):'<p class="hint">暂无记录。点击发送测试通知，随后刷新记录。</p>');
}
async function loadNotifications(type='crmeb-pro'){try{renderNotifications(await api('/api/connections/'+type+'/notifications'),type);notificationElement(type,'notificationStatus').textContent='通知设置已读取。';}catch(e){notificationElement(type,'notificationStatus').textContent=e.message;}}
for(const type of ['crmeb-pro','crmeb-store','tigshop']){
 const node=id=>notificationElement(type,id),path='/api/connections/'+type+'/notifications';
 node('notificationForm').onsubmit=async event=>{event.preventDefault();const button=event.submitter;button.disabled=true;try{const data=await api(path,'POST',{webhook:node('notificationWebhook').value.trim(),enabled:node('notificationEnabled').checked,paid:node('notificationPaid').checked,refund:node('notificationRefund').checked,...(type==='tigshop'?{currency:node('notificationCurrency').value.trim(),timeZone:node('notificationTimeZone').value}:{})});node('notificationWebhook').value='';renderNotifications(data,type);node('notificationStatus').textContent=type==='tigshop'?'已保存。先发送测试通知，再点击接口检查，无需配置商城回调。':'已保存。先发送测试通知，再将下方推送配置填写到商城。';}catch(e){node('notificationStatus').textContent=e.message;}finally{button.disabled=false;}};
 node('notificationTest').onclick=async()=>{const button=node('notificationTest');button.disabled=true;try{renderNotifications(await api(path+'/test','POST',{}),type);node('notificationStatus').textContent='测试通知已排队，请查看企业微信群，稍后刷新通知记录。';}catch(e){node('notificationStatus').textContent=e.message;}finally{button.disabled=!node('notificationEnabled').checked;}};
 node('notificationRefresh').onclick=()=>loadNotifications(type);
 for(const button of node('notificationDetails').querySelectorAll('[data-notification-copy]'))button.onclick=async()=>{try{const value=$('#'+button.dataset.notificationCopy).value;if(!value)throw Error('请先保存通知设置');await navigator.clipboard.writeText(value);node('notificationStatus').textContent='已复制，请直接粘贴到商城，不要发到聊天或截图中。';}catch(e){node('notificationStatus').textContent=e.message;}};
 node('notificationRecords').onclick=async event=>{const button=event.target.closest('[data-notification-retry]');if(!button)return;if(!confirm('请先检查群里是否已收到该事件。重新发送可能产生重复消息，确认继续？'))return;button.disabled=true;try{renderNotifications(await api(path+'/retry','POST',{id:button.dataset.notificationRetry}),type);node('notificationStatus').textContent='已重新排队。';}catch(e){node('notificationStatus').textContent=e.message;button.disabled=false;}};
 if(type==='crmeb-store'&&node('notificationRelayRecords'))node('notificationRelayRecords').onclick=async event=>{const button=event.target.closest('[data-relay-retry]');if(!button)return;button.disabled=true;try{renderNotifications(await api(path+'/relay-retry','POST',{id:button.dataset.relayRetry}),type);node('notificationStatus').textContent='已重新排队读取商城资料，通知按商城业务ID去重。';}catch(e){node('notificationStatus').textContent=e.message;button.disabled=false;}};
 node('notificationRefundCheck').onclick=async()=>{const button=node('notificationRefundCheck');button.disabled=true;try{renderNotifications(await api(path+(type==='tigshop'?'/source-check':type==='crmeb-store'?'/relay-check':'/refund-check'),'POST',{}),type);node('notificationStatus').textContent=type==='tigshop'?'接口检查通过，已开始补拉近24小时自营付款和待审核退款申请。稍后刷新通知记录。':type==='crmeb-store'?'通知读取接口检查通过。请将下方地址和模板填入商城，随后测试真实付款与退款。':'权限检查通过，已开始补拉近24小时未处理申请。稍后刷新通知记录。';}catch(e){node('notificationStatus').textContent=e.message;}finally{button.disabled=false;}};
}
