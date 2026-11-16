import {splitSupplierParameters} from './supplier-parameters.js';
import {setupCampaign} from './campaign.js';
import {createCatalogRecents} from './catalog-recents.js';
import {setupAssetPanel} from './assets.js';
import {editorReadiness} from './editor-readiness.js';
import {setupOperations} from './operations.js';
import {actionDialogs} from './action-dialogs.js';
import {dashboardCards} from './dashboard.js';
import {mergeUsages,mergeStatusHTML} from './merge-status.js';
import {setupSameStyle} from './same-style.js';
import {applyBulkMapping} from './bulk-settings.js';
import {suggestedMergeRows,mergeSelection} from './merge-products.js';
import {productMallMappings} from './mall-mappings.js';
import {pageInfo,publicationMalls} from './list-view.js';
import {normalizeProductAttributes,descriptionWithAttributes,productAttributesFromJSON} from './product-attributes.js';
import {compareVersions,safariCollectorVersion} from './collector-version.js';
import {specificationMatrix,remapSpecificationValues,matchSpecificationImport} from './specifications.js';
import {channelConfiguration,yunzhongConfiguration} from './connection-status.js';
import {detailImagesFromJSON,detailHTML} from './detail-images.js';
import {batchPrices,batchCosts} from './pricing.js';
import {matchSkuImages} from './sku-images.js';
const $=s=>document.querySelector(s);
const pageBuild=$('meta[name="ops-build"]')?.content;
if(pageBuild){
 let checking=false;
 const checkRelease=async()=>{
  if(checking||document.hidden||!$('#opsUpdate').hidden)return;
  checking=true;
  try{
   const response=await fetch('/api/system-release',{cache:'no-store',signal:AbortSignal.timeout(8000)});
   if(!response.ok)return;
   const release=await response.json();
   if(/^[a-f0-9]{12}$/.test(release.build)&&release.build!==pageBuild){
    $('#opsUpdateMessage').textContent='已发布新版本，请在保存当前操作后刷新体验。';
    $('#opsUpdate').hidden=false;
   }
  }catch{}finally{checking=false;}
 };
 $('#opsReload').onclick=()=>{if(document.querySelector('dialog[open]'))return;location.reload();};
 document.addEventListener('visibilitychange',checkRelease);
 setInterval(checkRelease,60000);
 checkRelease();
}
const actions=actionDialogs({$});
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let assetPanel;
let me={},state={products:[],jobs:[],targets:[]},page='products',filter='all',editing=null,publishing=null,catalog=null,catalogRequest=0;
const selectedMalls={},settingsRequests={};
const catalogHistory=createCatalogRecents();
const mergeSelected=new Set();let mergingProducts=[],mergeRequestId='',mergePreviewKey='',mergePending=null;
let editingMappings=new Map(),activeMappingId='',publishResults=new Map(),publishUncertain=false;
let productPage=1,productSize=20,jobPageNumber=1,jobSize=20,jobView={rows:[],page:1,pages:1,total:0,start:0,end:0},jobRequest=0,jobLoading=false;
const mallRows=()=>state.malls||state.targets.map(t=>({...t,type:t.id,id:t.connection_id||t.id}));
const mallFor=(id,type)=>mallRows().find(m=>m.id===id)||mallRows().find(m=>m.type===type&&m.legacy)||mallRows().find(m=>m.type===type);
const campaignPanel=setupCampaign({$,esc,products:()=>state.products,explain:bundles=>api('/api/campaign/explain','POST',{bundles}),mallName:(id,target)=>mallFor(id,target)?.name||target});
const labels={draft:'待整理',pending_review:'待审核',approved:'审核通过',dispatching:'发送中',accepted:'执行中',unknown:'需核对',succeeded:'发布成功',failed:'执行失败',awaiting_review:'待核对商品ID',verifying:'核对中'};
const date=v=>new Date(v).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
function clearDialogFeedback(dialog){dialog?.querySelectorAll('[data-dialog-feedback]').forEach(node=>node.remove());}
function toast(message,{error=false}={}){
 const global=$('#toast');clearTimeout(toast.timer);global.textContent=message;global.classList.toggle('is-error',error);global.setAttribute('role',error?'alert':'status');global.classList.remove('hidden');
 if(global.showPopover){if(!global.matches(':popover-open'))global.showPopover();}
 else{const dialog=[...document.querySelectorAll('dialog[open]')].at(-1);if(dialog)dialog.append(global);else document.body.append(global);}
 toast.timer=setTimeout(()=>{if(global.hidePopover&&global.matches(':popover-open'))global.hidePopover();global.classList.add('hidden');},error?6500:2000);
}
document.addEventListener('close',event=>{if(event.target.tagName==='DIALOG')clearDialogFeedback(event.target);},true);
let sessionReloading=false,sessionChecking=false;
const sessionEnded=(status,code)=>(status===401&&code==='OPS_SESSION_EXPIRED')||(status===403&&code==='OPS_ACCESS_DISABLED');
function refreshAfterSessionEnd(){
 if(!me.user||sessionReloading)return;
 sessionReloading=true;
 location.reload();
}
async function checkSession(){
 if(!me.user||document.hidden||sessionReloading||sessionChecking)return;
 sessionChecking=true;
 try{
  const current=await api('/api/session','GET',undefined,AbortSignal.timeout(10000));
  if(current.csrf!==me.csrf)refreshAfterSessionEnd();
 }catch{}finally{sessionChecking=false;}
}
function watchSession(){
 setInterval(checkSession,30000);
 document.addEventListener('visibilitychange',checkSession);
 window.addEventListener('focus',checkSession);
 window.addEventListener('pageshow',event=>{if(event.persisted)checkSession();});
}
async function api(path,method='GET',body,signal){
 const type=path.match(/^\/api\/connections\/(crmeb-pro|crmeb-store|tigshop|yunzhong|shopxo)(?:\/|$)/)?.[1];
 if(type&&selectedMalls[type])path+=(path.includes('?')?'&':'?')+'connection_id='+encodeURIComponent(selectedMalls[type]);
 const selector=type?document.querySelector('[data-mall-selector="'+type+'"]'):null;
 if(selector){settingsRequests[type]=(settingsRequests[type]||0)+1;selector.disabled=true;$('#addMall').disabled=true;}
 try{const r=await fetch(path,{method,signal,headers:method==='GET'?{}:{'Content-Type':'application/json','X-CSRF-Token':me.csrf},body:body===undefined?undefined:JSON.stringify(body)});let data;
  try{data=await r.json();}catch(error){
   if(signal?.aborted)throw error;
   const ray=r.headers?.get('cf-ray');
   const detail=r.status===502||r.status===503||r.status===504?'网关暂未收到正常响应，请稍后再试。':r.status===401||r.status===403?'请另开一个 OPS 标签页检查登录状态或访问权限，再重试。':'如再次出现，请记录发生时间和 HTTP 状态。';
   throw Object.assign(Error('OPS 接口返回了非 JSON 响应（HTTP '+r.status+(ray?'，Ray ID '+ray:'')+'）。'+detail),{responseStatus:r.status,code:'OPS_INVALID_RESPONSE'});
  }
  if(!r.ok){if(sessionEnded(r.status,data?.code))refreshAfterSessionEnd();throw Object.assign(Error(data?.error||'请求失败'),{httpStatus:r.status,code:data?.code});}if(!['GET','HEAD'].includes(method)&&path!=='/auth/logout')assetPanel?.schedule();return data;}
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
const listingLabels={listed:'已上架',unlisted:'已下架',unknown:'上下架未核实'};
const publicationLabel=record=>record?.source==='manual_link'?'已关联 · '+listingLabels[record.listing_status]:record?.status==='succeeded'?'已发布':record?.status==='failed'?'失败':labels[record?.status]||'未发布';
const approvingProducts=new Set();
const activePublications=new Set(['dispatching','accepted','verifying']);
function reviewBadge(product){
 const busy=approvingProducts.has(product.id),status=busy?'dispatching':product.status;
 return '<span class="badge '+esc(status)+(busy?' activity-indicator':'')+'" aria-live="polite">'+esc(busy?'审核中…':labels[status]||status)+'</span>';
}
let publicationProduct;
function publicationBadges(product){
 const rows=publicationRows(product);
 if(!rows.length)return '<span class="hint">暂无商城</span>';
 const linked=rows.filter(({record})=>record?.source==='manual_link');
 return '<div class="product-publications publication-circles">'+rows.map(({mall,record})=>{const status=record?.status||'none',label=publicationLabel(record),mark=mall.badge||Array.from(mall.name||'商')[0],description=mall.name+' · '+label+(record?.revision?' · v'+record.revision:'');return '<button type="button" class="publication-circle '+esc(status)+(activePublications.has(status)?' activity-indicator':'')+'" data-publications="'+esc(product.id)+'" title="'+esc(description)+'" aria-label="'+esc(description)+'，查看发布记录">'+esc(mark)+'</button>';}).join('')+'</div>'+linked.map(({mall,record})=>'<small>'+esc(mall.name+' · '+publicationLabel(record))+'</small>').join('');
}
function showPublicationDetails(product,{refresh=false}={}){
 publicationProduct=product;
 const dialog=$('#publicationDialog'),editable=state.team?.role!=='editor';
 $('#publicationTitle').textContent=product.title||'商品发布记录';
 $('#publicationRevision').textContent='当前版本 v'+product.revision+'；已有商品的上下架状态由人工记录，以商城为准。';
 $('#publicationRows').innerHTML=publicationRows(product).map(({mall,record})=>{
  const manual=record?.source==='manual_link',status=record?.status||'none';
  const action=!editable?'':manual?'<button type="button" class="text" data-unlink-mall="'+esc(mall.id)+'">解除关联</button>':!record||record.can_republish?'<button type="button" class="text" data-link-mall="'+esc(mall.id)+'">关联已有商品</button>':'';
  const verify=editable&&record?.verify_job_id?`<form class="publication-verify" data-verify-job="${esc(record.verify_job_id)}"><label>核对商品 ID<input name="remote_id" required inputmode="numeric" pattern="[1-9][0-9]{0,14}" maxlength="15"></label><button type="submit" class="secondary">验证</button></form>`:'';
  return `<tr><td>${esc(mall.name)}<small>${esc(mall.system)}</small></td><td><span class="badge ${esc(status)}${activePublications.has(status)?' activity-indicator':''}">${esc(publicationLabel(record))}</span>${record?.message?'<small>'+esc(record.message)+'</small>':''}</td><td>${manual?'人工关联':record?'v'+esc(record.revision)+(record.revision!==product.revision?'（历史版本）':''):'—'}</td><td>${esc(record?.remote_id||'—')}</td><td>${action}${verify}</td></tr>`;
 }).join('')||empty(5,'暂无商城发布记录','配置商城后即可关联已有商品');
 if(!refresh){$('#mallLinkForm').hidden=true;$('#mallLinkFeedback').textContent='';$('#publicationVerifyFeedback').textContent='';}
 if(!dialog.open)dialog.showModal();
}
$('#closePublication').onclick=()=>$('#publicationDialog').close();
let publicationVerifying=false;
$('#publicationRows').onsubmit=async event=>{
 const form=event.target;
 if(!form.dataset.verifyJob)return;
 event.preventDefault();
 if(publicationVerifying)return;
 const button=event.submitter,pathJob=form.dataset.verifyJob,productId=publicationProduct?.id;
 const feedback=$('#publicationVerifyFeedback');
 publicationVerifying=true;button.disabled=true;button.classList.add('activity-indicator');
 try{
  await verifyJob(pathJob,form.elements.remote_id.value.trim(),message=>{if(publicationProduct?.id===productId&&$('#publicationDialog').open)feedback.textContent=message;},()=>{const badge=form.closest('tr').querySelector('.badge');badge.className='badge verifying activity-indicator';badge.textContent='核对中';void load().catch(()=>{});});
  await load();
  const refreshed=state.products.find(row=>row.id===productId);
  if(refreshed&&publicationProduct?.id===productId&&$('#publicationDialog').open)showPublicationDetails(refreshed,{refresh:true});
 }catch(error){if(publicationProduct?.id===productId)feedback.textContent=error.message;}
 finally{publicationVerifying=false;button.disabled=false;button.classList.remove('activity-indicator');}
};
$('#publicationRows').onclick=async event=>{
 const button=event.target.closest('button'),product=publicationProduct;
 if(!button||!product)return;
 if(button.dataset.linkMall){
  const form=$('#mallLinkForm');form.reset();form.dataset.mall=button.dataset.linkMall;
  $('#mallLinkTarget').textContent='关联到 '+mallFor(form.dataset.mall).name;
  $('#mallLinkFeedback').textContent='';form.hidden=false;form.elements.remote_id.focus();return;
 }
 if(!button.dataset.unlinkMall)return;
 const mall=mallFor(button.dataset.unlinkMall),record=product.publications.find(row=>row.mall_connection_id===mall.id);
 if(!await actions.confirm('解除 '+mall.name+' 商品 '+record.remote_id+' 的关联？商城商品保留；解除后 OPS 可再次向此商城发布。'))return;
 await submitMallLink(product,mall.id,record.remote_id,undefined,true,button);
};
$('#mallLinkForm').onsubmit=async event=>{
 event.preventDefault();
 const form=event.currentTarget,product=publicationProduct,mall=mallFor(form.dataset.mall),remoteId=form.elements.remote_id.value.trim();
 if(!product||!mall)return;
 if(!await actions.confirm('确认「'+product.title+'」与 '+mall.name+' 的商品 '+remoteId+' 是同一件商品？OPS 不会读取或修改商城商品。'))return;
 await submitMallLink(product,mall.id,remoteId,form.elements.listing_status.value,false,event.submitter);
};
async function submitMallLink(product,mallId,remoteId,listingStatus,remove,button){
 button.disabled=true;$('#mallLinkFeedback').textContent='';
 try{
  await api('/api/products/'+encodeURIComponent(product.id)+'/mall-link',remove?'DELETE':'POST',{connection_id:mallId,remote_id:remoteId,listing_status:listingStatus});
  const message=remove?'已解除关联':'已关联商城已有商品';
  try{await load();const refreshed=state.products.find(row=>row.id===product.id);if(refreshed&&$('#publicationDialog').open&&publicationProduct?.id===product.id)showPublicationDetails(refreshed);toast(message);}
  catch{toast(message+'，列表刷新失败，请手动刷新。');}
 }catch(error){$('#mallLinkFeedback').textContent=error.message;}
 finally{button.disabled=false;}
}
async function refreshPublicationDialog(){
 const id=publicationProduct?.id;
 await load();
 if(!$('#publicationDialog').open||publicationProduct?.id!==id||publicationVerifying||!$('#mallLinkForm').hidden||$('#publicationRows').querySelector('input:focus')||[...$('#publicationRows').querySelectorAll('input')].some(input=>input.value))return;
 const refreshed=state.products.find(row=>row.id===id);
 if(refreshed&&JSON.stringify(refreshed.publications)!==JSON.stringify(publicationProduct.publications))showPublicationDetails(refreshed,{refresh:true});
}
let stateRequest=0;
async function load(){const request=++stateRequest,scope=$('#collectionScope').value,result=await api('/api/state?collection_scope='+scope);if(request!==stateRequest||scope!==$('#collectionScope').value)return;state=result;await loadJobPage();if(request!==stateRequest)return;render();renderMallNames();refreshSetupShortcut();}
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
function renderStats(){document.querySelector('.stats').classList.toggle('hidden',!['products','jobs'].includes(page));for(const card of dashboardCards(page,state,jobView)){$('#'+card.id).textContent=card.value;$('#'+card.id+'Label').textContent=card.label;$('#'+card.id+'Hint').textContent=card.hint;}}
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
 renderStats();
 const mergeUsage=mergeUsages(state.products),usedStyleSources=new Set(mergeUsage.keys()),showStyleSources=$('#showStyleSources').checked;
 const source=$('#collectionSource').value,supplierField=$('#collectionSupplierField'),supplierSelect=$('#collectionSupplier'),previousSupplier=supplierSelect.value;
 supplierField.hidden=source!=='supplier';
 const suppliers=[...new Set(state.products.map(p=>p.supplier_import?.supplier).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'zh-CN'));
 supplierSelect.replaceChildren(new Option('全部供应商',''),...suppliers.map(name=>new Option(name,name)));supplierSelect.value=suppliers.includes(previousSupplier)?previousSupplier:'';
 const sourceOf=p=>p.supplier_import?'supplier':p.source_url.startsWith('https://detail.tmall.com/')?'tmall':p.source_url.startsWith('https://item.taobao.com/')?'taobao':p.source_url.startsWith('https://detail.1688.com/')?'1688':'';
 const search=$('#search').value.trim().toLowerCase(),products=state.products.filter(p=>(!source||sourceOf(p)===source)&&(source!=='supplier'||!supplierSelect.value||p.supplier_import?.supplier===supplierSelect.value)&&((showStyleSources||!usedStyleSources.has(p.id))&&(filter==='all'||p.status===filter)&&`${p.title} ${p.source_url} ${(p.skus||[]).map(s=>s.source?.url||'').join(' ')}`.toLowerCase().includes(search)));
 const productPaging=pageInfo(products.length,productPage,productSize);productPage=productPaging.page;
 $('#count').textContent=`第 ${productPaging.start}–${productPaging.end} 件 / 筛选结果 ${products.length} 件（已加载 ${state.products.length} 件，最多 1000 件）`;
 $('#productPageInfo').textContent=productPaging.page+' / '+productPaging.pages+' 页';$('#productPrev').disabled=productPage<=1;$('#productNext').disabled=productPage>=productPaging.pages;
 $('#productRows').innerHTML=products.slice(productPaging.offset,productPaging.offset+productPaging.pageSize).map(p=>`<tr><td><input type="checkbox" data-merge-select="${esc(p.id)}" aria-label="选择商品：${esc(p.title||p.source_url)}" ${mergeSelected.has(p.id)?'checked':''}></td><td><div class="product-cell">${p.images[0]?`<img class="thumb" loading="lazy" referrerpolicy="no-referrer" src="${esc(p.images[0])}" alt="">`:'<div class="thumb">▧</div>'}<div><div class="title" title="${esc(p.title||p.source_url)}">${esc(p.title||'待采集 · '+(p.source_url.match(/offer\/(\d+)/)?.[1]||new URL(p.source_url).searchParams.get('id')||''))}</div><small>${esc(p.category||'尚未分类')} · v${p.revision}</small>${mergeStatusHTML(p,mergeUsage.get(p.id),esc)}${state.team?'<small>采集：'+esc(p.collected_by===me.user.sub?'我':p.collector_name||p.collected_by||'历史采集人未知')+'</small>':''}</div></div></td><td>${p.supplier_import?'<span>货盘 · '+esc(p.supplier_import.supplier)+'</span>':`<a href="${esc(p.source_url)}" target="_blank" rel="noopener noreferrer">${p.source_url.includes('detail.tmall.com')?'天猫':p.source_url.includes('item.taobao.com')?'淘宝':'1688'} ↗</a>`}${p.same_style?'<small>货盘同款整理商品</small>':p.merge_sources?'<small>多链接合并商品</small>':''}</td><td>${p.skus.length} 个 SKU${p.spec_names?.length?`<small>${esc(p.spec_names.join(' × '))}</small>`:''}<small>${p.skus.length?'¥ '+Math.min(...p.skus.map(s=>s.price)).toFixed(2)+' 起':'尚未录入价格'}</small></td><td>${reviewBadge(p)}</td><td>${publicationBadges(p)}</td><td>${date(p.updated)}</td><td><button class="text" data-edit="${p.id}">编辑</button>${!canPublish?'':p.status==='approved'?`<button class="text" data-publish="${p.id}">发布</button>`:`<button class="text" data-approve="${p.id}" ${approvingProducts.has(p.id)?'disabled aria-busy="true"':''}>审核</button>`}</td></tr>`).join('')||empty(8,'采集箱已准备好','添加1688或淘宝商品链接，或导入采集器整理好的 JSON 商品资料。');
 $('#jobRows').innerHTML=jobView.rows.map(j=>`<tr><td><div class="product-cell job-product-cell"><div class="thumb job-product-thumb" aria-hidden="true"><span>▧</span>${j.product_image?`<img loading="lazy" decoding="async" referrerpolicy="no-referrer" src="${esc(j.product_image)}" alt="">`:''}</div><div class="job-product-info"><div class="title" title="${esc(j.product_title||'商品记录')}">${esc(j.product_title||'商品记录')}</div><small>${j.id.slice(0,8)} · v${j.revision}</small>${state.team?'<small>发起：'+esc(j.initiated_by===me.user.sub?'我':j.initiator_name||j.initiated_by||'历史发起人未知')+'</small>':''}</div></div></td><td>${esc(mallFor(j.mall_connection_id,j.target)?.name||j.target)}</td><td><span class="badge ${j.status}">${labels[j.status]||esc(j.status)}</span></td><td>${esc(j.message||'等待执行')}${canPublish&&j.id==='650b74d9-6d5e-4174-9245-4d45163e3699'&&j.status==='unknown'&&j.message.includes('商品总库存必须大于0')?`<button class="text" data-recover-stock="${j.id}">核对未入库并结束任务</button>`:''}${j.fx?`<small>1 EUR = ${esc(j.fx.cnyPerEur)} CNY · 汇率日期 ${esc(j.fx.rateDate)}</small>`:''}${j.remote_id?`<small>商城商品 ID：${esc(j.remote_id)}</small>`:''}${j.claimed?`<small>任务编码：${esc(j.marker)}</small>`:''}${canPublish&&j.target==='yunzhong'&&j.claimed&&j.status==='unknown'&&!j.remote_id&&j.message.includes('兼容扩展返回 HTTP 400')?`<button class="text" data-recover-yunzhong="${j.id}">核对未入库并恢复原任务</button>`:''}${canPublish&&['crmeb-pro','crmeb-store','tigshop','yunzhong','shopxo'].includes(j.target)&&j.claimed&&!['succeeded','failed'].includes(j.status)?`<button class="text" data-verify="${j.id}">填写商品 ID 核对</button>`:''}${canPublish&&['crmeb-pro','crmeb-store','tigshop','yunzhong','shopxo'].includes(j.target)&&!j.claimed&&['accepted','unknown'].includes(j.status)?`<button class="text" data-retry="${j.id}">重发未领取任务</button>`:''}</td><td>${date(j.created)}</td></tr>`).join('')||empty(5,'还没有发布任务','审核商品后，选择一个目标商城创建发布任务。');
 $('#jobCount').textContent='第 '+jobView.start+'–'+jobView.end+' 条 / 共 '+jobView.total+' 条记录';$('#jobPageInfo').textContent=jobPageNumber+' / '+jobView.pages+' 页';updateJobPager();
 $('#connectionScope').textContent=state.team?'当前团队：'+state.team.name+' · 管理员配置后由团队共享':'当前个人工作空间';
 $('#connectionSystemStatus').textContent=(me.demo?'本地演示登录':'统一账号已登录')+' · 商品工作流状态请在发布任务中查看。';
}
document.querySelectorAll('[data-page]').forEach(b=>b.onclick=()=>{page=b.dataset.page;document.querySelectorAll('[data-page]').forEach(x=>x.classList.toggle('active',x===b||page==='onboarding'&&x.dataset.page==='team'&&b.classList.contains('hidden')));for(const p of ['products','campaign','jobs','connections','team','systemSettings','users','billing','onboarding'])$('#'+p).classList.toggle('hidden',p!==page);const titles={onboarding:'工作空间配置指南',products:'商品采集箱',campaign:'活动选品台',jobs:'发布任务',connections:'商城与工具',team:'团队管理',systemSettings:'系统设置',users:'用户管理',billing:'点数与账单'};$('#heading').textContent=$('#breadcrumb').textContent=titles[page];$('#subtitle').textContent={onboarding:'从团队开通到首次商城入库，逐步完成配置。',products:'让每一份货源资料，成为准备好上架的商品。',campaign:'挑选规格，随时核算套餐利润。',jobs:'从任务接收到商城入库，每一步都有记录。',connections:'连接你的账号、工作流与商城。',team:'共同维护商品，按角色完成整理、审核和发布。',systemSettings:'管理站点名称、图标和登录页展示。',users:'管理OPS访问权限、登录会话和团队角色。',billing:'查看团队点数、冻结余额和账务流水。'}[page];$('#productActions').classList.toggle('hidden',page!=='products');renderStats();if(page==='campaign')campaignPanel.open();if(page==='onboarding')loadOnboarding().catch(e=>{$('#onboardingSummary').textContent='进度读取失败：'+e.message;});if(page==='jobs')loadJobPage().then(()=>render()).catch(e=>toast(e.message,{error:true}));if(page==='billing')loadBilling().catch(e=>toast(e.message));if(page==='users')loadUsers().catch(e=>toast(e.message));if(page==='systemSettings'){loadSystemInfo();loadImageStorage();loadSupplierAI();operationPanel.load();}if(page==='team')loadTeam().catch(e=>toast(e.message));if(page==='connections'){loadCollectorDownload();if((state.team?.role||'admin')==='admin'){loadYunzhongConnection();loadShopxoConnection();loadCrmebAuthConnections();loadCrmebPublishConnections();loadNotifications();loadNotifications('crmeb-store');loadNotifications('tigshop');loadTigshopConnection().catch(e=>{$('#tigshopConnectionStatus').textContent=e.message;recordConnectionPart('tigshop','auth',{error:true});});}}});
document.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{filter=b.dataset.filter;productPage=1;document.querySelectorAll('[data-filter]').forEach(x=>x.classList.toggle('active',x===b));render();});$('#search').oninput=()=>{productPage=1;render();};
assetPanel=setupAssetPanel({$,api});$('#assetDetails').onclick=()=>{if(me.systemAdmin){billingOwnersLoaded=false;billingRecoveryChecked=false;}document.querySelector('nav [data-page="billing"]').click();};
let editingSpecNames=[];
let editorValidationAttempted=false,editorReadinessTimer;
function editorCheckData(){const f=$('#productForm'),value=name=>f.elements[name].value;return {source_url:value('source_url'),title:value('title'),images:value('images').split('\n').map(s=>s.trim()).filter(Boolean),detail_images:value('detail_images').split('\n').map(s=>s.trim()).filter(Boolean),...(editingSpecNames.length?{spec_names:editingSpecNames}:{}),skus:[...$('#skuRows').children].map(tr=>{const get=key=>tr.querySelector('[data-key="'+key+'"]')?.value;return {sku:get('sku'),cost:get('cost'),price:get('price'),stock:get('stock'),spec:get('spec'),...(editingSpecNames.length?{spec_values:editingSpecNames.map((_,i)=>get('specValue'+i))}:{})};})};}
function editorIssueControl(issue){if(issue.row!==undefined)return $('#skuRows').children[issue.row]?.querySelector('[data-key="'+issue.key+'"]');return $('#productForm').elements[issue.field]||document.getElementById(issue.field);}
function updateEditorReadiness(){
 const result=editorReadiness(editorCheckData(),{editor:true,categorySelected:Number($('#categorySelect').value)>0});
 const pendingNames=$('#specNames').value.split(/[,，]/).map(value=>value.trim()).filter(Boolean);if(JSON.stringify(pendingNames)!==JSON.stringify(editingSpecNames)){const issue={stage:'save',group:'skus',field:'specNames',message:'规格维度已修改，请先点击“应用规格列”'};result.issues.push(issue);result.save.push(issue);}
 const form=$('#productForm');for(const control of form.querySelectorAll('input,textarea,select')){if(!control.willValidate||control.validity.valid||result.issues.some(issue=>issue.stage==='save'&&editorIssueControl(issue)===control))continue;const group=control.closest('.editor-group')?.id.replace('editor-','');if(!group)continue;const tr=control.closest('#skuRows>tr'),issue={stage:'save',group,field:control.id||control.name,message:control.validationMessage||'请核对字段格式'};if(tr){issue.row=[...$('#skuRows').children].indexOf(tr);issue.key=control.dataset.key;}result.issues.push(issue);result.save.push(issue);}
 form.querySelectorAll('.editor-field-feedback').forEach(node=>node.remove());form.querySelectorAll('[data-editor-invalid]').forEach(node=>{node.removeAttribute('aria-invalid');node.removeAttribute('data-editor-invalid');});
 form.querySelectorAll('[data-editor-feedback-id]').forEach(node=>{const ids=(node.getAttribute('aria-describedby')||'').split(' ').filter(id=>id!==node.dataset.editorFeedbackId);if(ids.length)node.setAttribute('aria-describedby',ids.join(' '));else node.removeAttribute('aria-describedby');delete node.dataset.editorFeedbackId;});
 for(const [index,issue] of result.issues.entries()){const control=editorIssueControl(issue);if(!control)continue;if(issue.stage==='save'&&!editorValidationAttempted&&!control.dataset.editorTouched)continue;const feedback=document.createElement('small');feedback.id='editor-field-feedback-'+index;feedback.className='editor-field-feedback '+(issue.stage==='save'?'is-error':'is-pending');feedback.textContent=issue.message;control.insertAdjacentElement('afterend',feedback);control.dataset.editorFeedbackId=feedback.id;control.setAttribute('aria-describedby',((control.getAttribute('aria-describedby')||'')+' '+feedback.id).trim());if(issue.stage==='save'){control.setAttribute('aria-invalid','true');control.dataset.editorInvalid='1';}}
 for(const link of form.querySelectorAll('.editor-section-nav>a')){link.querySelector('.editor-group-count')?.remove();const group=link.hash.replace('#editor-',''),issues=result.issues.filter(i=>i.group===group);if(!issues.length)continue;const badge=document.createElement('span');badge.className='editor-group-count'+(issues.some(i=>i.stage==='save')?' has-errors':'');badge.textContent='待补 '+issues.length;badge.title='保存问题 '+issues.filter(i=>i.stage==='save').length+' 项，审核前待补 '+issues.filter(i=>i.stage==='review').length+' 项';link.append(badge);}
 const summary=$('#editorReadiness');summary.replaceChildren();const text=document.createElement('span');text.textContent=result.save.length?'保存问题 '+result.save.length+' 项 · 审核前待补 '+result.review.length+' 项':result.review.length?'可保存待整理 · 审核前待补 '+result.review.length+' 项':'基础必填项已补齐，保存后可进行审核；最终以商城校验为准';summary.append(text);if(result.issues.length){const button=document.createElement('button');button.type='button';button.className='text';button.textContent='定位待补项';button.onclick=()=>showEditorIssue(result.save.length?'save':'review');summary.append(button);}return result;
}
function showEditorIssue(stage){editorValidationAttempted=true;const result=updateEditorReadiness(),issue=stage==='save'?result.save[0]:result.save[0]||result.review[0];if(!issue)return;const control=editorIssueControl(issue);if(!control)return;for(let parent=control.parentElement;parent&&parent!==$('#productForm');parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;control.scrollIntoView({block:'center',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});if(!control.disabled)control.focus({preventScroll:true});}
function scheduleEditorReadiness(){clearTimeout(editorReadinessTimer);editorReadinessTimer=setTimeout(()=>{if($('#editor').open)updateEditorReadiness();},120);}
$('#productForm').addEventListener('input',event=>{event.target.dataset.editorTouched='1';scheduleEditorReadiness();});$('#productForm').addEventListener('change',scheduleEditorReadiness);
$('#productForm').addEventListener('invalid',event=>{event.preventDefault();queueMicrotask(()=>{showEditorIssue('save');const invalid=$('#productForm').querySelector(':invalid');if(invalid){for(let parent=invalid.parentElement;parent&&parent!==$('#productForm');parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;invalid.focus();invalid.scrollIntoView({block:'center'});}});},true);
const editorObserver=new MutationObserver(scheduleEditorReadiness);editorObserver.observe($('#skuRows'),{childList:true});for(const selector of ['#mainImageGallery','#detailImageGallery'])editorObserver.observe($(selector),{childList:true,subtree:true});for(const selector of ['#categorySelect','#brandSelect'])editorObserver.observe($(selector),{childList:true,attributes:true,attributeFilter:['disabled']});
const sourceLabel=$('#productForm').elements.source_url.closest('label');sourceLabel.insertBefore(Object.assign(document.createElement('span'),{className:'required-mark',textContent:' *'}),$('#productForm').elements.source_url);

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
 $('#skuHeaderRow').innerHTML=columns.map((name,i)=>'<th>'+esc(name)+(i<columns.length-2?' <span class="required-mark" aria-hidden="true">*</span>':'')+'</th>').join('');
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
$('#splitSupplierParameters').onclick=()=>{
 const form=$('#productForm'),container=$('#attributeRows');
 const rows=[...container.children].map(row=>({name:row.querySelector('[data-attribute-name]').value,value:row.querySelector('[data-attribute-value]').value}));
 const result=splitSupplierParameters(rows,form.elements.description.value);
 if(!result.changed){toast('未找到可拆分的合并参数');return;}
 container.replaceChildren();result.attributes.forEach(attributeRow);
 form.elements.description.value=result.description;
 toast('参数已拆分，请核对参数和商品详情后保存');
};
$('#addProductAttribute').onclick=()=>attributeRow();
$('#productAttributesFile').onchange=async event=>{
 try{const file=event.target.files[0];if(!file)return;if(file.size>2*1024*1024)throw Error('采集文件请小于 2 MB');const rows=productAttributesFromJSON($('#productForm').elements.source_url.value,JSON.parse(await file.text()));if($('#attributeRows').children.length&&!await actions.confirm('用文件中的产品参数替换当前参数？其他商品资料不变。'))return;$('#attributeRows').replaceChildren();rows.forEach(attributeRow);toast('已补充 '+rows.length+' 项产品参数，请核对后保存');}catch(error){toast(error.message);}finally{event.target.value='';}
};
let titleSuggestion=null,titleAIRequest=0;
const titleInput=$('#productForm').elements.title;
function titleAIStatus(message){
 const node=$('#productTitleAIStatus');node.textContent=message;node.hidden=!message;
}
function clearTitleSuggestion(){
 titleSuggestion=null;$('#productTitleAISuggestion').hidden=true;$('#productTitleAIText').textContent='';
}
function resetTitleAI(){
 titleAIRequest++;clearTitleSuggestion();titleAIStatus('');$('#optimizeProductTitle').disabled=false;
}
titleInput.addEventListener('input',resetTitleAI);
$('#discardProductTitle').onclick=()=>{clearTitleSuggestion();titleAIStatus('');};
$('#applyProductTitle').onclick=()=>{
 const proposal=titleSuggestion;
 if(!proposal||titleInput.value!==proposal.original||!$('#editor').open)return;
 titleInput.value=proposal.title;titleInput.dispatchEvent(new Event('input',{bubbles:true}));
 titleInput.focus();titleAIStatus('已填入建议标题，保存商品后生效。');
};
$('#optimizeProductTitle').onclick=async()=>{
 const original=titleInput.value,request=++titleAIRequest,button=$('#optimizeProductTitle');
 clearTitleSuggestion();
 if(!original.trim()){titleAIStatus('请先填写原商品标题。');titleInput.focus();return;}
 button.disabled=true;titleAIStatus('正在优化标题…');
 const current=()=>request===titleAIRequest&&$('#editor').open&&original===titleInput.value;
 try{
  const mapping=currentMapping();
  const brand=catalog?.brands?.find(b=>Number(b.id)===Number($('#brandSelect').value))?.label||'';
  const {title}=await api('/api/products/optimize-title','POST',{
   title:original,category:mapping.category,brand,
   description:$('#productForm').elements.description.value.slice(0,1000),
   specs:[...new Set(readSkuRows().map(row=>row.spec.trim().slice(0,100)).filter(Boolean))].slice(0,12),
   attributes:readProductAttributes().slice(0,12).map(({name,value})=>({name,value:value.slice(0,120)}))
  });
  if(!current())return;
  if(title===original.trim()){titleAIStatus('当前标题已清楚，AI 建议保留。');return;}
  titleSuggestion={original,title};$('#productTitleAIText').textContent=title;
  $('#productTitleAISuggestion').hidden=false;titleAIStatus('');
 }catch(error){if(current())titleAIStatus(error.message);}
 finally{if(request===titleAIRequest)button.disabled=false;}
};
function edit(p=null){resetTitleAI();editorImageGeneration++;editorImageBusy=0;$('#productForm').querySelector('button[type=submit]').disabled=false;$('#localImageStatus').textContent='';editing=p;editingMappings=new Map(productMallMappings(p||{}).map(m=>[m.catalog_connection_id,m]));$('#editorTitle').textContent=p?'编辑商品':'添加商品';const f=$('#productForm');f.reset();f.querySelectorAll('[data-editor-touched]').forEach(node=>delete node.dataset.editorTouched);$('#batchCostHint').textContent='成本 = 采购单价 + 每件分摊运费。整单运费请先按采购数量分摊；售价不会自动改变。';$('#attributeRows').replaceChildren();normalizeProductAttributes(p?.attributes).forEach(attributeRow);f.elements.catalog_target.value=p?.catalog_target||'crmeb-pro';fillCatalogMalls(p?.catalog_connection_id);activeMappingId=$('#catalogMall').value;if(p&&p.mall_mappings===undefined&&!editingMappings.has(activeMappingId))editingMappings.set(activeMappingId,productMallMappings({...p,catalog_connection_id:activeMappingId})[0]);f.elements.applicable_type.value=String(p?.applicable_type??0);$('#storeScopeField').classList.toggle('hidden',f.elements.catalog_target.value!=='crmeb-store');$('#batchPriceMode').onchange();for(const key of ['source_url','title','description'])f.elements[key].value=p?.[key]||'';f.elements.tag_ids.value=(p?.tag_ids||[]).join(',');f.elements.virtual_sales.value=p?.virtual_sales??0;f.elements.source_url.readOnly=!!p;f.elements.source_url.type=p?.supplier_import?'hidden':'url';f.elements.source_url.closest('label').classList.toggle('hidden',!!p?.supplier_import);f.elements.images.value=p?.images.join('\n')||'';f.elements.detail_images.value=(p?.detail_images||[]).join('\n');for(const field of Object.keys(imageFields))renderImageGallery(field);editingSpecNames=[...(p?.spec_names||[])];$('#specNames').value=editingSpecNames.join(', ');renderSkuHeader();$('#skuRows').innerHTML='';(p?.skus||[]).forEach(skuRow);$('#sourcingHint').textContent=p?.supplier_import?`供应商：${p.supplier_import.supplier}；货盘：${p.supplier_import.filename}；原分类：${p.supplier_import.category_hint||'无'}；采购箱规：${p.supplier_import.packaging||'未提供'}。` :p?.sourcing?`1688 采购参考价：${p.sourcing.purchase_price||'未提供'}；代发价：${p.sourcing.dropship_price||'未提供'}；来源类目：${p.sourcing.category||'未提供'}；来源标签：${p.sourcing.tags||'未提供'}；供应商销量：${p.sourcing.supplier_sales||'未提供'}（不计入商城销量）。请补充完整规格，再确认成本、售价与库存。`:'';renderMergeSources(p);$('#editor').showModal();$('#editor .form-body').scrollTop=0;updateEditorTop();renderMappingSummary();editorValidationAttempted=false;updateEditorReadiness();loadCatalogOptions(p).catch(e=>{$('#catalogStatus').textContent=e.message;});}
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
 $('#catalogStatus').textContent='正在从所选商城读取分类和品牌…';renderCatalogRecents();
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
 }catch(e){if(request===catalogRequest){catalogLoadFailed('category',categoryId);catalogLoadFailed('brand',brandId);$('#catalogStatus').textContent='读取商城选项失败，请点刷新重试：'+(e.name==='AbortError'?'商城响应超时':e.message);}}finally{clearTimeout(timer);if(request===catalogRequest)renderCatalogRecents();}
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
function recentCatalogScope(){return [me.user?.sub||'',state.team?.id||me.user?.sub||'',activeMappingId];}
function renderCatalogRecents(){for(const kind of ['category','brand']){const root=$('#'+kind+'Recent'),select=$('#'+kind+'Select'),rows=catalog?.[kind==='category'?'categories':'brands']||[],recent=select.disabled?[]:catalogHistory.list(recentCatalogScope(),kind,rows);root.replaceChildren();root.classList.toggle('hidden',!recent.length);if(!recent.length)continue;const caption=document.createElement('span');caption.textContent='最近选择';root.append(caption);for(const row of recent){const button=document.createElement('button');button.type='button';button.className='catalog-recent-choice';button.textContent=row.label;button.title=row.label+'（'+row.id+'）';button.dataset.recentId=row.id;button.setAttribute('aria-pressed',String(Number(select.value)===row.id));root.append(button);}const clear=document.createElement('button');clear.type='button';clear.className='text catalog-recents-clear';clear.textContent='清空';clear.dataset.clearRecent='1';clear.setAttribute('aria-label','清空此商城最近选择的'+(kind==='category'?'分类':'品牌'));root.append(clear);}}
for(const kind of ['category','brand']){
 $('#'+kind+'Select').addEventListener('change',()=>{const select=$('#'+kind+'Select');if(select.disabled)return;const row=catalog?.[kind==='category'?'categories':'brands']?.find(row=>Number(row.id)===Number(select.value));if(row)catalogHistory.remember(recentCatalogScope(),kind,row);rememberMapping();renderMappingSummary();renderCatalogRecents();});
 $('#'+kind+'Recent').onclick=event=>{const button=event.target.closest('button');if(!button)return;if(button.dataset.clearRecent){catalogHistory.clear(recentCatalogScope(),kind);renderCatalogRecents();return;}const id=Number(button.dataset.recentId),select=$('#'+kind+'Select'),rows=catalog?.[kind==='category'?'categories':'brands'];if(select.disabled||!rows?.some(row=>Number(row.id)===id))return;$('#'+kind+'Search').value='';filterCatalog(kind);select.value=String(id);select.dispatchEvent(new Event('change',{bubbles:true}));};
}
function currentMapping(){
 const f=$('#productForm'),old=editingMappings.get(activeMappingId)||{},categoryId=Number(f.elements.category_id.value)||0,brandId=Number(f.elements.brand_id.value)||0;
 const brand=catalog?.brands?.find(x=>x.id===brandId),category=catalog?.categories?.find(x=>x.id===categoryId);
 return {catalog_connection_id:activeMappingId,catalog_target:mallFor(activeMappingId)?.type||old.catalog_target||$('#catalogTarget').value,category_id:categoryId,category:category?.label||(categoryId===old.category_id?old.category:'')||'',brand_ids:brand?.ids||(brandId===old.brand_ids?.at(-1)?old.brand_ids:brandId?[brandId]:[]),tag_ids:f.elements.tag_ids.value.trim()?f.elements.tag_ids.value.trim().split(/[,，\s]+/).map(Number):[],...((mallFor(activeMappingId)?.type||old.catalog_target)==='crmeb-store'?{applicable_type:Number(f.elements.applicable_type.value)}:{})};
}
function rememberMapping(){if(!activeMappingId)return;if($('#categorySelect').disabled||$('#brandSelect').disabled)return;editingMappings.set(activeMappingId,currentMapping());}
function renderMappingSummary(){
 const rows=mallRows().filter(m=>m.configured||m.id===activeMappingId||editingMappings.has(m.id));
 $('#mallMappingSummary').innerHTML=rows.map(m=>{const saved=editingMappings.get(m.id),label=saved?.category_id?saved.category||'分类ID '+saved.category_id:'待选择分类',brand=saved?.brand_ids?.length?'品牌已设置':'不设置品牌';return '<button type="button" class="mapping-choice '+(m.id===activeMappingId?'active':'')+'" data-mapping-mall="'+esc(m.id)+'" aria-pressed="'+(m.id===activeMappingId)+'"><strong>'+esc(m.name)+'</strong><small>'+esc((m.system||m.type)+' · '+label+' · '+brand)+(m.configured?'':' · 连接待配置')+'</small></button>';}).join('');
}
function switchMapping(id){
 const mall=mallFor(id);if(!mall)return;rememberMapping();activeMappingId=mall.id;$('#catalogTarget').value=mall.type;fillCatalogMalls(mall.id);
 const mapping=editingMappings.get(mall.id)||{catalog_target:mall.type,catalog_connection_id:mall.id,category_id:0,category:'',brand_ids:[],tag_ids:[],applicable_type:0};
 const storeScope=$('#storeScopeField'),isMultiStore=mall.type==='crmeb-store',categoryRecent=$('#categoryRecent');
 storeScope.classList.toggle('hidden',!isMultiStore);
 const recentParent=isMultiStore?storeScope.parentElement:$('#categorySelect').closest('.catalog-field-group');
 if(categoryRecent.parentElement!==recentParent)recentParent.append(categoryRecent);const f=$('#productForm');f.elements.applicable_type.value=String(mapping.applicable_type??0);f.elements.tag_ids.value=(mapping.tag_ids||[]).join(',');renderMappingSummary();loadCatalogOptions(mapping);
}
$('#mallMappingSummary').onclick=event=>{const button=event.target.closest('[data-mapping-mall]');if(button)switchMapping(button.dataset.mappingMall);};
$('#catalogTarget').onchange=()=>{const target=$('#catalogTarget').value,id=mallRows().find(m=>m.type===target&&m.configured)?.id||mallFor(null,target)?.id;switchMapping(id);};
$('#catalogMall').onchange=()=>switchMapping($('#catalogMall').value);
for(const id of ['categorySelect','brandSelect'])$('#'+id).addEventListener('change',()=>{rememberMapping();renderMappingSummary();});
$('#refreshCatalog').onclick=()=>{
 rememberMapping();loadCatalogOptions(editingMappings.get(activeMappingId)||currentMapping(),true);
};
function updateMergeSelection(){const count=mergeSelected.size;$('#mergeSelectedCount').textContent='已选 '+count+' 条';const hasSupplier=state.products.some(p=>mergeSelected.has(p.id)&&p.supplier_import),hint=$('#mergeSelectionHint');
 $('#mergeProducts').disabled=count<2||count>20||hasSupplier;
 hint.textContent=!count?'':hasSupplier?'货盘商品请用「同款整理」。选两款及以上可仅合并货盘规格。':count<2?'再选一款同型号或同系列商品即可合并。':count>20?'合并最多选 20 款，请减少选中项。':'';
 hint.hidden=!hint.textContent;$('#sameStyleProducts').disabled=!state.products.some(p=>mergeSelected.has(p.id)&&p.supplier_import);$('#bulkProductSettings').disabled=!count;$('#clearMergeSelection').disabled=!count;}
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
 $('#batchPriceLabel').textContent=mode==='multiply'?'成本乘数（如 1.3）':mode==='percent'?'加价比例 %':mode==='add'?'每件加价 ¥':'统一售价 ¥';
 $('#batchPriceHint').textContent=(mode==='multiply'?'售价 = 每个规格成本 × 倍数，例如 13.2 × 1.3 = 17.16。':mode==='percent'?'售价 = 每个规格成本 ×（1 + 比例 ÷ 100），结果四舍五入到分。':'应用会更新下方全部规格的售价；点击「保存商品」后才会保存。')+($('#batchPriceEnding').value==='nine'?' 向上调整为 x.9，例如 17.16 → 17.90，17.95 → 18.90；不会低于计算金额。':'');
};
$('#batchPriceEnding').onchange=()=>$('#batchPriceMode').onchange();
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
$('#applyBatchCost').onclick=async()=>{
 try{const rows=[...$('#skuRows').children],inputs=rows.map(row=>row.querySelector('[data-key="cost"]')),result=batchCosts(inputs.map(input=>input.value),$('#batchCostValue').value,$('#batchCostFreight').value,$('#batchCostScope').value);if(!result.changed)throw Error('没有需要补填的成本；如需覆盖，请选择覆盖全部规格成本');
 const generation=editorImageGeneration;if(!await actions.confirm('将 '+result.changed+' 个规格的成本设为 ¥'+result.unitCost+'（采购单价＋每件分摊运费）？售价保持原值，保存商品后生效。'))return;
 if(generation!==editorImageGeneration||!$('#editor').open||rows.length!==$('#skuRows').children.length||rows.some((row,i)=>row!==$('#skuRows').children[i]))throw Error('商品或规格已变化，请重新核对成本');
 inputs.forEach((input,i)=>{input.value=result.values[i];});$('#batchCostHint').textContent='已设置 '+result.changed+' 个规格成本为 ¥'+result.unitCost+'，售价未变化，请检查后保存商品。';toast('成本已填入，请检查后保存商品');}catch(error){toast(error.message);}
};
$('#applyBatchPrice').onclick=()=>{
 try{
  const rows=[...$('#skuRows').children];
  const prices=batchPrices(rows.map(row=>row.querySelector('[data-key="cost"]').value),$('#batchPriceMode').value,$('#batchPriceValue').value,$('#batchPriceEnding').value);
  rows.forEach((row,i)=>{row.querySelector('[data-key="price"]').value=prices[i];});
  toast(`已设置 ${prices.length} 个规格的售价，请检查后保存商品`);
 }catch(e){toast(e.message);}
};
$('#productRows').onclick=async e=>{const b=e.target.closest('button');if(!b)return;try{if(b.dataset.openMerge){const p=state.products.find(p=>p.id===b.dataset.openMerge)||await api('/api/products/'+encodeURIComponent(b.dataset.openMerge));edit(p);}if(b.dataset.publications)showPublicationDetails(state.products.find(p=>p.id===b.dataset.publications));if(b.dataset.edit)edit(state.products.find(p=>p.id===b.dataset.edit));if(b.dataset.approve){const p=state.products.find(p=>p.id===b.dataset.approve);const {issues}=editorReadiness(p);if(issues.length){const messages=[...new Set(issues.map(issue=>issue.message))];toast('暂不能审核：'+messages.slice(0,3).join('；')+(messages.length>3?'；另有 '+(messages.length-3)+' 类问题':'')+'。请点击「编辑」补齐后再审核。',{error:true});return;}if(!await actions.confirm('确认图片、分类、所有规格与售价无误，将当前版本标记为审核通过？'))return;if(approvingProducts.has(p.id))return;approvingProducts.add(p.id);render();
try{await api('/api/products/'+p.id+'/approve','POST',{revision:p.revision});const current=state.products.find(row=>row.id===p.id&&row.revision===p.revision);if(current)current.status='approved';toast('审核通过，可以创建发布任务');}finally{approvingProducts.delete(p.id);render();}
void load().catch(()=>toast('审核已通过，列表刷新失败，请手动刷新。'));}if(b.dataset.publish){await loadImageStorageAvailability();openPublish(state.products.find(p=>p.id===b.dataset.publish));}}catch(e){toast(e.message);}};
$('#productForm').onsubmit=async e=>{e.preventDefault();if(updateEditorReadiness().save.length){showEditorIssue('save');return;}const b=e.submitter;b.disabled=true;try{const f=e.target,p={};if(editorImageBusy)throw Error('图片仍在上传，请等待完成后保存商品');for(const k of ['source_url','title','description'])p[k]=f.elements[k].value;p.attributes=readProductAttributes();const tags=f.elements.tag_ids.value.trim();p.tag_ids=tags?tags.split(/[,，\s]+/).map(Number):[];p.catalog_target=f.elements.catalog_target.value;p.catalog_connection_id=$('#catalogMall').value;if(p.catalog_target==='crmeb-store')p.applicable_type=Number(f.elements.applicable_type.value);p.category_id=Number(f.elements.category_id.value);p.category=catalog?.categories.find(x=>x.id===p.category_id)?.label||'';const brandId=Number(f.elements.brand_id.value);const brand=catalog?.brands.find(x=>x.id===brandId);if(brandId&&!brand&&brandId!==editingMappings.get(activeMappingId)?.brand_ids?.at(-1))throw Error('请刷新后选择有效商城品牌');p.brand_ids=brand?.ids||editingMappings.get(activeMappingId)?.brand_ids||[];rememberMapping();p.mall_mappings=[...editingMappings.values()];p.virtual_sales=Number(f.elements.virtual_sales.value);p.detail_images=f.elements.detail_images.value.split('\n').map(x=>x.trim()).filter(Boolean);p.images=f.elements.images.value.split('\n').map(x=>x.trim()).filter(Boolean);const pendingNames=$('#specNames').value.split(/[,，]/).map(v=>v.trim()).filter(Boolean);if(JSON.stringify(pendingNames)!==JSON.stringify(editingSpecNames))throw Error('请先点击应用规格列，再保存商品');p.skus=readSkuRows();if(editingSpecNames.length)p.spec_names=[...editingSpecNames];specificationMatrix(p);if(editing){p.revision=editing.revision;if(editing.sourcing)p.sourcing=editing.sourcing;}if(!editing)p.billing_revision=await confirmBilling('collect',1);await api(editing?'/api/products/'+editing.id:'/api/products',editing?'PUT':'POST',p);$('#editor').close();toast(editing?'商品已保存，待审核':'商品已保存为待整理');void load().catch(()=>toast('商品已保存，列表刷新失败，请手动刷新。'));}catch(e){toast(e.message);}finally{b.disabled=editorImageBusy>0;}};
$('#importButton').onclick=()=>{$('#importResult').textContent='';$('#importDialog').showModal();};$('#closeImport').onclick=()=>$('#importDialog').close();$('#importFile').onchange=async e=>{const file=e.target.files[0];if(file){if(file.size>2*1024*1024)return toast('文件请小于 2 MB');$('#importText').value=await file.text();}};
$('#importForm').onsubmit=async e=>{e.preventDefault();const button=e.submitter;button.disabled=true;try{const input=/^[\s\uFEFF]*[\[{]/.test($('#importText').value)?JSON.parse($('#importText').value.replace(/^\uFEFF/,'')):{table:$('#importText').value};input.billing_revision=await confirmBilling('collect',input.products?.length||100,false,input.table);const result=await api('/api/import','POST',input);$('#importResult').textContent=result.results.map(x=>`第 ${x.index+1} 件：${x.ok?'导入成功':x.error}`).join('\n');await load();toast(`成功导入 ${result.results.filter(x=>x.ok).length} 件商品`);}catch(error){toast(error.message);}finally{button.disabled=false;}};
$('#closePublish').onclick=()=>$('#publishDialog').close();
function openPublish(product){
 publishing=product;publishResults=new Map();publishUncertain=false;$('#publishTitle').textContent=product.title;$('#publishResults').replaceChildren();$('#publishSubmit').disabled=false;$('#publishSubmit').textContent='提交所选商城任务';
 const mappings=productMallMappings(product),rows=mallRows().filter(m=>m.configured);
 const available=new Set(imageStorageAvailability.filter(x=>x.available).map(x=>x.id));
 $('#publishTargets').innerHTML=rows.map(m=>{const mapping=mappings.find(x=>x.catalog_connection_id===m.id&&x.catalog_target===m.type),record=product.publications?.find(x=>x.mall_connection_id===m.id||!x.mall_connection_id&&x.target===m.type&&m.legacy),legacy=product.mall_mappings===undefined&&!product.category_id,ready=!!mapping?.category_id||legacy,locked=!!record&&!(record.status==='failed'&&record.can_republish===true),reason=record?.source==='manual_link'?'已关联商城商品 '+record.remote_id+'，跳过重复发布':locked?'已有'+(labels[record.status]||'发布')+'任务，请在任务列表核对或重试':ready?(mapping?.category||product.category||'兼容旧分类'):'尚未设置分类，请编辑商品';
 return '<div class="publish-choice"><input data-publish-mall type="checkbox" value="'+esc(m.id)+'" '+(ready&&!locked?'checked':'disabled')+'><span><strong>'+esc(m.name)+'</strong><small>'+esc(m.system+' · '+reason)+'</small><label class="image-transfer-choice"><input data-import-images="'+esc(m.id)+'" type="checkbox" '+(available.has(m.id)&&ready&&!locked?'':'disabled')+'>转存图片到OPS存储'+(available.has(m.id)?'（默认关闭）':'（未配置或域名未授权）')+'</label></span></div>';}).join('')||'<p class="hint">请先配置商城连接。</p>';
 $('#publishSubmit').disabled=!$('#publishTargets').querySelectorAll('input[data-publish-mall]:checked:not(:disabled)').length;$('#publishDialog').showModal();refreshPublishQuote();
}
$('#publishTargets').onchange=()=>{refreshPublishQuote();clearDialogFeedback($('#publishDialog'));$('#publishSubmit').disabled=publishUncertain||!$('#publishTargets').querySelectorAll('input[data-publish-mall]:checked:not(:disabled)').length;};
$('#publishForm').onsubmit=async event=>{
 event.preventDefault();const button=event.submitter;button.disabled=true;clearDialogFeedback($('#publishDialog'));let uncertain=false;
 try{const checked=[...$('#publishTargets').querySelectorAll('input[data-publish-mall]:checked:not(:disabled)')];if(!checked.length)throw Error('请至少选择一个已设置分类的商城');
 const destinations=checked.map(input=>({connection_id:input.value,target:mallFor(input.value)?.type,import_images:!![...$('#publishTargets').querySelectorAll('[data-import-images]')].find(x=>x.dataset.importImages===input.value)?.checked}));
 const billing_revision=await confirmBilling('publish',destinations.length,destinations.some(d=>d.import_images));let result;try{result=await api('/api/products/'+publishing.id+'/publish','POST',{revision:publishing.revision,destinations,billing_revision});}catch(error){if(error.httpStatus&&error.httpStatus<500)throw error;uncertain=true;throw Error('提交结果未确认，请先刷新发布任务列表核对，避免重复提交。'+error.message);}
 if(!Array.isArray(result.results)||result.results.length!==destinations.length||new Set(result.results.map(r=>r.connection_id)).size!==destinations.length||result.results.some(r=>!destinations.some(d=>d.connection_id===r.connection_id)||typeof r.ok!=='boolean')){uncertain=true;throw Error('提交回执不完整，请先核对发布任务列表，未自动重试。');}
 for(const row of result.results){publishResults.set(row.connection_id,row);if(row.ok){const input=[...$('#publishTargets').querySelectorAll('input')].find(x=>x.value===row.connection_id);if(input){input.checked=false;input.disabled=true;}const transfer=[...$('#publishTargets').querySelectorAll('[data-import-images]')].find(x=>x.dataset.importImages===row.connection_id);if(transfer)transfer.disabled=true;}}
 $('#publishResults').innerHTML=[...publishResults.values()].map(row=>'<p class="dialog-feedback '+(row.ok?'':'is-error')+'"><strong>'+esc(mallFor(row.connection_id)?.name||row.target)+'</strong> · '+esc(row.ok?'任务已创建，请在发布任务查看执行结果':row.error)+'</p>').join('');
 button.textContent=[...publishResults.values()].some(r=>!r.ok)?'重试未提交商城':'提交所选商城任务';await load();
 }catch(error){toast(error.message,{error:true});}finally{publishUncertain=uncertain;button.disabled=uncertain||!$('#publishTargets').querySelectorAll('input[data-publish-mall]:checked:not(:disabled)').length;}
};
$('#refresh').onclick=()=>load().catch(e=>toast(e.message));$('#logout').onclick=async()=>{try{await api('/auth/logout','POST',{});location.reload();}catch(e){toast(e.message);}};
async function init(){try{me=await api('/api/me');applyBranding(me.branding);$('#adminNav').classList.toggle('hidden',!me.systemAdmin);$('#systemSettingsNav').classList.toggle('hidden',!me.systemAdmin);$('#usersNav').classList.toggle('hidden',!me.systemAdmin);$('#systemVersion').disabled=!me.user;$('#systemVersion').textContent=me.system?`系统 v${me.system.version} · ${me.system.build}`:'系统版本未知';$('#mode').textContent=me.demo?'本地演示 · 不执行发布':'内部运营空间';if(!me.user){$('#login').classList.remove('hidden');$('#loginHint').textContent=me.demo?'演示模式仅限本机，所有数据保存在本机数据库。':me.authReady?'使用你的统一账号继续。':'服务已启动，等待管理员配置 Casdoor 应用和账号允许名单。';if(new URLSearchParams(location.search).get('access')==='pending')$('#loginHint').textContent='访问申请已提交，请等待管理员授权。授权后请重新登录。';return;}$('#username').textContent=me.user.name;$('#logout').classList.remove('hidden');$('#workspace').classList.remove('hidden');watchSession();assetPanel.start();refreshSetupShortcut();await load();setInterval(()=>{if($('#publicationDialog').open&&!publicationVerifying&&!document.querySelector('dialog[open]:not(#publicationDialog)'))refreshPublicationDialog().catch(()=>{});else if(page==='jobs'&&document.querySelector('dialog[open]'))loadJobPage().then(()=>renderStats()).catch(()=>{});else if(['products','jobs'].includes(page)&&!document.querySelector('dialog[open]'))load().catch(()=>{});},10000);}catch(e){if(e.code==='OPS_ACCESS_DISABLED'){$('#login').classList.remove('hidden');$('#loginHint').textContent=e.message;}else toast(e.message);}}
init();

$('#jobRows').addEventListener('error',event=>{if(event.target.matches('.job-product-thumb img'))event.target.remove();},true);
let jobVerifyGeneration=0;
function jobVerifyFeedback(message){
 const node=$('#jobVerifyFeedback');node.hidden=false;node.textContent=message;
}
async function verifyJob(jobId,candidate,feedback=jobVerifyFeedback,onQueued=()=>{}){
 const generation=++jobVerifyGeneration,path='/api/jobs/'+jobId+'/verify',prefix='商品 ID '+candidate+'：';
 feedback(prefix+'正在提交核对…');
 try{await api(path,'POST',{remote_id:candidate},AbortSignal.timeout(25000));}
 catch(e){if(generation===jobVerifyGeneration)feedback(prefix+'提交未确认：'+e.message);throw e;}
 if(generation!==jobVerifyGeneration)return;
 feedback(prefix+'已提交，等待核对结果…');onQueued();
 const deadline=Date.now()+120000;
 while(generation===jobVerifyGeneration){
  try{
   const result=await api(path,'GET',undefined,AbortSignal.timeout(8000));
   if(generation!==jobVerifyGeneration)return;
   if(result.candidate_id!==candidate){feedback(prefix+'核对已被另一条请求替换。');return;}
   feedback(prefix+(labels[result.status]||result.status)+' · '+(result.message||'暂无详情'));
   if(result.status!=='verifying'){if(feedback===jobVerifyFeedback)load().catch(()=>{});return;}
  }catch(e){if(generation!==jobVerifyGeneration)return;feedback(prefix+'暂时无法读取核对状态，正在重试…');}
  if(Date.now()>=deadline){feedback(prefix+'仍未收到核对结果。请刷新查看最新状态；如仍卡住，请检查 Worker 或 n8n 执行记录后再核对。');return;}
  await new Promise(resolve=>setTimeout(resolve,2500));
 }
}
$('#jobRows').onclick=async e=>{const b=e.target.closest('button');if(!b)return;try{if(b.dataset.recoverYunzhong){const r=await api('/api/jobs/'+b.dataset.recoverYunzhong+'/recover-uncreated','POST',{});toast(r.message);}if(b.dataset.recoverStock){const r=await api('/api/jobs/'+b.dataset.recoverStock+'/recover-zero-stock','POST',{});toast(r.message);}if(b.dataset.verify){const id=await actions.prompt('从商城仓库找到任务编码对应的商品，输入数字商品 ID。此操作只读取详情核对，不会再次创建商品。');if(id===null)return;await verifyJob(b.dataset.verify,id.trim());return;}if(b.dataset.retry){if(!await actions.confirm('仅重发尚未领取创建操作的任务；已领取的创建操作不会被重复执行。继续？'))return;await api('/api/jobs/'+b.dataset.retry+'/retry','POST',{});toast('已重发同一任务');}await load();}catch(e){toast(e.message);}};

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
 try{await api('/api/team','POST',{name:$('#teamName').value.trim()});await load();await loadTeam();refreshSetupShortcut(true);toast('团队已创建，你的商品和任务已并入共享工作区');}catch(e){toast(e.message);}finally{button.disabled=false;}
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

$('#collectionSource').onchange=()=>{$('#collectionSupplier').value='';productPage=1;render();};
$('#collectionSupplier').onchange=()=>{productPage=1;render();};
$('#resetCollectionFilters').onclick=()=>{
 $('#collectionSource').value='';$('#collectionSupplier').value='';$('#search').value='';$('#showStyleSources').checked=false;
 document.querySelector('[data-filter="all"]').click();
};
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
function supplierRender(batch){clearTimeout(supplierPoll);const pending=['queued','parsing'].includes(batch.state),busy=pending||batch.state==='processing';if(supplierBatch?.id!==batch.id)supplierDraftMappings=new Map();supplierBatch=batch;$('#retrySupplierAI').hidden=!!batch.plan||!(batch.state==='parse_failed'||batch.state==='ready'&&batch.products.some(p=>p.bounds));$('#supplierIssuesFilter').hidden=!batch.products.some(p=>p.warnings.length||p.publication_candidates?.length);$('#supplierIssuesOnly').checked=false;$('#supplierMapping').hidden=!!batch.plan||!['ready','parse_failed'].includes(batch.state);$('#supplierMappingFields').replaceChildren();$('#bulkSupplierSettings').disabled=!!batch.plan;for(const id of ['supplierBulkStock','supplierStockScope','supplierStockMode','applySupplierStock'])$('#'+id).disabled=!!batch.plan;$('#supplierStatus').classList.remove('is-error');$('#commitSupplier').textContent=batch.state==='processing'?'正在上传图片并导入…':batch.state==='done'?'导入完成':batch.state==='partial'?'重试失败商品':'导入已确认商品到采集箱';$('#parseSupplier').disabled=busy;sessionStorage.setItem('ops-supplier-batch',batch.id);const assets=new Map(batch.assets.map(a=>[a.id,a.url])),locked=!!batch.plan;$('#commitSupplier').disabled=busy||batch.state==='done'||batch.state==='parse_failed';$('#discardSupplier').disabled=busy;$('#supplierPreview').innerHTML=batch.products.map((p,i)=>{const plan=batch.plan?.find(x=>x.key===p.key),done=batch.results.find(x=>x.key===p.key),skus=plan?.skus||(p.barcodes.length?p.barcodes:['']).map(code=>({barcode:code,spec:p.barcodes.length>1?'':p.spec_hint||'默认',cost:p.cost??'',price:p.price??'',stock:''}));return '<article class="supplier-card" data-supplier-index="'+i+'" data-supplier-issue="'+((p.warnings.length||p.publication_candidates?.length)?'yes':'no')+'" data-supplier-published="'+(p.existing_product?.publications.length?'yes':'no')+'"><label class="supplier-card-choice"><input data-confirm type="checkbox" title="勾选表示已核对商品及 SKU" '+(plan?'checked':'')+' '+(locked||p.existing_product?'disabled':'')+'><span>'+esc(plan?.title||p.title)+'</span><small>'+esc(p.sheet+' · 第'+p.row+'行')+'</small></label>'+(p.existing_product?'<div class="supplier-existing"><small>'+esc(p.existing_product.publications.length?'已发布：'+p.existing_product.publications.map(j=>(mallFor(j.mall_connection_id)?.name||j.target)+(j.remote_id?' #'+j.remote_id:'')).join('、'):'已在采集箱')+'</small> <button type="button" class="text" data-open-supplier-product="'+esc(p.existing_product.id)+'">打开原商品</button></div>':'')+(p.publication_candidates?.length?'<div class="supplier-existing"><small>疑似已发布 · 货盘条码与已发布商品 SKU 一致，请核对</small> '+p.publication_candidates.map(c=>'<button type="button" class="text" data-open-supplier-product="'+esc(c.id)+'">'+esc(c.title||'查看候选商品')+'</button>').join(' ')+'</div>':'')+'<details class="supplier-card-detail"><summary>查看 / 编辑 · '+skus.length+' 个 SKU'+(p.warnings.length?' · '+p.warnings.length+' 项提示':'')+'</summary>'+'<div class="supplier-pictures">'+p.images.map(id=>'<img loading="lazy" src="'+esc(assets.get(id))+'" alt="原表嵌入图片">').join('')+'</div><label>商品名称<input data-title value="'+esc(plan?.title||p.title)+'" '+(locked?'disabled':'')+'></label><small>'+esc(p.category_hint+' · '+p.sheet+' 第'+p.row+'行')+'</small><p class="hint">'+esc(p.warnings.join('；'))+'</p>'+(p.review_refs?'<small>'+esc(Object.entries(p.review_refs).filter(([,refs])=>refs.length).map(([field,refs])=>({title_lines:'完整名称',title_zh:'中文名',title_en:'英文名',spec:'规格',attributes:'属性',notes:'补充说明'}[field])+'：'+refs.join('、')).join('；'))+'</small>':'')+'<p>'+esc(p.attributes.map(a=>a.name+'：'+a.value).join('；'))+'</p>'+(p.description?'<details><summary>查看原表商品描述</summary><p>'+esc(p.description)+'</p></details>':'')+'<p class="supplier-mapping-summary">'+esc((plan?.mall_mappings||supplierDraftMappings.get(p.key)||[]).map(m=>(mallFor(m.catalog_connection_id)?.name||'商城')+'：'+(m.category||'未设分类')+' / 品牌ID '+(m.brand_ids?.join(',')||'未设')).join('；')||'尚未设置商城分类和品牌')+'</p><small>箱规：'+esc(p.packaging||'未提供')+'</small><div class="supplier-skus">'+skus.map(s=>supplierSkuRow(s,locked)).join('')+'</div><button type="button" class="text" data-add-supplier-sku '+(locked?'disabled':'')+'>＋新增SKU</button><small>原表条码参考：'+esc(p.barcodes.join('、')||'未提供')+'（不随增减修改）</small>'+(done?'<p class="hint">'+esc(done.ok?(done.duplicate?'已存在，跳过重复商品':'已导入为待整理商品'):done.error)+'</p>':'')+'</details></article>';}).join('');$('#supplierUnselectedOnly').checked=false;$('#supplierUnpublishedOnly').checked=false;refreshSupplierSelection();$('#supplierStatus').textContent=(batch.state==='parse_failed'?'':'识别 '+batch.products.length+' 件商品 · ')+({queued:batch.ai_retry?'等待 AI 重试，可关闭窗口':'已上传，等待后台解析，可关闭窗口',parsing:batch.error||'后台解析中，可关闭窗口稍后查看',parse_failed:batch.error||'解析失败，请删除后重新上传',ready:batch.error|| (batch.ai?.layout?'使用 AI 建议列生成 · 请核对字段与价格':batch.ai?('本地解析 '+batch.ai.local+' 件 · AI 补全 '+batch.ai.recognized+' 件 · '+batch.ai.unresolved+' 件保留原结果'):'原表解析完成 · 未调用 AI · 核对后勾选'),processing:'正在上传图片并导入…',done:'本次导入完成',partial:'部分失败，点击导入按钮可重试原批次'}[batch.state]||'可重试原批次');renderSupplierProgress(batch);if(batch.state==='parse_failed' && /未识别到商品/.test(batch.error||'')){ $('#supplierMapping').open=true; $('#supplierReadLayout').click(); }
if(['queued','parsing','processing'].includes(batch.state))pollSupplierBatch(batch.id);}
function renderSupplierProgress(batch){
 const panel=$('#supplierProgressPanel'),bar=$('#supplierProgress'),label=$('#supplierProgressText'),total=batch.plan?.length||0;
 panel.hidden=!total&&!['queued','parsing'].includes(batch.state);
 if(!total){bar.removeAttribute('value');label.textContent=batch.state==='queued'?'等待后台解析':batch.error||'正在解析表格';return;}
 const keys=new Set(batch.plan.map(item=>item.key)),results=batch.results.filter(item=>keys.has(item.key)),success=results.filter(item=>item.ok&&!item.duplicate).length,duplicates=results.filter(item=>item.ok&&item.duplicate).length;
 bar.max=total;bar.value=results.length;
 label.textContent='已处理 '+results.length+' / '+total+' 件 · 新增 '+success+' · 重复跳过 '+duplicates+' · 失败 '+(results.length-success-duplicates);
}
function pollSupplierBatch(id,delay=1500){
 supplierPoll=setTimeout(async()=>{
  try{
   const batch=await api('/api/supplier-imports/'+id);if(supplierBatch?.id!==id)return;
   supplierRender(batch);
   if(['done','partial'].includes(batch.state))await load();
  }catch(e){
   if(supplierBatch?.id!==id)return;
   if(['queued','parsing','processing'].includes(supplierBatch.state)){
    supplierFeedback('暂时无法读取进度，将自动重试。'+e.message,true);pollSupplierBatch(id,4000);
   }else supplierFeedback('导入结果已收到，但采集箱刷新失败：'+e.message,true);
  }
 },delay);
}
function refreshSupplierSelection(){
 const cards=[...$('#supplierPreview').querySelectorAll('[data-supplier-index]')],selected=cards.filter(card=>card.querySelector('[data-confirm]').checked).length,locked=!!supplierBatch?.plan;
 $('#supplierSelection').hidden=!cards.length;
 $('#supplierSelectedCount').textContent='已选 '+selected+' / '+cards.length;
 $('#supplierSelectAll').disabled=locked||!cards.some(card=>card.querySelector('[data-confirm]:not(:disabled):not(:checked)'));
 $('#supplierClearAll').disabled=locked||!selected;
 const only=$('#supplierUnselectedOnly').checked;
 for(const card of cards)card.hidden=(only&&card.querySelector('[data-confirm]').checked)||($('#supplierUnpublishedOnly').checked&&card.dataset.supplierPublished==='yes')||($('#supplierIssuesOnly').checked&&card.dataset.supplierIssue!=='yes');
 if(supplierBatch?.state==='ready'&&!locked)$('#commitSupplier').disabled=!selected;
}
$('#supplierPreview').addEventListener('change',event=>{if(event.target.matches('[data-confirm]'))refreshSupplierSelection();else if(event.target.matches('[data-title]'))event.target.closest('article').querySelector('.supplier-card-choice span').textContent=event.target.value;});
$('#supplierPreview').addEventListener('click',event=>{if(event.target.closest('[data-add-supplier-sku],[data-remove-supplier-sku]'))refreshSupplierSelection();});
$('#supplierIssuesOnly').onchange=refreshSupplierSelection;
$('#supplierUnselectedOnly').onchange=refreshSupplierSelection;
$('#supplierUnpublishedOnly').onchange=refreshSupplierSelection;
$('#supplierPreview').addEventListener('click',async event=>{
 const button=event.target.closest('[data-open-supplier-product]');if(!button||button.disabled)return;
 button.disabled=true;
 try{const product=await api('/api/products/'+encodeURIComponent(button.dataset.openSupplierProduct));edit(product);}
 catch(error){supplierFeedback(error.message,true);}finally{button.disabled=false;}
});
async function selectSupplierCards(checked){
 const batch=supplierBatch;if(!batch||batch.plan)return;
 if(checked&&!await actions.confirm('将全部商品标记为已核对？请先确认商品与 SKU 对应无误。'))return;
 if(supplierBatch!==batch||batch.plan)return;
 for(const box of $('#supplierPreview').querySelectorAll('[data-confirm]:not(:disabled)'))box.checked=checked;
 refreshSupplierSelection();
}
$('#supplierSelectAll').onclick=()=>selectSupplierCards(true);
$('#supplierClearAll').onclick=()=>selectSupplierCards(false);
const supplierColumns={title:'商品名称',images:'商品图片',barcode:'条码',cost:'采购成本',price:'日常售价',model:'规格',category:'分类',packaging:'箱规',description:'描述',dimensions:'尺寸',weight:'重量',specifications:'产品参数',ingredients:'成分 / 材质',accessories:'配件'};
$('#supplierReadLayout').onclick=async()=>{
 const id=supplierBatch?.id,button=$('#supplierReadLayout'),fields=$('#supplierMappingFields');if(!id)return;
 button.disabled=true;
 try{
  const sheets=await api('/api/supplier-imports/'+id+'/layout');if(supplierBatch?.id!==id)return;
  fields.innerHTML='<label>工作表<select data-layout-sheet>'+sheets.map((s,i)=>'<option value="'+i+'">'+esc(s.sheet)+'</option>').join('')+'</select></label><label>首个商品行<input type="number" min="1" max="1048576" value="2" data-layout-start></label><label>最后一个商品行（可留空）<input type="number" min="1" max="1048576" data-layout-end></label><label>商品排列<select data-layout-grouping><option value="">一行一个商品</option><option value="repeated_header">多行一个商品（重复表头分组）</option></select></label><div data-layout-cols></div><button type="button" data-layout-template>套用已存模板</button><label><input type="checkbox" data-layout-remember>预览成功后保存为此供应商的模板</label><button type="button" data-layout-apply>按所选列重新预览</button>';
  const sheet=()=>sheets[Number(fields.querySelector('[data-layout-sheet]').value)];
  const draw=()=>{
   const start=Number(fields.querySelector('[data-layout-start]').value),rows=Object.entries(sheet()?.rows||{}),letters=n=>n>26?'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[Math.floor((n-1)/26)-1]+'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[(n-1)%26]:'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[n-1];
   const options=Array.from({length:100},(_,i)=>{const n=i+1,headers=rows.filter(([r])=>Number(r)<start).slice(-3).map(([,cells])=>cells[n]).filter(Boolean);const samples=rows.filter(([r])=>Number(r)>=start).map(([,cells])=>cells[n]).filter(Boolean).slice(0,2);return '<option value="'+n+'">'+letters(n)+(headers.length?' · '+esc(headers.join(' / ')):'')+(samples.length?'（'+esc(samples.join(' / '))+'）':'')+'</option>';}).join('');
   fields.querySelector('[data-layout-cols]').innerHTML=Object.entries(supplierColumns).map(([key,label])=>'<label>'+label+'<select data-layout-field="'+key+'"><option value="">不选择</option>'+options+'</select></label>').join('');
  };
  fields.querySelector('[data-layout-sheet]').onchange=draw;fields.querySelector('[data-layout-start]').onchange=draw;draw();
  const templateKey='ops-supplier-template:'+JSON.stringify([me.user?.sub,state.team?.id||'',supplierBatch.supplier.trim().toLowerCase()]);
  const signature=(tab,start)=>{
   if(!tab||!Number.isInteger(start)||start<2||start>31)return '';
   const rows=Object.entries(tab.rows).filter(([r])=>Number(r)<start).slice(-3);
   return rows.length?JSON.stringify(rows):'';
  };
  fields.querySelector('[data-layout-template]').onclick=()=>{
   try{
    const saved=JSON.parse(localStorage.getItem(templateKey)||'null');
    if(!saved)throw Error('此供应商在当前浏览器还没有保存模板。');
    const tab=sheet(),match=signature(tab,saved.start_row);
    if(!match||match!==saved.signature)throw Error('当前工作表的表头和模板不同，请重新核对并选列。');
    fields.querySelector('[data-layout-start]').value=saved.start_row;
    fields.querySelector('[data-layout-grouping]').value=saved.grouping;draw();
    for(const select of fields.querySelectorAll('[data-layout-field]'))select.value=String(saved.columns[select.dataset.layoutField]??'');
    supplierFeedback('已套用模板，请检查最后一个商品行并重新预览。');
   }catch(error){supplierFeedback(error.message,true);}
  };
  fields.querySelector('[data-layout-apply]').onclick=async e=>{
   const columns=Object.fromEntries([...fields.querySelectorAll('[data-layout-field]')].filter(el=>el.value).map(el=>[el.dataset.layoutField,Number(el.value)]));
   if(!columns.title)return supplierFeedback('请根据样例选择商品名称列。',true);
   if(supplierBatch?.id!==id)return;
   const start_row=Number(fields.querySelector('[data-layout-start]').value),end_row=Number(fields.querySelector('[data-layout-end]').value)||undefined;
   e.currentTarget.disabled=true;const apply=e.currentTarget;
   const grouping=fields.querySelector('[data-layout-grouping]').value,remember=fields.querySelector('[data-layout-remember]').checked,tab=sheet(),header=signature(tab,start_row);
   try{
    supplierFeedback('正在按所选列重新解析…');
    const batch=await api('/api/supplier-imports/'+id+'/mapping','POST',{sheet:tab.sheet,start_row,end_row,columns,grouping});
    if(supplierBatch?.id===id){
     supplierDraftMappings=new Map();supplierRender(batch);
     if(remember){
      try{if(!header)throw Error();localStorage.setItem(templateKey,JSON.stringify({signature:header,start_row,columns,grouping}));supplierFeedback('预览已更新，模板已保存在当前浏览器。');}
      catch{supplierFeedback('预览已更新，但未能保存模板；请确认表头在前 30 行且浏览器允许本地存储。',true);}
     }
    }
   }catch(error){supplierFeedback(error.message,true);}finally{apply.disabled=false;}
  };
 }catch(error){supplierFeedback(error.message,true);}finally{button.disabled=false;}
};
const supplierManager=$('#supplierManagePreviews');
async function loadSupplierPreviews(){
 const list=$('#supplierPreviewList');list.textContent='正在读取预览…';
 try{
  const {previews,limit}=await api('/api/supplier-imports');
  const status={queued:'排队中',parsing:'识别中',processing:'导入中',ready:'待核对',done:'已导入',partial:'部分导入',parse_failed:'解析失败'};
  list.innerHTML='<p>'+previews.length+' / '+limit+' 份预览</p>'+previews.map(p=>{
   const current=p.id===supplierBatch?.id;
   return '<p>'+esc(p.filename+' · '+(status[p.state]||p.state)+' · '+new Date(p.created).toLocaleString())+(current?' · 当前预览':'')+(!current&&p.deletable?' <button type="button" class="text" data-delete-preview="'+esc(p.id)+'">删除</button>':'')+'</p>';
  }).join('');
 }catch(error){list.textContent=error.message;}
}
supplierManager.addEventListener('toggle',()=>{if(supplierManager.open)loadSupplierPreviews();});
$('#supplierPreviewList').addEventListener('click',async e=>{
 const button=e.target.closest('[data-delete-preview]');if(!button)return;
 const id=button.dataset.deletePreview;
 if(id===supplierBatch?.id||!await actions.confirm('删除这份旧预览？已导入的商品不受影响。')||id===supplierBatch?.id)return;
 button.disabled=true;
 try{await api('/api/supplier-imports/'+id,'DELETE');await loadSupplierPreviews();supplierFeedback('旧预览已删除，可以重新点击「读取货盘并预览」。');}
 catch(error){supplierFeedback(error.message,true);button.disabled=false;}
});
$('#supplierImportButton').onclick=async()=>{$('#supplierDialog').showModal();updateSupplierTop();const id=sessionStorage.getItem('ops-supplier-batch');if(id&&!supplierBatch){try{supplierRender(await api('/api/supplier-imports/'+id));}catch{sessionStorage.removeItem('ops-supplier-batch');}}};
$('#closeSupplier').onclick=()=>$('#supplierDialog').close();
$('#supplierUploadForm').onsubmit=async e=>{
 e.preventDefault();if(['queued','parsing','processing'].includes(supplierBatch?.state))return;
 const file=$('#supplierFile').files[0];if(!file)return;if(file.size>500*1024*1024)return toast('文件请小于500MB');
 $('#parseSupplier').disabled=true;let pending;try{pending=JSON.parse(sessionStorage.getItem('ops-supplier-upload')||'null');}catch{}
 const supplier=$('#supplierName').value,identity=[file.name,file.size,file.lastModified,supplier].join('|');
 try{
  if(pending&&pending.identity!==identity)throw Error('还有未完成的上传，请重新选择原文件继续，或点击取消上传');
  if(!pending){supplierFeedback('正在申请OSS上传授权…');const upload=await api('/api/supplier-imports/uploads','POST',{supplier,filename:file.name,size:file.size});pending={...upload,identity,parts:[]};sessionStorage.setItem('ops-supplier-upload',JSON.stringify(pending));}
  $('#cancelSupplierUpload').disabled=false;
  for(let number=pending.parts.length+1;number<=Math.ceil(file.size/pending.partBytes);number++){
   const start=(number-1)*pending.partBytes,blob=file.slice(start,Math.min(file.size,start+pending.partBytes));let etag;
   for(let attempt=0;attempt<3;attempt++){try{const signed=await api('/api/supplier-imports/uploads/'+pending.id+'/sign','POST',{part:number});etag=await new Promise((resolve,reject)=>{const xhr=new XMLHttpRequest();xhr.open('PUT',signed.url);for(const [key,value]of Object.entries(signed.headers))xhr.setRequestHeader(key,value);xhr.timeout=180000;xhr.upload.onprogress=e=>supplierFeedback('直传OSS '+Math.floor((start+e.loaded)/file.size*100)+'% · 分片 '+number);xhr.onerror=()=>reject(Error('OSS连接失败，请检查Bucket跨域CORS配置'));xhr.ontimeout=()=>reject(Error('分片上传超时'));xhr.onload=()=>{const tag=xhr.getResponseHeader('ETag');if(xhr.status>=200&&xhr.status<300&&tag)resolve(tag);else reject(Error('OSS分片上传失败 HTTP '+xhr.status+'，请检查CORS是否暴露ETag'));};xhr.send(blob);});break;}catch(error){if(attempt===2)throw error;await new Promise(r=>setTimeout(r,1000*(attempt+1)));}}
   pending.parts.push({number,etag});sessionStorage.setItem('ops-supplier-upload',JSON.stringify(pending));
  }
  supplierFeedback('上传完成，正在核对文件并提交后台解析…');const result=await api('/api/supplier-imports/uploads/'+pending.id+'/complete','POST',{parts:pending.parts});sessionStorage.removeItem('ops-supplier-upload');$('#cancelSupplierUpload').disabled=true;supplierRender(await api('/api/supplier-imports/'+result.id));
 }catch(error){if(error.message.includes('最多保留5份货盘预览')){if(supplierManager.open)loadSupplierPreviews();else supplierManager.open=true;supplierFeedback('预览已满，请在「管理预览」删除一份旧预览后再试。',true);}else supplierFeedback(error.message+'；未完成上传可重新选择同一文件后继续。',true);}finally{$('#parseSupplier').disabled=['queued','parsing','processing'].includes(supplierBatch?.state);}
};
$('#cancelSupplierUpload').onclick=async()=>{try{const pending=JSON.parse(sessionStorage.getItem('ops-supplier-upload')||'null');if(!pending)return supplierFeedback('没有未完成上传');if($('#parseSupplier').disabled)return supplierFeedback('请等待当前上传结束或报错后再取消',true);await api('/api/supplier-imports/uploads/'+pending.id,'DELETE');sessionStorage.removeItem('ops-supplier-upload');$('#cancelSupplierUpload').disabled=true;supplierFeedback('已取消上传并清理分片');}catch(error){supplierFeedback(error.message,true);}};

function supplierFeedback(message,error=false){const status=$('#supplierStatus');status.textContent=message;status.classList.toggle('is-error',error);}
function supplierSelectedItems(){
 const cards=[...$('#supplierPreview').querySelectorAll('[data-supplier-index]')].filter(el=>el.querySelector('[data-confirm]').checked);
 if(!cards.length)throw Error('请先核对并勾选至少一件商品。');
 return cards.map(el=>{
  const title=el.querySelector('[data-title]');
  const invalid=(input,message)=>{const detail=el.querySelector('.supplier-card-detail');if(detail)detail.open=true;input.focus();input.scrollIntoView({block:'center'});throw Error(message);};
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
 try{const items=supplierBatch.plan||supplierSelectedItems();supplierFeedback('正在提交 '+items.length+' 件商品，随后上传图片并导入，请稍候…');const billing_revision=await confirmBilling('collect',items.length,true);const batch=await api('/api/supplier-imports/'+supplierBatch.id+'/commit','POST',{items,billing_revision});supplierRender(batch);if(batch.state==='processing')button.textContent='正在上传图片并导入…';}
 catch(e){supplierFeedback(e.message,true);button.disabled=false;}
 finally{if(supplierBatch?.state!=='processing')button.textContent='导入已确认商品到采集箱';}
};
$('#retrySupplierAI').onclick=async()=>{
 const batch=supplierBatch,button=$('#retrySupplierAI');if(!batch||button.disabled)return;
 const keys=batch.state==='ready'?[...$('#supplierPreview').querySelectorAll('[data-supplier-index]')].filter(card=>card.querySelector('[data-confirm]').checked).map(card=>batch.products[Number(card.dataset.supplierIndex)].key):[];
 const count=keys.length||batch.ai_candidates;
 if(batch.state==='ready'&&!count)return supplierFeedback('请先勾选需要 AI 复核的商品。',true);
 const scope=batch.state==='parse_failed'?'尝试识别表头':'复核 '+count+' 个商品块';
 button.disabled=true;
 try{
  if(!await actions.confirm('使用 NewAPI '+scope+'？模型调用可能产生费用；重试后会重新显示预览，请先完成本次识别再编辑。')||batch!==supplierBatch)return;
  supplierRender(await api('/api/supplier-imports/'+batch.id+'/ai-retry','POST',{keys}));
 }catch(error){supplierFeedback(error.message,true);}
 finally{button.disabled=false;}
};
$('#discardSupplier').onclick=async()=>{if(!supplierBatch)return;try{await api('/api/supplier-imports/'+supplierBatch.id,'DELETE');supplierBatch=null;$('#supplierProgressPanel').hidden=true;$('#supplierMapping').hidden=true;sessionStorage.removeItem('ops-supplier-batch');$('#supplierPreview').replaceChildren();refreshSupplierSelection();$('#supplierStatus').textContent='预览已删除，已导入商品和OSS图片保留。';$('#commitSupplier').disabled=true;$('#discardSupplier').disabled=true;}catch(e){$('#supplierStatus').textContent=e.message;}};
function fillSupplierAI(c){
 $('#supplierAIBase').value=c.base;$('#supplierAIModel').value=c.model;$('#supplierAIEnabled').checked=c.enabled;
 const key=$('#supplierAIKey');key.value='';key.placeholder=c.has_key?'已配置，留空保留':'输入专用令牌';
}
function supplierAIStatus(message,error=false){const el=$('#supplierAIStatus');el.textContent=message;el.classList.toggle('is-error',error);}
async function loadSupplierAI(){
 if(!me.systemAdmin)return;
 const form=$('#supplierAIForm');if(form.dataset.busy)return;
 form.dataset.busy='1';const controls=[...form.querySelectorAll('input,button')];controls.forEach(el=>el.disabled=true);
 try{fillSupplierAI(await api('/api/supplier-ai'));$('#supplierAIModels').replaceChildren();supplierAIStatus('');}
 catch(e){supplierAIStatus(e.message,true);}
 finally{controls.forEach(el=>el.disabled=false);delete form.dataset.busy;}
}
async function supplierAIAction(action){
 const form=$('#supplierAIForm');if(form.dataset.busy||!form.reportValidity())return;
 const body={base:$('#supplierAIBase').value,key:$('#supplierAIKey').value,model:$('#supplierAIModel').value,enabled:$('#supplierAIEnabled').checked};
 form.dataset.busy='1';const controls=[...form.querySelectorAll('input,button')];controls.forEach(el=>el.disabled=true);
 supplierAIStatus({models:'正在读取可用模型…',test:'正在测试模型…',save:'正在保存…'}[action]);
 try{
  const result=await api('/api/supplier-ai'+(action==='save'?'':'/'+action),'POST',body);
  if(action==='models'){
   $('#supplierAIModels').replaceChildren(...result.models.map(value=>{const option=document.createElement('option');option.value=value;return option;}));
   if(result.models.length===1&&!body.model)$('#supplierAIModel').value=result.models[0];
   supplierAIStatus(result.models.length?'已读取 '+result.models.length+' 个模型，点击模型 ID 选择。':'此令牌暂无可用模型，请检查 NewAPI 的渠道和令牌分组。');
  }else if(action==='test')supplierAIStatus('模型 '+result.model+' 测试通过，保存后生效。');
  else{fillSupplierAI(result);supplierAIStatus(result.enabled?'已保存，只有点击「用 AI 重试」才会调用 AI。':'已保存，AI 重试已关闭。');}
 }catch(e){supplierAIStatus(e.message,true);}
 finally{controls.forEach(el=>el.disabled=false);delete form.dataset.busy;if(action==='models')$('#supplierAIModel').focus();}
}
$('#supplierAILoadModels').onclick=()=>supplierAIAction('models');
$('#supplierAITest').onclick=()=>supplierAIAction('test');
$('#supplierAIForm').onsubmit=e=>{e.preventDefault();supplierAIAction('save');};
let imageStorageAvailability=[];
async function loadImageStorageAvailability(){try{imageStorageAvailability=(await api('/api/image-storage/availability')).malls;}catch{imageStorageAvailability=[];}}
async function loadImageStorage(){try{const c=await api('/api/image-storage');$('#imageStorageEnabled').checked=!!c.enabled;for(const [id,key]of [['Bucket','bucket'],['Region','region'],['Origin','publicOrigin']])$('#imageStorage'+id).value=c[key]||'';$('#imageStorageAllowed').value=(c.allowedOrigins||[]).join('\n');$('#imageStorageKey').value='';$('#imageStorageSecret').value='';$('#imageStorageStatus').textContent=c.credentialsSaved?'凭据已加密保存；留空保留。':'尚未配置，所有商城默认使用外链。';}catch(e){$('#imageStorageStatus').textContent=e.message;}}
function imageStorageInput(){return {enabled:$('#imageStorageEnabled').checked,bucket:$('#imageStorageBucket').value,region:$('#imageStorageRegion').value,publicOrigin:$('#imageStorageOrigin').value,allowedOrigins:$('#imageStorageAllowed').value,accessKeyId:$('#imageStorageKey').value,accessKeySecret:$('#imageStorageSecret').value};}
async function saveOrTestImageStorage(test){const controls=[...$('#imageStorageForm').querySelectorAll('input,textarea,button')];controls.forEach(x=>x.disabled=true);$('#imageStorageStatus').textContent=test?'正在上传测试图片并读取…':'正在保存…';try{const r=await api('/api/image-storage'+(test?'/test':''),'POST',imageStorageInput());if(!test)await loadImageStorage();$('#imageStorageStatus').textContent=test?r.message:'已保存，发布时仍默认不转存图片。';}catch(e){$('#imageStorageStatus').textContent=e.message;}finally{controls.forEach(x=>x.disabled=false);}}
$('#imageStorageForm').onsubmit=e=>{e.preventDefault();saveOrTestImageStorage(false);};
$('#imageStorageTest').onclick=()=>saveOrTestImageStorage(true);
const sameStyleBody=$('#sameStyleBody'),sameStyleTop=$('#sameStyleBackToTop');sameStyleBody.addEventListener('scroll',()=>sameStyleTop.classList.toggle('hidden',sameStyleBody.scrollTop<240),{passive:true});sameStyleTop.onclick=()=>sameStyleBody.scrollTo({top:0,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
setupSameStyle({$,esc,context:()=>({products:state.products,selected:mergeSelected}),api,load,edit,toast});
$('#showStyleSources').onchange=()=>{productPage=1;render();};
const operationPanel=setupOperations({$,api,isAdmin:()=>!!me.systemAdmin});
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
 if(type==='tigshop'){node('notificationChannel').value=data.channel||'wecom';node('notificationDingField').hidden=data.channel!=='ding';node('notificationDingSecret').value='';node('notificationDingSecret').placeholder=data.hasDingSecret?'已保存，留空保留':'未开启加签可留空';node('notificationCurrency').value=data.currency||'';node('notificationTimeZone').value=data.timeZone||'';}
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
 if(type==='tigshop')node('notificationChannel').onchange=()=>{node('notificationDingField').hidden=node('notificationChannel').value!=='ding';node('notificationWebhook').placeholder='粘贴所选渠道的群机器人 Webhook';};
 node('notificationForm').onsubmit=async event=>{event.preventDefault();const button=event.submitter;button.disabled=true;try{const data=await api(path,'POST',{webhook:node('notificationWebhook').value.trim(),enabled:node('notificationEnabled').checked,paid:node('notificationPaid').checked,refund:node('notificationRefund').checked,...(type==='tigshop'?{channel:node('notificationChannel').value,dingSecret:node('notificationDingSecret').value.trim(),currency:node('notificationCurrency').value.trim(),timeZone:node('notificationTimeZone').value}:{})});node('notificationWebhook').value='';renderNotifications(data,type);node('notificationStatus').textContent=type==='tigshop'?'已保存。先发送测试通知，再点击接口检查，无需配置商城回调。':'已保存。先发送测试通知，再将下方推送配置填写到商城。';}catch(e){node('notificationStatus').textContent=e.message;}finally{button.disabled=false;}};
 node('notificationTest').onclick=async()=>{const button=node('notificationTest');button.disabled=true;try{renderNotifications(await api(path+'/test','POST',{}),type);node('notificationStatus').textContent='测试通知已排队，请查看所选接收群，稍后刷新通知记录。';}catch(e){node('notificationStatus').textContent=e.message;}finally{button.disabled=!node('notificationEnabled').checked;}};
 node('notificationRefresh').onclick=()=>loadNotifications(type);
 for(const button of node('notificationDetails').querySelectorAll('[data-notification-copy]'))button.onclick=async()=>{try{const value=$('#'+button.dataset.notificationCopy).value;if(!value)throw Error('请先保存通知设置');await navigator.clipboard.writeText(value);node('notificationStatus').textContent='已复制，请直接粘贴到商城，不要发到聊天或截图中。';}catch(e){node('notificationStatus').textContent=e.message;}};
 node('notificationRecords').onclick=async event=>{const button=event.target.closest('[data-notification-retry]');if(!button)return;if(!await actions.confirm('请先检查群里是否已收到该事件。重新发送可能产生重复消息，确认继续？'))return;button.disabled=true;try{renderNotifications(await api(path+'/retry','POST',{id:button.dataset.notificationRetry}),type);node('notificationStatus').textContent='已重新排队。';}catch(e){node('notificationStatus').textContent=e.message;button.disabled=false;}};
 if(type==='crmeb-store'&&node('notificationRelayRecords'))node('notificationRelayRecords').onclick=async event=>{const button=event.target.closest('[data-relay-retry]');if(!button)return;button.disabled=true;try{renderNotifications(await api(path+'/relay-retry','POST',{id:button.dataset.relayRetry}),type);node('notificationStatus').textContent='已重新排队读取商城资料，通知按商城业务ID去重。';}catch(e){node('notificationStatus').textContent=e.message;button.disabled=false;}};
 node('notificationRefundCheck').onclick=async()=>{const button=node('notificationRefundCheck');button.disabled=true;try{renderNotifications(await api(path+(type==='tigshop'?'/source-check':type==='crmeb-store'?'/relay-check':'/refund-check'),'POST',{}),type);node('notificationStatus').textContent=type==='tigshop'?'接口检查通过，已开始补拉近24小时自营付款和待审核退款申请。稍后刷新通知记录。':type==='crmeb-store'?'通知读取接口检查通过。请将下方地址和模板填入商城，随后测试真实付款与退款。':'权限检查通过，已开始补拉近24小时未处理申请。稍后刷新通知记录。';}catch(e){node('notificationStatus').textContent=e.message;}finally{button.disabled=false;}};
}

let usersPage=1;
async function loadUsers(){
 const result=await api('/api/users?'+new URLSearchParams({q:$('#usersSearch').value,page:usersPage,filter:$('#usersFilter').value}));
 $('#usersRows').innerHTML=result.items.map(u=>'<tr><td>'+esc(u.name||u.sub)+'<small>'+esc(u.sub)+'</small>'+(u.system_admin?'<small>系统管理员</small>':'')+'</td><td>'+(!u.active?'已停用':u.member_active===0?'团队已停用':u.allowlisted||u.granted||u.team_id?'已授权':u.requested?'待授权':'未授权')+'</td><td>'+esc(u.team_name||'个人空间')+(u.team_id?'<select data-user-role="'+esc(u.sub)+'" aria-label="团队角色">'+['editor','reviewer','admin'].map(role=>'<option value="'+role+'" '+(u.role===role?'selected':'')+'>'+({editor:'编辑',reviewer:'审核',admin:'团队管理员'}[role])+'</option>').join('')+'</select>':'')+'</td><td>'+esc(u.last_login?new Date(u.last_login).toLocaleString():'尚无登录记录')+'</td><td><div class="actions"><button type="button" class="secondary" data-user-details="'+esc(u.sub)+'">详情 / 记录</button><button type="button" class="secondary" data-user-action="'+(u.active&&(u.allowlisted||u.granted||u.team_id)?'disable':'enable')+'" data-user-sub="'+esc(u.sub)+'" '+(u.active&&(u.system_admin||u.sub===me.user.sub)?'disabled':'')+'>'+(u.active?(u.allowlisted||u.granted||u.team_id?'停用':'批准访问'):'恢复')+'</button>'+((u.active&&u.requested&&!u.granted&&!u.allowlisted&&!u.team_id)?'<button type="button" class="secondary" data-user-action="disable" data-user-sub="'+esc(u.sub)+'">拒绝申请</button>':'')+'<button type="button" class="secondary" data-user-action="revoke_sessions" data-user-sub="'+esc(u.sub)+'">强制退出</button></div></td></tr>').join('');
 $('#usersPendingCount').textContent='待授权 '+result.pending+' 人';$('#usersPage').textContent='第 '+usersPage+' 页 · 共 '+result.total+' 人';$('#usersPrev').disabled=usersPage<=1;$('#usersNext').disabled=usersPage*result.pageSize>=result.total;
}
$('#usersFilter').onchange=()=>{usersPage=1;loadUsers().catch(e=>toast(e.message));};
$('#usersSearchForm').onsubmit=e=>{e.preventDefault();usersPage=1;loadUsers().catch(e=>toast(e.message));};
$('#usersPrev').onclick=()=>{usersPage--;loadUsers().catch(e=>toast(e.message));};$('#usersNext').onclick=()=>{usersPage++;loadUsers().catch(e=>toast(e.message));};
$('#userGrantForm').onsubmit=async e=>{e.preventDefault();try{await openUserApproval($('#userGrantSub').value.trim());}catch(e){$('#usersStatus').textContent=e.message;}};
$('#usersRows').onclick=async event=>{const details=event.target.closest('[data-user-details]');if(details){try{await showUserDetails(details.dataset.userDetails);}catch(e){toast(e.message);}return;}const b=event.target.closest('[data-user-action]');if(!b||b.disabled)return;try{const action=b.dataset.userAction,sub=b.dataset.userSub;if(action==='enable'){await openUserApproval(sub);return;}if(!await actions.confirm(({disable:'停用此用户并清除OPS会话？',enable:'恢复此用户的OPS访问？',revoke_sessions:'清除此用户的全部OPS会话，要求重新登录？'}[action])+' '+sub))return;b.disabled=true;await api('/api/users','POST',{sub,action});await loadUsers();$('#usersStatus').textContent='操作已完成';}catch(e){$('#usersStatus').textContent=e.message;b.disabled=false;}};
$('#usersRows').onchange=async event=>{const select=event.target.closest('[data-user-role]');if(!select)return;try{if(!await actions.confirm('修改 '+select.dataset.userRole+' 的团队角色？'))return;await api('/api/users','POST',{sub:select.dataset.userRole,action:'role',role:select.value});$('#usersStatus').textContent='团队角色已更新';}catch(e){$('#usersStatus').textContent=e.message;}finally{await loadUsers();}};

$('#closeUserDetails').onclick=()=>$('#userDetailsDialog').close();
async function showUserDetails(sub){
 const {user:u,events}=await api('/api/users?'+new URLSearchParams({sub}));
 const rows=[['姓名',u.name||'尚未登录'],['用户ID',u.sub],['OPS访问',({disabled:'已停用',team_disabled:'团队成员已停用',enabled:'已授权',unauthorized:'未授权',pending:'等待管理员授权'})[u.access]],['授权来源',u.sources.join('、')||'无'],['团队',u.team_name||'个人空间'],['角色',u.system_admin?'系统管理员'+(u.role?' / '+({admin:'团队管理员',reviewer:'审核',editor:'编辑'})[u.role]:''):({admin:'团队管理员',reviewer:'审核',editor:'编辑'})[u.role]||'个人空间'],['有效OPS会话',u.sessions+' 个（并不代表当前在线）'],['最近登录',u.last_login?new Date(u.last_login).toLocaleString():'暂无记录'],['加入OPS目录',new Date(u.created).toLocaleString()]];
 $('#userDetailsContent').innerHTML='<dl>'+rows.map(([k,v])=>'<dt>'+esc(k)+'</dt><dd>'+esc(v)+'</dd>').join('')+'</dl>';
 const actions={access_requested:'首次登录申请OPS访问',enable:'授权 / 恢复OPS访问',disable:'停用OPS访问',revoke_sessions:'强制退出OPS会话','role:admin':'调整为团队管理员','role:editor':'调整为编辑','role:reviewer':'调整为审核'};
 $('#userDetailsEvents').innerHTML=events.length?events.map(e=>'<p>'+esc(new Date(e.created).toLocaleString())+' · '+esc(e.actor_name||e.actor)+'<small>（'+esc(e.actor)+'）</small><br>'+esc(actions[e.action]||(e.action.startsWith('team_join:')?'审批加入团队：'+e.action.slice(10):e.action))+'</p>').join(''):'<p class="hint">暂无OPS权限操作记录</p>';
 $('#userDetailsDialog').showModal();
}

let userApprovalSub='';
async function openUserApproval(sub){
 const result=await api('/api/users?teams=1');userApprovalSub=sub;$('#userApprovalSubject').textContent=sub;$('#userApprovalTeam').innerHTML='<option value="">保留个人空间或现有团队</option>'+result.teams.map(t=>'<option value="'+esc(t.id)+'">'+esc(t.name)+'</option>').join('');$('#userApprovalRole').value='editor';$('#userApprovalRole').disabled=true;$('#userApprovalStatus').textContent='';$('#userApprovalDialog').showModal();
}
$('#closeUserApproval').onclick=()=>$('#userApprovalDialog').close();
$('#userApprovalTeam').onchange=()=>{$('#userApprovalRole').disabled=!$('#userApprovalTeam').value;};
$('#userApprovalForm').onsubmit=async event=>{event.preventDefault();const button=$('#submitUserApproval');button.disabled=true;try{const team=$('#userApprovalTeam').value;await api('/api/users','POST',{sub:userApprovalSub,action:'enable',...(team?{team_id:team,role:$('#userApprovalRole').value}:{})});$('#userApprovalDialog').close();$('#usersStatus').textContent=team?'已授权并加入所选团队，用户重新登录后生效。':'OPS访问已授权；团队层面的停用仍需单独恢复。';await loadUsers();}catch(error){$('#userApprovalStatus').textContent=error.message;}finally{button.disabled=false;}};

let releaseNotes=[];
function renderReleaseNotes(){const search=$('#releaseNotesSearch').value.trim().toLowerCase(),rows=releaseNotes.filter(r=>(r.version+' '+r.title+' '+r.changes.join(' ')).toLowerCase().includes(search));$('#releaseNotesContent').innerHTML=rows.length?rows.map(r=>'<article class="release-note"><h3>v'+esc(r.version)+' · '+esc(r.title)+'</h3><ul>'+r.changes.map(line=>'<li>'+esc(line)+'</li>').join('')+'</ul></article>').join(''):'<p class="hint">没有匹配的版本记录</p>';}
$('#systemVersion').onclick=async()=>{try{const data=await api('/api/releases');releaseNotes=data.releases;$('#releaseNotesCurrent').textContent='当前系统 v'+data.current.version+' · 构建 '+data.current.build;$('#releaseNotesSearch').value='';renderReleaseNotes();$('#releaseNotesDialog').showModal();}catch(e){toast(e.message);}};
$('#closeReleaseNotes').onclick=()=>$('#releaseNotesDialog').close();$('#releaseNotesSearch').oninput=renderReleaseNotes;

let billingPage=1,billingCreditKey='',billingBusy=false,billingOwnersLoaded=false,billingRecoveryChecked=false,billingTestRevision=0,billingTestBusy=false,billingTestCanEnable=false,billingTestActive=false;
async function loadBilling(){
 $('#billingAdmin').classList.toggle('hidden',!me.systemAdmin);$('#billingRedeemForm').classList.toggle('hidden',!!state.team&&state.team.role!=='admin');$('#billingRedeemTarget').textContent='兑换目标：'+(state.team?.name||'个人空间')+'。点数入账后不自动转移，请确认当前工作空间。';if(me.systemAdmin){await loadBillingCards();await loadBillingRates();}
 if(me.systemAdmin&&!billingOwnersLoaded){const result=await api('/api/billing/admin');$('#billingAdminOwner').innerHTML=result.owners.map(r=>'<option value="'+esc(r.owner)+'">'+esc(r.name)+'</option>').join('');const current=state.team?.id||me.user.sub;if(result.owners.some(r=>r.owner===current))$('#billingAdminOwner').value=current;billingOwnersLoaded=true;}
 if(me.systemAdmin&&!billingRecoveryChecked){const raw=sessionStorage.getItem('ops-billing-credit:'+me.user.sub);if(raw){const pending=JSON.parse(raw),receipt=(await api('/api/billing/admin?'+new URLSearchParams({request_key:pending.key}))).entry;if(receipt){if(receipt.owner!==pending.owner||receipt.points!==pending.amount||receipt.reason!==pending.reason)throw Error('待确认入账记录冲突，请联系管理员核对');sessionStorage.removeItem('ops-billing-credit:'+me.user.sub);$('#billingStatus').textContent='上次入账已确认成功，未重复充值。';}else{if(![...$('#billingAdminOwner').options].some(o=>o.value===pending.owner))throw Error('待确认入账目标已不存在，请核对原请求');$('#billingAdminOwner').value=pending.owner;$('#billingCreditAmount').value=pending.amount;$('#billingCreditReason').value=pending.reason;billingCreditKey=pending.key;$('#billingStatus').textContent='已恢复上次待确认请求，请保持原值重试；同一编号不会重复入账。';}}billingRecoveryChecked=true;}
 const target=me.systemAdmin?$('#billingAdminOwner').value:'';const result=target?(await api('/api/billing/admin?'+new URLSearchParams({owner:target,page:billingPage}))).wallet:await api('/api/billing?page='+billingPage);
 $('#billingMode').textContent=(result.testMode?'当前空间正在收费测试，真实扣点':result.enabled?'计费已启用':'计费未启用，采集发布不自动扣款')+(result.account.exempt?' · 历史内部工作空间免计费':'');$('#billingOwner').textContent='当前查看：'+(target?$('#billingAdminOwner').selectedOptions[0]?.textContent:state.team?.name||'个人空间');$('#billingAvailable').textContent=result.account.available.toLocaleString();$('#billingFrozen').textContent=result.account.frozen.toLocaleString();
 if(me.systemAdmin){const test=result.test;billingTestRevision=test.revision;billingTestCanEnable=result.account.internalExempt;billingTestActive=test.enabled;$('#billingTestCollect').value=test.collect;$('#billingTestPublish').value=test.publish;$('#billingTestStorage').checked=test.storage;$('#billingTestEnable').disabled=billingTestBusy||!result.account.internalExempt;$('#billingTestDisable').disabled=billingTestBusy||!test.enabled;const name=$('#billingAdminOwner').selectedOptions[0]?.textContent||'未选择';$('#billingTestTarget').textContent='测试目标：'+name;$('#billingTestStatus').textContent=!result.account.internalExempt?'仅适用于内部免计费空间。':test.enabled?'此空间测试已启用：采集 '+test.collect+' 点 / 发布 '+test.publish+' 点；OSS限制'+(test.storage?'已启用':'不参与本次测试'):'此空间测试未启用，仍按内部免计费处理。';}
 const available=result.account.available,frozen=result.account.frozen,total=available+frozen,frozenShare=total?frozen/total*100:0;$('#billingTotal').textContent=total.toLocaleString();$('#billingBalanceChart').style.setProperty('--wallet-available',total?available/total*100+'%':'0%');$('#billingBalanceChart').classList.toggle('is-empty',!total);$('#billingBalanceChart').setAttribute('aria-label','总点数 '+total+'，可用 '+available+'，冻结 '+frozen);$('#billingBalanceHint').textContent=total?'冻结占当前总点数 '+frozenShare.toFixed(1)+'%':'暂无点数，可兑换卡密充值';
 const storage=result.storage;if(storage){const size=n=>(n/1024**3).toFixed(3)+' GB';$('#billingStorageStatus').textContent=storage.exempt?'内部空间免额度限制':storage.active?'套餐 '+size(storage.limitBytes)+' · 有效至 '+new Date(storage.expires).toLocaleString():'暂无有效套餐，请兑换OSS开通或续期卡';$('#billingStorageUsage').textContent='已登记 '+size(storage.storedBytes)+' · 待核对 '+size(storage.reservedBytes)+' · '+storage.objects+' 个对象'+(storage.exempt?'':' · 可用 '+size(storage.availableBytes));$('#billingStorageAdvice').textContent=!storage.active?storage.previousLimitBytes?'原 '+storage.previousLimitBytes/1024**3+' GB 套餐已到期，可按原容量续期；有效期从本次兑换重新计时。':'尚未开通OSS服务：可兑换开通卡，外链图片无需开通。':storage.availableBytes!==null&&storage.availableBytes<=storage.limitBytes*.1?'容量接近用满：请选择扩容；续期不会释放已用容量。':'需要延长时间时选择同容量续期，需要更多空间时选择扩容；点数独立充值。';$('#billingStorageMeter').value=storage.limitBytes?Math.min(100,(storage.storedBytes+storage.reservedBytes)/storage.limitBytes*100):0;}
 const kinds={credit:'入账',hold:'冻结',settle:'结算',release:'退回冻结',refund:'退款'};$('#billingRows').innerHTML=result.entries.length?result.entries.map(r=>'<tr><td>'+esc(new Date(r.created).toLocaleString())+'<small>'+esc(kinds[r.kind]||r.kind)+' · '+esc(r.actor)+'</small></td><td>可用 '+(r.available_delta>0?'+':'')+r.available_delta+'<small>冻结 '+(r.frozen_delta>0?'+':'')+r.frozen_delta+'</small></td><td>'+r.available_after+' / '+r.frozen_after+'</td><td>'+esc(r.reason)+'<small>'+esc(r.reference||'—')+'</small></td></tr>').join(''):'<tr><td colspan="4">暂无账务记录</td></tr>';
 $('#billingPage').textContent='第 '+billingPage+' 页 · 共 '+result.total+' 笔';$('#billingPrev').disabled=billingPage<=1;$('#billingNext').disabled=billingPage*result.pageSize>=result.total;
}
$('#billingRefresh').onclick=()=>loadBilling().catch(e=>toast(e.message));$('#billingPrev').onclick=()=>{billingPage--;loadBilling().catch(e=>toast(e.message));};$('#billingNext').onclick=()=>{billingPage++;loadBilling().catch(e=>toast(e.message));};
$('#billingAdminOwner').onchange=()=>{billingPage=1;billingCreditKey=crypto.randomUUID();loadBilling().catch(e=>toast(e.message));};for(const id of ['billingCreditAmount','billingCreditReason'])$('#'+id).oninput=()=>{billingCreditKey=crypto.randomUUID();};
$('#billingCreditForm').onsubmit=async event=>{event.preventDefault();if(billingBusy)return;if(!billingCreditKey)billingCreditKey=crypto.randomUUID();const owner=$('#billingAdminOwner').value,amount=Number($('#billingCreditAmount').value),reason=$('#billingCreditReason').value.trim();let key=billingCreditKey;const pendingRaw=sessionStorage.getItem('ops-billing-credit:'+me.user.sub);if(pendingRaw){const old=JSON.parse(pendingRaw);if(old.owner!==owner||old.amount!==amount||old.reason!==reason){$('#billingStatus').textContent='还有待确认入账，刷新钱包恢复原请求后重试，请勿修改目标或金额。';billingRecoveryChecked=false;return;}key=old.key;}if(!await actions.confirm('向 '+$('#billingAdminOwner').selectedOptions[0]?.textContent+' 入账 '+amount+' 点？原因：'+reason))return;billingBusy=true;$('#billingCreditSubmit').disabled=true;try{sessionStorage.setItem('ops-billing-credit:'+me.user.sub,JSON.stringify({owner,amount,reason,key}));const result=await api('/api/billing/admin','POST',{owner,amount,reason,key});sessionStorage.removeItem('ops-billing-credit:'+me.user.sub);billingCreditKey=crypto.randomUUID();$('#billingCreditAmount').value='';$('#billingCreditReason').value='';$('#billingStatus').textContent=result.duplicate?'该请求此前已入账，未重复充值。':'入账完成，已记录操作者和原因。';billingPage=1;await loadBilling();}catch(error){if([400,401,403,404,422].includes(error.httpStatus)){sessionStorage.removeItem('ops-billing-credit:'+me.user.sub);billingCreditKey=crypto.randomUUID();$('#billingStatus').textContent=error.message;}else $('#billingStatus').textContent=error.message+'；结果不明时保持原输入重试，不要新建相同充值。';}finally{billingBusy=false;$('#billingCreditSubmit').disabled=false;}};

let billingCardsPage=1,billingCodesBatch='',billingCardBusy=false,billingRedeemBusy=false,billingMintRestored=false;
async function loadBillingCards(){if(!billingMintRestored){const raw=sessionStorage.getItem('ops-card-mint:'+me.user.sub);if(raw){const old=JSON.parse(raw);$('#billingMintKind').value=old.kind||'points';$('#billingMintStorageGB').value=old.storageGB||10;$('#billingMintStorageDays').value=old.storageDays??365;$('#billingMintStorageAction').value=old.storageAction||'legacy';$('#billingMintStorageYears').value=String(Math.max(1,(old.storageDays||365)/365));billingMintType();$('#billingMintLabel').value=old.label;$('#billingMintAmount').value=old.amount;$('#billingMintQuantity').value=old.quantity;$('#billingMintDays').value=old.days;$('#billingCardsStatus').textContent='已恢复待确认的生成请求，请保持原值重试核对批次。';}billingMintRestored=true;}billingMintType();const result=await api('/api/billing/cards?page='+billingCardsPage);$('#billingCardRows').innerHTML=result.items.map(b=>'<tr><td>'+esc(b.label)+'<small>'+esc(b.id)+'</small><small>'+(b.expires?esc(new Date(b.expires).toLocaleString()):'不过期')+'</small></td><td>'+billingCardBenefit(b)+' / '+b.quantity+' 张</td><td>'+b.usable+' / '+b.redeemed+' / '+b.revoked+' / '+(b.quantity-b.usable-b.redeemed-b.revoked)+'</td><td><button type="button" class="secondary" data-card-view="'+esc(b.id)+'">兑换记录</button><button type="button" class="secondary" data-card-revoke="'+esc(b.id)+'" '+(b.quantity===b.redeemed+b.revoked?'disabled':'')+'>作废未兑换卡密</button></td></tr>').join('')||'<tr><td colspan="4">暂无卡密批次</td></tr>';$('#billingCardsPage').textContent='第 '+billingCardsPage+' 页 · 共 '+result.total+' 批';$('#billingCardsPrev').disabled=billingCardsPage<=1;$('#billingCardsNext').disabled=billingCardsPage*result.pageSize>=result.total;}
$('#billingCardsPrev').onclick=()=>{billingCardsPage--;loadBillingCards().catch(e=>toast(e.message));};$('#billingCardsNext').onclick=()=>{billingCardsPage++;loadBillingCards().catch(e=>toast(e.message));};
function billingCardBenefit(batch){if(batch.kind==='bundle')return '历史全能 · '+batch.points+' 点 ＋ '+batch.storage_bytes/1024**3+' GB / '+batch.storage_days/365+' 年';if(batch.kind!=='storage')return batch.points+' 点';const action=batch.storage_action||'legacy',capacity=batch.storage_bytes/1024**3+' GB';return action==='expand'?'OSS扩容至 '+capacity+' · 保留原到期日':action==='legacy'?'历史OSS · '+capacity+' / '+batch.storage_days+' 天':'OSS'+(action==='renew'?'续期':'开通')+' · '+capacity+' / '+batch.storage_days/365+' 年';}
function billingMintType(){const kind=$('#billingMintKind').value,storage=kind!=='points',action=$('#billingMintStorageAction').value,legacy=kind==='bundle'||kind==='storage'&&action==='legacy',hasPoints=kind!=='storage',amount=$('#billingMintAmount');amount.disabled=!hasPoints;amount.required=hasPoints;amount.closest('label').classList.toggle('hidden',!hasPoints);const capacity=$('#billingMintStorageGB');capacity.disabled=!storage;capacity.required=storage;capacity.closest('label').classList.toggle('hidden',!storage);const actionField=$('#billingMintStorageAction');actionField.disabled=kind!=='storage'||legacy;actionField.required=kind==='storage'&&!legacy;actionField.closest('label').classList.toggle('hidden',kind!=='storage'||legacy);const years=$('#billingMintStorageYears'),annual=kind==='storage'&&!legacy&&action!=='expand';years.disabled=!annual;years.required=annual;years.closest('label').classList.toggle('hidden',!annual);$('#billingMintStorageDays').disabled=!storage;$('#billingStorageCapacityLabel').textContent=action==='expand'?'扩容后总容量（GB）':'套餐容量（GB）';
 for(const button of $('#billingMintTypes').querySelectorAll('[data-mint-kind]')){const checked=button.dataset.mintKind===kind;button.setAttribute('aria-checked',String(checked));button.tabIndex=checked?0:-1;}
 const hints={open:'OSS开通：设置容量和年限，不增加点数；无有效套餐时可使用。',renew:'OSS续期：容量档位须与现有套餐一致，延长有效期；已用容量不清零。到期后续期从兑换时重新计时。',expand:'OSS扩容：填写升级后的总容量，必须高于当前容量；保留原到期日，不增加点数和时间。'};
 $('#billingMintTypeHint').textContent=legacy?'正在恢复历史卡密生成请求，按原权益核对；新卡请使用点数充值或OSS服务。':storage?hints[action]:'点数卡：只增加钱包点数，不包含OSS容量，也不改变套餐有效期。';$('#billingMintSubmit').textContent=legacy?'核对历史生成请求':storage?'生成OSS服务卡密并导出':'生成点数卡密并导出';$('#billingMintLabel').placeholder=storage?'例如：10GB年度开通 / 续期 / 扩容':'例如：首批点数充值卡';}
function syncStorageDuration(){if($('#billingMintKind').value!=='storage')return;const action=$('#billingMintStorageAction').value;if(action!=='legacy')$('#billingMintStorageDays').value=action==='expand'?0:Number($('#billingMintStorageYears').value||1)*365;}
$('#billingMintKind').onchange=()=>{syncStorageDuration();billingMintType();};$('#billingMintStorageAction').onchange=()=>{syncStorageDuration();billingMintType();};$('#billingMintStorageYears').onchange=syncStorageDuration;
function selectMintType(button){$('#billingMintKind').value=button.dataset.mintKind;if(button.dataset.mintKind==='storage'&&$('#billingMintStorageAction').value==='legacy')$('#billingMintStorageAction').value='open';syncStorageDuration();billingMintType();}
$('#billingMintTypes').onclick=event=>{const button=event.target.closest('[data-mint-kind]');if(button)selectMintType(button);};
$('#billingMintTypes').onkeydown=event=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key))return;event.preventDefault();const buttons=[...$('#billingMintTypes').querySelectorAll('[data-mint-kind]')],index=buttons.indexOf(event.target.closest('[data-mint-kind]')),next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(['ArrowLeft','ArrowUp'].includes(event.key)?-1:1)+buttons.length)%buttons.length;selectMintType(buttons[next]);buttons[next].focus();};
$('#billingMintForm').onsubmit=async event=>{event.preventDefault();if(billingCardBusy)return;const label=$('#billingMintLabel').value.trim(),kind=$('#billingMintKind').value,storageAction=kind==='storage'?$('#billingMintStorageAction').value:'legacy',storageGB=kind!=='points'?Number($('#billingMintStorageGB').value):0,storageDays=kind!=='points'?Number($('#billingMintStorageDays').value):0,amount=kind==='storage'?0:Number($('#billingMintAmount').value),quantity=Number($('#billingMintQuantity').value),days=Number($('#billingMintDays').value);let input;try{const old=JSON.parse(sessionStorage.getItem('ops-card-mint:'+me.user.sub)||'null');if(old){if(old.label!==label||old.amount!==amount||old.quantity!==quantity||old.days!==days||(old.kind||'points')!==kind||(old.storageGB||0)!==storageGB||(old.storageDays||0)!==storageDays||(old.storageAction||'legacy')!==storageAction)throw Error('还有结果待确认的生成请求，请保持原输入重试；不要重复创建批次');input=old;}else input={label,amount,quantity,days,kind,storageGB,storageDays,storageAction,expires:days?new Date(Date.now()+days*86400000).toISOString():'',key:crypto.randomUUID()};if(!await actions.confirm('生成 '+quantity+' 张，每张 '+billingCardBenefit({kind,points:amount,storage_bytes:storageGB*1024**3,storage_days:storageDays,storage_action:storageAction})+'的卡密？'))return;billingCardBusy=true;$('#billingMintSubmit').disabled=true;sessionStorage.setItem('ops-card-mint:'+me.user.sub,JSON.stringify(input));const result=await api('/api/billing/cards','POST',input);sessionStorage.removeItem('ops-card-mint:'+me.user.sub);if(!result.duplicate){billingCodesBatch=result.id;$('#billingCodesText').value=result.codes.join('\n');$('#billingCodesDialog').showModal();}billingCardsPage=1;await loadBillingCards();if(result.duplicate){$('#billingCardsStatus').textContent='批次 '+result.id+' 此前已生成，未重复创建。完整卡密无法再次查看；若未保存，请作废该批次未兑换卡密后重新生成。';return;}$('#billingCardsStatus').textContent='已生成 '+result.codes.length+' 张，请在弹窗中下载保存。';}catch(error){if([400,401,403,422].includes(error.httpStatus))sessionStorage.removeItem('ops-card-mint:'+me.user.sub);$('#billingCardsStatus').textContent=error.message;}finally{billingCardBusy=false;$('#billingMintSubmit').disabled=false;}};
$('#billingCardRows').onclick=async event=>{const view=event.target.closest('[data-card-view]');if(view){billingDetailBatch=view.dataset.cardView;billingDetailPage=1;try{await loadBillingCardDetails();$('#billingCardDetailsDialog').showModal();}catch(error){toast(error.message);}return;}const button=event.target.closest('[data-card-revoke]');if(!button||button.disabled)return;try{const reason=await actions.prompt('作废该批次所有尚未兑换的卡密？已兑换点数或套餐不受影响。请输入作废原因：');if(reason===null)return;if(!reason.trim())throw Error('请填写作废原因');button.disabled=true;const result=await api('/api/billing/cards','DELETE',{batchId:button.dataset.cardRevoke,reason:reason.trim()});$('#billingCardsStatus').textContent='已作废 '+result.revoked+' 张，已兑换点数或套餐保留。';await loadBillingCards();}catch(error){$('#billingCardsStatus').textContent=error.message;button.disabled=false;}};
$('#closeBillingCodes').onclick=()=>$('#billingCodesDialog').close();$('#billingCodesDialog').onclose=()=>{$('#billingCodesText').value='';billingCodesBatch='';};
$('#downloadBillingCodes').onclick=()=>{const text=$('#billingCodesText').value;if(!text)return;const url=URL.createObjectURL(new Blob([text+'\n'],{type:'text/plain;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='ops-cards-'+billingCodesBatch+'.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
$('#billingRedeemForm').onsubmit=async event=>{event.preventDefault();if(billingRedeemBusy)return;const code=$('#billingRedeemCode').value,expectedOwner=state.team?.id||me.user.sub,targetName=state.team?.name||'个人空间';try{if(!await actions.confirm('将卡密兑换到 '+targetName+'？兑换成功后不能转移到其他团队。'))return;billingRedeemBusy=true;$('#billingRedeemSubmit').disabled=true;const result=await api('/api/billing/redeem','POST',{code,expectedOwner});$('#billingRedeemCode').value='';$('#billingRedeemStatus').textContent=result.duplicate?'该卡密已兑换到当前工作空间，未重复入账。':result.kind==='bundle'?'全能套餐兑换成功，增加 '+result.amount+' 点；OSS有效至 '+new Date(result.storage.expires).toLocaleString()+'。':result.kind==='storage'?'OSS服务兑换成功，有效至 '+new Date(result.storage.expires).toLocaleString()+'。':'兑换成功，增加 '+result.amount+' 点。';billingPage=1;if(me.systemAdmin)$('#billingAdminOwner').value=state.team?.id||me.user.sub;await loadBilling();}catch(error){$('#billingRedeemStatus').textContent=error.message;}finally{billingRedeemBusy=false;$('#billingRedeemSubmit').disabled=false;}};

let billingDetailBatch='',billingDetailPage=1;
async function loadBillingCardDetails(){const result=await api('/api/billing/cards?'+new URLSearchParams({batch:billingDetailBatch,page:billingDetailPage}));$('#billingCardDetailsTitle').textContent=result.batch.label+' · 每张 '+billingCardBenefit(result.batch);const states={active:'未兑换',redeemed:'已兑换',revoked:'已作废',expired:'已过期'};$('#billingCardDetailsRows').innerHTML=result.items.map(c=>'<tr><td>…'+esc(c.suffix)+'</td><td>'+esc(states[c.state])+'</td><td>'+esc(c.owner||'—')+'<small>'+esc(c.redeemer||'')+'</small></td><td>'+esc(c.redeemed?new Date(c.redeemed).toLocaleString():'—')+'</td></tr>').join('');$('#billingCardDetailsPage').textContent='第 '+billingDetailPage+' 页 · 共 '+result.total+' 张';$('#billingCardDetailsPrev').disabled=billingDetailPage<=1;$('#billingCardDetailsNext').disabled=billingDetailPage*result.pageSize>=result.total;}
$('#closeBillingCardDetails').onclick=()=>$('#billingCardDetailsDialog').close();$('#billingCardDetailsPrev').onclick=()=>{billingDetailPage--;loadBillingCardDetails().catch(e=>toast(e.message));};$('#billingCardDetailsNext').onclick=()=>{billingDetailPage++;loadBillingCardDetails().catch(e=>toast(e.message));};

let billingRateRevision=null,publishQuoteGeneration=0;
async function loadBillingRates(){const rates=await api('/api/billing/rates');billingRateRevision=rates.revision;$('#billingCollectRate').value=rates.collect_price;$('#billingPublishRate').value=rates.publish_price;$('#billingRatesStatus').textContent='价格版本 '+rates.revision+' · '+(rates.enabled?'收费已启用':'全局收费关闭，单独启用的测试空间除外；保存单价不会开启收费');}
$('#billingTestForm').onsubmit=async event=>{event.preventDefault();if(billingTestBusy)return;const owner=$('#billingAdminOwner').value,name=$('#billingAdminOwner').selectedOptions[0]?.textContent,enabled=event.submitter.dataset.testEnabled==='true',input={owner,confirmOwner:owner,enabled,collect:Number($('#billingTestCollect').value),publish:Number($('#billingTestPublish').value),storage:$('#billingTestStorage').checked,revision:billingTestRevision,reason:$('#billingTestReason').value.trim()};try{if(!await actions.confirm((enabled?'启用或更新':'停止')+'「'+name+'」的收费测试？'+(enabled?'只对此空间后续新操作真实扣点；团队所有成员共用钱包。':'恢复内部免计费，已有冻结任务仍按原快照处理。')+'不会修改全局收费开关。'))return;billingTestBusy=true;$('#billingAdminOwner').disabled=true;$('#billingTestEnable').disabled=$('#billingTestDisable').disabled=true;await api('/api/billing/test','POST',input);await loadBilling();$('#billingTestStatus').textContent+=(enabled?' · 已保存测试设置。':' · 已停止测试。');}catch(error){$('#billingTestStatus').textContent=error.message+'；若结果不明请刷新钱包核对，不要重复启停。';}finally{billingTestBusy=false;$('#billingAdminOwner').disabled=false;$('#billingTestEnable').disabled=!billingTestCanEnable;$('#billingTestDisable').disabled=!billingTestActive;}};
$('#billingRatesForm').onsubmit=async event=>{event.preventDefault();const button=$('#billingSaveRates');button.disabled=true;try{await api('/api/billing/rates','POST',{collect:Number($('#billingCollectRate').value),publish:Number($('#billingPublishRate').value),revision:billingRateRevision});await loadBillingRates();$('#billingRatesStatus').textContent+=' · 单价已保存';}catch(error){$('#billingRatesStatus').textContent=error.message;}finally{button.disabled=false;}};
async function confirmBilling(kind,quantity,images=false,table){const quote=await api('/api/billing/quote','POST',{kind,quantity,images,...(table===undefined?{}:{table})});if(quote.storageBlocked)throw Error('OSS套餐未生效，请先兑换开通或续期卡，或关闭图片转存选项');if(quote.due>quote.available)throw Error('点数不足：本次最多需要 '+quote.due+' 点，可用 '+quote.available+' 点');if(quote.due&&!await actions.confirm((kind==='publish'?'本次最多冻结 ':'本次按成功新增商品扣款，最多 ')+quote.due+' 点（'+quote.quantity+' × '+quote.unit+'）。'+(kind==='publish'?'实际入库核对通过后结算；明确未创建时退回，结果待核对时保持冻结。':'重复或失败商品不收费。')+'确认继续？'))throw Error('已取消提交，未扣点数');return quote.revision;}
async function refreshPublishQuote(){const generation=++publishQuoteGeneration;const checked=[...$('#publishTargets').querySelectorAll('input[data-publish-mall]:checked:not(:disabled)')];if(!checked.length){$('#publishBillingQuote').textContent='请选择发布商城';return;}$('#publishBillingQuote').textContent='正在预估费用…';try{const images=checked.some(input=>[...$('#publishTargets').querySelectorAll('[data-import-images]')].some(x=>x.dataset.importImages===input.value&&x.checked));const quote=await api('/api/billing/quote','POST',{kind:'publish',quantity:checked.length,images});if(generation!==publishQuoteGeneration)return;$('#publishBillingQuote').textContent=quote.storageBlocked?'OSS套餐未生效，请先兑换开通或续期卡，或取消转存选项':!quote.enabled?'收费未启用，本次不扣点数':quote.exempt?'当前内部工作空间免计费':'最多冻结 '+quote.due+' 点 · 每个商城 '+quote.unit+' 点 · 可用 '+quote.available+' 点';}catch(error){if(generation===publishQuoteGeneration)$('#publishBillingQuote').textContent='费用预估失败：'+error.message;}}

let setupRequest,setupCheckedAt=0;
function readWorkspaceSetup(){
 if(!setupRequest)setupRequest=api('/api/onboarding').then(result=>{
  setupCheckedAt=Date.now();
  const shortcut=$('#onboardingNav');
  shortcut.classList.toggle('hidden',!(result.admin&&result.completed<result.total));
  return result;
 }).finally(()=>{setupRequest=null;});
 return setupRequest;
}
function refreshSetupShortcut(force=false){
 if(me.user&&(force||Date.now()-setupCheckedAt>=60000))readWorkspaceSetup().catch(()=>{setupCheckedAt=Date.now();});
}
$('#openWorkspaceSetup').onclick=()=>$('#onboardingNav').click();
async function loadOnboarding(){
 const result=await readWorkspaceSetup();$('#onboardingSummary').textContent=result.workspace+' · 已完成 '+result.completed+' / '+result.total+' 步';$('#onboardingProgress').max=result.total;$('#onboardingProgress').value=result.completed;
 $('#onboardingSteps').innerHTML=result.steps.map((step,index)=>'<article class="connection-card"><h3>'+(step.done?'✓ ':'○ ')+(index+1)+'. '+esc(step.title)+'</h3><p>'+esc(step.detail)+'</p><button type="button" class="secondary" data-onboarding-go="'+esc(step.page)+'">'+esc(step.action)+'</button></article>').join('');
 $('#onboardingBilling').textContent=(result.billing.exempt?'内部空间免计费':result.billing.enabled?'按已配置单价收费':'采集发布收费尚未启用')+' · 可用 '+result.billing.available+' 点';
 $('#onboardingStorage').textContent=result.storage.exempt?'OSS：内部空间免额度限制':result.storage.active?'OSS：'+result.storage.limitBytes/1024**3+' GB，有效至 '+new Date(result.storage.expires).toLocaleString():'OSS：未开通有效套餐，使用外链图片无需开通';
}
$('#onboardingRefresh').onclick=()=>loadOnboarding().catch(e=>{$('#onboardingSummary').textContent='进度读取失败：'+e.message;});
$('#onboarding').onclick=event=>{const button=event.target.closest('[data-onboarding-go]');if(button)document.querySelector('nav [data-page="'+button.dataset.onboardingGo+'"]').click();};
