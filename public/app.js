import {specificationMatrix,remapSpecificationValues,matchSpecificationImport} from './specifications.js';
import {channelConfiguration} from './connection-status.js';
import {detailImagesFromJSON,detailHTML} from './detail-images.js';
import {batchPrices} from './pricing.js';
import {matchSkuImages} from './sku-images.js';
const $=s=>document.querySelector(s);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let me={},state={products:[],jobs:[],targets:[]},page='products',filter='all',editing=null,publishing=null,catalog=null,catalogRequest=0;
const labels={draft:'待整理',approved:'审核通过',dispatching:'发送中',accepted:'执行中',unknown:'需核对',succeeded:'发布成功',failed:'执行失败',awaiting_review:'待核对商品ID',verifying:'核对中'};
const date=v=>new Date(v).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
function toast(message){$('#toast').textContent=message;$('#toast').classList.remove('hidden');clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').classList.add('hidden'),4500);}
async function api(path,method='GET',body){const r=await fetch(path,{method,headers:method==='GET'?{}:{'Content-Type':'application/json','X-CSRF-Token':me.csrf},body:body===undefined?undefined:JSON.stringify(body)});const data=await r.json();if(!r.ok)throw Error(data.error||'请求失败');return data;}
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
 const counts=[['configured','已配置'],['partial','待完善'],['unconfigured','未配置'],['error','读取失败'],['loading','读取中']].map(([key,label])=>{const n=all.filter(s=>s.state===key).length;return n?n+' 个'+label:'';}).filter(Boolean);
 $('#connectionCounts').textContent=counts.join(' · ');
}
function publicationBadges(product){
 return '<div class="product-publications">'+state.targets.map(target=>{
  const record=product.publications?.find(row=>row.target===target.id);
  const status=record?.status||'none';
  const label=status==='succeeded'?'已发布':status==='failed'?'失败':status==='none'?'未发布':labels[status]||'需核对';
  const old=record&&record.revision!==product.revision?` · v${record.revision}`:'';
  const detail=record?`发布版本 v${record.revision}${record.remote_id?' · 商城商品 ID：'+record.remote_id:''}；商城当前上下架状态请到商城核对`:'尚无发布任务';
  return `<span class="badge ${esc(status)}" title="${esc(detail)}">${esc(target.name)} · ${esc(label+old)}${record?.remote_id?`<small>ID ${esc(record.remote_id)}</small>`:''}</span>`;
 }).join('')+'</div>';
}
async function load(){state=await api('/api/state');render();}
function render(){
 const role=state.team?.role||'admin';
 const canPublish=role!=='editor';
 $('#merchantSettings').classList.toggle('hidden',role!=='admin');
 $('#connectionMemberHint').classList.toggle('hidden',role==='admin');
 $('#username').textContent=me.user.name+(state.team?' · '+state.team.name:'');
 $('#total').textContent=state.products.length;$('#drafts').textContent=state.products.filter(p=>p.status==='draft').length;$('#approved').textContent=state.products.filter(p=>p.status==='approved').length;$('#success').textContent=state.jobs.filter(j=>j.status==='succeeded').length;
 const search=$('#search').value.toLowerCase(),products=state.products.filter(p=>(filter==='all'||p.status===filter)&&`${p.title} ${p.source_url}`.toLowerCase().includes(search));
 $('#count').textContent=`显示 ${products.length} 件 / 已加载 ${state.products.length} 件商品（最多 1000 件）`;
 $('#productRows').innerHTML=products.map(p=>`<tr><td><div class="product-cell">${p.images[0]?`<img class="thumb" loading="lazy" referrerpolicy="no-referrer" src="${esc(p.images[0])}" alt="">`:'<div class="thumb">▧</div>'}<div><div class="title">${esc(p.title||'待采集 · '+p.source_url.match(/offer\/(\d+)/)?.[1])}</div><small>${esc(p.category||'尚未分类')} · v${p.revision}</small></div></div></td><td><a href="${esc(p.source_url)}" target="_blank" rel="noopener noreferrer">1688 ↗</a></td><td>${p.skus.length} 个 SKU${p.spec_names?.length?`<small>${esc(p.spec_names.join(' × '))}</small>`:''}<small>${p.skus.length?'¥ '+Math.min(...p.skus.map(s=>s.price)).toFixed(2)+' 起':'尚未录入价格'}</small></td><td><span class="badge ${p.status}">${labels[p.status]}</span></td><td>${publicationBadges(p)}</td><td>${date(p.updated)}</td><td><button class="text" data-edit="${p.id}">编辑</button>${!canPublish?'':p.status==='approved'?`<button class="text" data-publish="${p.id}">发布</button>`:`<button class="text" data-approve="${p.id}">审核</button>`}</td></tr>`).join('')||empty(7,'采集箱已准备好','添加 1688 商品链接，或导入采集器整理好的 JSON 商品资料。');
 $('#jobRows').innerHTML=state.jobs.map(j=>`<tr><td>${esc(state.products.find(p=>p.id===j.product_id)?.title||'商品记录')}<small>${j.id.slice(0,8)} · v${j.revision}</small></td><td>${esc(state.targets.find(t=>t.id===j.target)?.name||j.target)}</td><td><span class="badge ${j.status}">${labels[j.status]||esc(j.status)}</span></td><td>${esc(j.message||'等待执行')}${canPublish&&j.id==='650b74d9-6d5e-4174-9245-4d45163e3699'&&j.status==='unknown'&&j.message.includes('商品总库存必须大于0')?`<button class="text" data-recover-stock="${j.id}">核对未入库并结束任务</button>`:''}${j.fx?`<small>1 EUR = ${esc(j.fx.cnyPerEur)} CNY · 汇率日期 ${esc(j.fx.rateDate)}</small>`:''}${j.remote_id?`<small>商城商品 ID：${esc(j.remote_id)}</small>`:''}${j.claimed?`<small>任务编码：${esc(j.marker)}</small>`:''}${canPublish&&['crmeb-pro','crmeb-store','tigshop'].includes(j.target)&&j.claimed&&!['succeeded','failed'].includes(j.status)?`<button class="text" data-verify="${j.id}">填写商品 ID 核对</button>`:''}${canPublish&&['crmeb-pro','crmeb-store','tigshop'].includes(j.target)&&!j.claimed&&['accepted','unknown'].includes(j.status)?`<button class="text" data-retry="${j.id}">重发未领取任务</button>`:''}</td><td>${date(j.created)}</td></tr>`).join('')||empty(5,'还没有发布任务','审核商品后，选择一个目标商城创建发布任务。');
 $('#connectionScope').textContent=state.team?'当前团队：'+state.team.name+' · 管理员配置后由团队共享':'当前个人工作空间';
 $('#connectionSystemStatus').textContent=(me.demo?'本地演示登录':'统一账号已登录')+' · 商品工作流状态请在发布任务中查看。';
}
document.querySelectorAll('[data-page]').forEach(b=>b.onclick=()=>{page=b.dataset.page;document.querySelectorAll('[data-page]').forEach(x=>x.classList.toggle('active',x===b));for(const p of ['products','jobs','connections','team'])$('#'+p).classList.toggle('hidden',p!==page);const titles={products:'商品采集箱',jobs:'发布任务',connections:'连接与配置',team:'团队管理'};$('#heading').textContent=$('#breadcrumb').textContent=titles[page];$('#subtitle').textContent={products:'让每一份货源资料，成为准备好上架的商品。',jobs:'从任务接收到商城入库，每一步都有记录。',connections:'连接你的账号、工作流与商城。',team:'共同维护商品，按角色完成整理、审核和发布。'}[page];$('#productActions').classList.toggle('hidden',page!=='products');if(page==='team')loadTeam().catch(e=>toast(e.message));if(page==='connections'){loadCollectorDownload();if((state.team?.role||'admin')==='admin'){loadCrmebAuthConnections();loadCrmebPublishConnections();loadTigshopConnection().catch(e=>{$('#tigshopConnectionStatus').textContent=e.message;recordConnectionPart('tigshop','auth',{error:true});});}}});
document.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{filter=b.dataset.filter;document.querySelectorAll('[data-filter]').forEach(x=>x.classList.toggle('active',x===b));render();});$('#search').oninput=render;
let editingSpecNames=[];
function readSkuRows(){
 return [...$('#skuRows').children].map(tr=>{
  const value=key=>tr.querySelector('[data-key="'+key+'"]').value;
  const row={sku:value('sku'),cost:Number(value('cost')),price:Number(value('price')),stock:Number(value('stock')),image:value('image')};
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
 const tr=document.createElement('tr');tr.dataset.legacySpec=s.spec||'';
 const fields=[{key:'sku',value:s.sku},...(editingSpecNames.length?editingSpecNames.map((name,i)=>({key:'specValue'+i,value:s.spec_values?.[i]||'',label:name})):[{key:'spec',value:s.spec}]),...['cost','price','stock'].map(key=>({key,value:s[key]}))];
 tr.innerHTML=fields.map(({key,value,label})=>`<td><input aria-label="${esc(label||key)}" data-key="${key}" value="${esc(value)}" ${['cost','price','stock'].includes(key)?`type="number" min="0" step="${key==='stock'?'1':'0.01'}"`:'type="text"'} required></td>`).join('')+'<td><button type="button" class="text" data-remove-sku>×</button></td>';
 if(editingSpecNames.length&&s.spec&&(!s.spec_values||s.spec_values.some(v=>!v))){const old=document.createElement('small');old.textContent='原规格：'+s.spec;tr.firstElementChild.append(old);}
 const cell=document.createElement('td'),img=document.createElement('img');img.className='thumb';img.alt='规格图片';img.referrerPolicy='no-referrer';img.loading='lazy';
 const input=document.createElement('input');input.type='url';input.dataset.key='image';input.setAttribute('aria-label','SKU 图片地址');input.placeholder='未设置时使用商品首图';input.value=s.image||'';
 const show=()=>{img.hidden=!input.value;if(input.value.startsWith('https://'))img.src=input.value;else img.removeAttribute('src');};input.oninput=show;show();cell.append(img,input);tr.insertBefore(cell,tr.lastElementChild);tr.querySelector('[data-remove-sku]').onclick=()=>tr.remove();$('#skuRows').append(tr);
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
const imageFields={images:'mainImageGallery',detail_images:'detailImageGallery'};
function imageLinks(field){return $('#productForm').elements[field].value.split('\n').map(x=>x.trim()).filter(Boolean);}
function renderImageGallery(field){
 const gallery=$('#'+imageFields[field]),links=imageLinks(field);gallery.replaceChildren();
 if(!links.length){const hint=document.createElement('p');hint.className='hint';hint.textContent=field==='images'?'尚未添加主图':'尚未添加详情图';gallery.append(hint);return;}
 links.forEach((url,index)=>{
  const card=document.createElement('div');card.className='image-card';
  const preview=document.createElement('button');preview.type='button';preview.className='image-preview';preview.setAttribute('aria-label',`放大${field==='images'?'主图':'详情图'} ${index+1}`);
  const img=document.createElement('img');img.alt=`图片 ${index+1}`;img.loading='lazy';img.referrerPolicy='no-referrer';
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
  footer.append(label,remove);card.append(preview,footer);gallery.append(card);
 });
}
for(const field of Object.keys(imageFields))$('#productForm').elements[field].addEventListener('input',()=>renderImageGallery(field));
$('#closeImageViewer').onclick=()=>{$('#imageViewer').close();$('#imageViewerImage').removeAttribute('src');};
function edit(p=null){editing=p;$('#editorTitle').textContent=p?'编辑商品':'添加商品';const f=$('#productForm');f.reset();f.elements.catalog_target.value=p?.catalog_target||'crmeb-pro';f.elements.applicable_type.value=String(p?.applicable_type??0);$('#storeScopeField').classList.toggle('hidden',f.elements.catalog_target.value!=='crmeb-store');$('#batchPriceMode').onchange();for(const key of ['source_url','title','description'])f.elements[key].value=p?.[key]||'';f.elements.tag_ids.value=(p?.tag_ids||[]).join(',');f.elements.virtual_sales.value=p?.virtual_sales??0;f.elements.source_url.readOnly=!!p;f.elements.images.value=p?.images.join('\n')||'';f.elements.detail_images.value=(p?.detail_images||[]).join('\n');for(const field of Object.keys(imageFields))renderImageGallery(field);editingSpecNames=[...(p?.spec_names||[])];$('#specNames').value=editingSpecNames.join(', ');renderSkuHeader();$('#skuRows').innerHTML='';(p?.skus||[]).forEach(skuRow);$('#sourcingHint').textContent=p?.sourcing?`1688 采购参考价：${p.sourcing.purchase_price||'未提供'}；代发价：${p.sourcing.dropship_price||'未提供'}；来源类目：${p.sourcing.category||'未提供'}；来源标签：${p.sourcing.tags||'未提供'}；供应商销量：${p.sourcing.supplier_sales||'未提供'}（不计入商城销量）。请补充完整规格，再确认成本、售价与库存。`:'';$('#editor').showModal();loadCatalogOptions(p).catch(e=>{$('#catalogStatus').textContent=e.message;});}
async function loadCatalogOptions(p=null,force=false){
 for(const kind of ['category','brand']){$('#'+kind+'Search').value='';$('#'+kind+'Matches').textContent='';$('#'+kind+'Select').size=1;}
 const request=++catalogRequest;catalog=null;const target=p?.catalog_target||$('#catalogTarget').value;
 const categoryId=p?.category_id||0,brandIds=p?.brand_ids||[],brandId=brandIds.at(-1)||0;
 $('#categorySelect').innerHTML=`<option value="${categoryId}">${esc(categoryId?(p?.category||'原分类')+'（等待校验）':'正在读取商城分类…')}</option>`;
 $('#brandSelect').innerHTML=`<option value="${brandId}">${esc(brandId?'原品牌（等待校验）':'不设置品牌')}</option>`;
 $('#categorySelect').disabled=$('#brandSelect').disabled=true;
 $('#catalogStatus').textContent='正在从所选商城读取分类和品牌…';
 try{
  const data=await api('/api/catalog/'+target+(force?'?refresh=1':''));if(request!==catalogRequest)return;catalog=data;
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
 }catch(e){if(request===catalogRequest)$('#catalogStatus').textContent='读取商城选项失败，请点刷新重试：'+e.message;}
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
$('#catalogTarget').onchange=()=>{$('#storeScopeField').classList.toggle('hidden',$('#catalogTarget').value!=='crmeb-store');$('#productForm').elements.applicable_type.value='0';$('#productForm').elements.tag_ids.value='';loadCatalogOptions({catalog_target:$('#catalogTarget').value,category_id:0,brand_ids:[]});};
$('#refreshCatalog').onclick=()=>{
 const f=$('#productForm'),brand=catalog?.brands.find(x=>x.id===Number(f.elements.brand_id.value));
 loadCatalogOptions({catalog_target:$('#catalogTarget').value,category_id:Number(f.elements.category_id.value),category:f.elements.category_id.selectedOptions[0]?.textContent,brand_ids:brand?.ids||editing?.brand_ids||[]},true);
};
$('#newButton').onclick=()=>edit();$('#closeEditor').onclick=()=>$('#editor').close();$('#addSku').onclick=()=>skuRow();
$('#detailImagesFile').onchange=async e=>{
 try{const file=e.target.files[0];if(!file)return;if(file.size>2*1024*1024)throw Error('采集文件请小于 2 MB');const images=detailImagesFromJSON($('#productForm').elements.source_url.value,JSON.parse(await file.text()));$('#productForm').elements.detail_images.value=images.join('\n');renderImageGallery('detail_images');toast(`已填入 ${images.length} 张详情图，请检查后保存商品`);}catch(e){toast(e.message);}finally{e.target.value='';}
};
$('#copyDetailHTML').onclick=async()=>{
 try{const f=$('#productForm');const html=detailHTML(f.elements.description.value,f.elements.detail_images.value.split('\n').map(x=>x.trim()).filter(Boolean));await navigator.clipboard.writeText(html);toast('详情 HTML 已复制，可粘贴到商城商品详情的源码编辑框后保存');}catch(e){toast(e.message||'复制失败，请检查浏览器剪贴板权限');}
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
$('#productRows').onclick=async e=>{const b=e.target.closest('button');if(!b)return;try{if(b.dataset.edit)edit(state.products.find(p=>p.id===b.dataset.edit));if(b.dataset.approve){const p=state.products.find(p=>p.id===b.dataset.approve);if(!confirm('确认图片、分类、所有规格与售价无误，将当前版本标记为审核通过？'))return;await api('/api/products/'+p.id+'/approve','POST',{revision:p.revision});await load();toast('审核通过，可以创建发布任务');}if(b.dataset.publish){publishing=state.products.find(p=>p.id===b.dataset.publish);$('#publishTitle').textContent=publishing.title;$('#target').innerHTML=state.targets.filter(t=>!publishing.category_id||t.id===(publishing.catalog_target||'crmeb-pro')).map(t=>`<option value="${t.id}" ${t.configured?'':'disabled'}>${esc(t.name)}${t.configured?'':'（未配置连接）'}</option>`).join('');$('#publishDialog').showModal();}}catch(e){toast(e.message);}};
$('#productForm').onsubmit=async e=>{e.preventDefault();const b=e.submitter;b.disabled=true;try{const f=e.target,p={};for(const k of ['source_url','title','description'])p[k]=f.elements[k].value;const tags=f.elements.tag_ids.value.trim();p.tag_ids=tags?tags.split(/[,，\s]+/).map(Number):[];p.catalog_target=f.elements.catalog_target.value;if(p.catalog_target==='crmeb-store')p.applicable_type=Number(f.elements.applicable_type.value);p.category_id=Number(f.elements.category_id.value);p.category=catalog?.categories.find(x=>x.id===p.category_id)?.label||'';const brandId=Number(f.elements.brand_id.value);const brand=catalog?.brands.find(x=>x.id===brandId);if(brandId&&!brand)throw Error('请刷新后选择有效商城品牌');p.brand_ids=brand?.ids||[];p.virtual_sales=Number(f.elements.virtual_sales.value);p.detail_images=f.elements.detail_images.value.split('\n').map(x=>x.trim()).filter(Boolean);p.images=f.elements.images.value.split('\n').map(x=>x.trim()).filter(Boolean);const pendingNames=$('#specNames').value.split(/[,，]/).map(v=>v.trim()).filter(Boolean);if(JSON.stringify(pendingNames)!==JSON.stringify(editingSpecNames))throw Error('请先点击应用规格列，再保存商品');p.skus=readSkuRows();if(editingSpecNames.length)p.spec_names=[...editingSpecNames];specificationMatrix(p);if(editing){p.revision=editing.revision;if(editing.sourcing)p.sourcing=editing.sourcing;}await api(editing?'/api/products/'+editing.id:'/api/products',editing?'PUT':'POST',p);$('#editor').close();await load();toast('商品已保存为待整理');}catch(e){toast(e.message);}finally{b.disabled=false;}};
$('#importButton').onclick=()=>{$('#importResult').textContent='';$('#importDialog').showModal();};$('#closeImport').onclick=()=>$('#importDialog').close();$('#importFile').onchange=async e=>{const file=e.target.files[0];if(file){if(file.size>2*1024*1024)return toast('文件请小于 2 MB');$('#importText').value=await file.text();}};
$('#importForm').onsubmit=async e=>{e.preventDefault();const b=e.submitter;b.disabled=true;try{const r=await api('/api/import','POST',(/^[\s\uFEFF]*[\[{]/.test($('#importText').value)?JSON.parse($('#importText').value.replace(/^\uFEFF/,'')):{table:$('#importText').value}));$('#importResult').textContent=r.results.map(x=>`第 ${x.index+1} 件：${x.ok?'导入成功':x.error}`).join('\n');await load();toast(`成功导入 ${r.results.filter(x=>x.ok).length} 件商品`);}catch(e){toast(e.message);}finally{b.disabled=false;}};
$('#closePublish').onclick=()=>$('#publishDialog').close();$('#publishForm').onsubmit=async e=>{e.preventDefault();const b=e.submitter;b.disabled=true;try{await api('/api/products/'+publishing.id+'/publish','POST',{revision:publishing.revision,target:$('#target').value});$('#publishDialog').close();await load();toast('发布任务已记录，请查看任务列表');}catch(e){toast(e.message);}finally{b.disabled=false;}};
$('#refresh').onclick=()=>load().catch(e=>toast(e.message));$('#logout').onclick=async()=>{try{await api('/auth/logout','POST',{});location.reload();}catch(e){toast(e.message);}};
async function init(){try{me=await api('/api/me');$('#mode').textContent=me.demo?'本地演示 · 不执行发布':'内部运营空间';if(!me.user){$('#login').classList.remove('hidden');$('#loginHint').textContent=me.demo?'演示模式仅限本机，所有数据保存在本机数据库。':me.authReady?'使用你的统一账号继续。':'服务已启动，等待管理员配置 Casdoor 应用和账号允许名单。';return;}$('#username').textContent=me.user.name;$('#logout').classList.remove('hidden');$('#workspace').classList.remove('hidden');await load();setInterval(()=>{if(['products','jobs'].includes(page)&&!document.querySelector('dialog[open]'))load().catch(()=>{});},10000);}catch(e){toast(e.message);}}
init();

$('#jobRows').onclick=async e=>{const b=e.target.closest('button');if(!b)return;try{if(b.dataset.recoverStock){const r=await api('/api/jobs/'+b.dataset.recoverStock+'/recover-zero-stock','POST',{});toast(r.message);}if(b.dataset.verify){const id=prompt('从商城仓库找到任务编码对应的商品，输入数字商品 ID。此操作只读取详情核对，不会再次创建商品。');if(id===null)return;await api('/api/jobs/'+b.dataset.verify+'/verify','POST',{remote_id:id.trim()});toast('核对请求已提交，请等待结果');}if(b.dataset.retry){if(!confirm('仅重发尚未领取创建操作的任务；已领取的创建操作不会被重复执行。继续？'))return;await api('/api/jobs/'+b.dataset.retry+'/retry','POST',{});toast('已重发同一任务');}await load();}catch(e){toast(e.message);}};

let tigshopConnection=null,tigshopFX=null;
async function loadTigshopConnection(){
 tigshopConnection=await api('/api/connections/tigshop');
 recordConnectionPart('tigshop','auth',tigshopConnection);
 $('#tigshopToken').placeholder=tigshopConnection.configured?'已保存 Token；留空保留，输入新值可更换':'填写 API Token';
 $('#tigshopConnectionStatus').textContent=tigshopConnection.configured?'已保存 API Token · 最近连接检查 '+date(tigshopConnection.testedAt):'请填写 API Token，然后测试连接。';
 if(tigshopConnection.templateId&&!$('#tigshopTemplate').querySelector('option[value="'+tigshopConnection.templateId+'"]'))$('#tigshopTemplate').innerHTML=`<option value="${tigshopConnection.templateId}">已保存模板 ${tigshopConnection.templateId}（测试连接可读取名称）</option>`;
 if(tigshopConnection.templateId)$('#tigshopTemplate').value=String(tigshopConnection.templateId);
}
function tigshopBusy(busy){for(const id of ['testTigshop','saveTigshop','tigshopToken','tigshopTemplate'])$('#'+id).disabled=busy;}
$('#testTigshop').onclick=async()=>{
 tigshopBusy(true);$('#tigshopConnectionStatus').textContent='正在检查 Token、分类、品牌及运费模板…';
 try{
  const result=await api('/api/connections/tigshop/test','POST',{token:$('#tigshopToken').value.trim()});
  const current=Number($('#tigshopTemplate').value)||tigshopConnection?.templateId||0;
  $('#tigshopTemplate').innerHTML='<option value="0">请选择运费模板</option>'+result.templates.map(t=>`<option value="${t.id}">${esc(t.name)}（${t.id}）${t.isDefault?' · 商城默认':''}</option>`).join('');
  const selected=result.templates.some(t=>t.id===current)?current:result.templates.find(t=>t.isDefault)?.id||0;$('#tigshopTemplate').value=String(selected);
  $('#tigshopConnectionStatus').textContent=`连接成功：${result.categories} 个分类、${result.brands} 个品牌。请选择模板并保存。`;
 }catch(e){$('#tigshopConnectionStatus').textContent=e.message;}finally{tigshopBusy(false);}
};
$('#tigshopConnectionForm').onsubmit=async e=>{
 e.preventDefault();tigshopBusy(true);
 try{await api('/api/connections/tigshop','POST',{token:$('#tigshopToken').value.trim(),templateId:Number($('#tigshopTemplate').value)});$('#tigshopToken').value='';await loadTigshopConnection();await load();toast('Tigshop 连接已保存');}
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
  try{const c=await api('/api/connections/'+target+'/auth');recordConnectionPart(target,'auth',c);$('#'+target+'-appsecret').placeholder=c.configured?'已保存 AppSecret；留空保留，输入新值可更换':'填写 AppSecret';$('#'+target+'-appid').value=c.appid;$('#'+target+'-brand-status').textContent=c.configured?'商城发布凭证已保存'+(c.testedAt?' · '+date(c.testedAt):''):'请填写此商城的 AppID 和 AppSecret，发布时由 OPS 统一获取授权。';}
  catch(e){$('#'+target+'-brand-status').textContent=e.message;recordConnectionPart(target,'auth',{error:true});}
 }));
}
async function saveCrmebAuthConnection(target,testOnly){
 const form=document.querySelector('[data-crmeb-auth="'+target+'"]');
 form.querySelectorAll('input,button').forEach(x=>x.disabled=true);
 $('#'+target+'-brand-status').textContent='正在验证商城授权…';
 try{
  const r=await api('/api/connections/'+target+'/auth'+(testOnly?'/test':''),'POST',{appid:$('#'+target+'-appid').value.trim(),appsecret:$('#'+target+'-appsecret').value});
  if(!testOnly){$('#'+target+'-appsecret').value='';await loadCrmebAuthConnections([target]);}
  $('#'+target+'-brand-status').textContent=r.message+(testOnly?'。请点击保存连接。':'');
 }catch(e){$('#'+target+'-brand-status').textContent=e.message;}finally{form.querySelectorAll('input,button').forEach(x=>x.disabled=false);}
}
for(const form of document.querySelectorAll('[data-crmeb-auth]'))form.onsubmit=e=>{e.preventDefault();saveCrmebAuthConnection(form.dataset.crmebAuth,false);};
for(const button of document.querySelectorAll('[data-test-auth]'))button.onclick=()=>saveCrmebAuthConnection(button.dataset.testAuth,true);

async function loadCrmebPublishConnections(targets=['crmeb-pro','crmeb-store']){
 await Promise.all(targets.map(async target=>{
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
  $('#collectorVersion').textContent='v'+release.version;
  $('#collectorDownload').classList.remove('hidden');
  $('#collectorDownloadStatus').textContent='当前版本 v'+release.version+' · '+Math.ceil(release.bytes/1024)+' KB · 适用于 Chrome / Edge';
 }catch(e){$('#collectorVersion').textContent='暂不可用';$('#collectorDownload').classList.add('hidden');$('#collectorDownloadStatus').textContent=e.message;$('#refreshCollectorDownload').classList.remove('hidden');}
}
$('#refreshCollectorDownload').onclick=loadCollectorDownload;
