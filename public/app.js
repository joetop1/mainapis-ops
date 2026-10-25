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
async function load(){state=await api('/api/state');render();}
function render(){
 $('#total').textContent=state.products.length;$('#drafts').textContent=state.products.filter(p=>p.status==='draft').length;$('#approved').textContent=state.products.filter(p=>p.status==='approved').length;$('#success').textContent=state.jobs.filter(j=>j.status==='succeeded').length;
 const search=$('#search').value.toLowerCase(),products=state.products.filter(p=>(filter==='all'||p.status===filter)&&`${p.title} ${p.source_url}`.toLowerCase().includes(search));
 $('#count').textContent=`显示 ${products.length} 件 / 已加载 ${state.products.length} 件商品（最多 1000 件）`;
 $('#productRows').innerHTML=products.map(p=>`<tr><td><div class="product-cell">${p.images[0]?`<img class="thumb" loading="lazy" referrerpolicy="no-referrer" src="${esc(p.images[0])}" alt="">`:'<div class="thumb">▧</div>'}<div><div class="title">${esc(p.title||'待采集 · '+p.source_url.match(/offer\/(\d+)/)?.[1])}</div><small>${esc(p.category||'尚未分类')} · v${p.revision}</small></div></div></td><td><a href="${esc(p.source_url)}" target="_blank" rel="noopener noreferrer">1688 ↗</a></td><td>${p.skus.length} 个规格<small>${p.skus.length?'¥ '+Math.min(...p.skus.map(s=>s.price)).toFixed(2)+' 起':'尚未录入价格'}</small></td><td><span class="badge ${p.status}">${labels[p.status]}</span></td><td>${date(p.updated)}</td><td><button class="text" data-edit="${p.id}">编辑</button>${p.status==='approved'?`<button class="text" data-publish="${p.id}">发布</button>`:`<button class="text" data-approve="${p.id}">审核</button>`}</td></tr>`).join('')||empty(6,'采集箱已准备好','添加 1688 商品链接，或导入采集器整理好的 JSON 商品资料。');
 $('#jobRows').innerHTML=state.jobs.map(j=>`<tr><td>${esc(state.products.find(p=>p.id===j.product_id)?.title||'商品记录')}<small>${j.id.slice(0,8)} · v${j.revision}</small></td><td>${esc(state.targets.find(t=>t.id===j.target)?.name||j.target)}</td><td><span class="badge ${j.status}">${labels[j.status]||esc(j.status)}</span></td><td>${esc(j.message||'等待执行')}${j.remote_id?`<small>商城商品 ID：${esc(j.remote_id)}</small>`:''}${j.claimed?`<small>任务编码：${esc(j.marker)}</small>`:''}${['crmeb-pro','crmeb-store','tigshop'].includes(j.target)&&j.claimed&&!['succeeded','failed'].includes(j.status)?`<button class="text" data-verify="${j.id}">填写商品 ID 核对</button>`:''}${['crmeb-pro','crmeb-store','tigshop'].includes(j.target)&&!j.claimed&&['accepted','unknown'].includes(j.status)?`<button class="text" data-retry="${j.id}">重发未领取任务</button>`:''}</td><td>${date(j.created)}</td></tr>`).join('')||empty(5,'还没有发布任务','审核商品后，选择一个目标商城创建发布任务。');
 const connections=[{name:'Casdoor 统一认证',url:'auth.mainapis.com',status:me.demo?'本地演示登录':'已通过身份验证',detail:'只有服务器允许名单中的账号可以进入运营台。'},{name:'n8n 工作流',url:'n8n.mainapis.com',status:state.connections.n8n==='configured'?'参数已配置 · 待联调':'待配置',detail:'参数已配置不代表已连通。真实执行成功后回传商城商品 ID。'},...state.targets.map(t=>({name:t.name+' '+t.version,url:t.url.replace('https://','')||'商城地址待配置',status:['crmeb-pro','crmeb-store','tigshop'].includes(t.id)?(t.configured?'官方流程已配置 · 待核验':'待配置独立连接'):'发布尚未接入',detail:['crmeb-pro','crmeb-store','tigshop'].includes(t.id)?'使用官方接口；来源链接保存在 OPS，新建后核对商品 ID。':'此商城发布尚未接入。'}))];
 $('#connectionCards').innerHTML=connections.map(c=>`<article class="connection-card"><h2>${esc(c.name)}</h2><span class="badge">${esc(c.status)}</span><p><code>${esc(c.url)}</code></p><p>${esc(c.detail)}</p></article>`).join('');
}
document.querySelectorAll('[data-page]').forEach(b=>b.onclick=()=>{page=b.dataset.page;document.querySelectorAll('[data-page]').forEach(x=>x.classList.toggle('active',x===b));for(const p of ['products','jobs','connections'])$('#'+p).classList.toggle('hidden',p!==page);const titles={products:'商品采集箱',jobs:'发布任务',connections:'连接与配置'};$('#heading').textContent=$('#breadcrumb').textContent=titles[page];$('#subtitle').textContent={products:'让每一份货源资料，成为准备好上架的商品。',jobs:'从任务接收到商城入库，每一步都有记录。',connections:'连接你的账号、工作流与商城。'}[page];$('#productActions').classList.toggle('hidden',page!=='products');});
document.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{filter=b.dataset.filter;document.querySelectorAll('[data-filter]').forEach(x=>x.classList.toggle('active',x===b));render();});$('#search').oninput=render;
function skuRow(s={sku:'',spec:'',cost:0,price:0,stock:0}){const tr=document.createElement('tr');tr.innerHTML=['sku','spec','cost','price','stock'].map(k=>`<td><input aria-label="${k}" data-key="${k}" value="${esc(s[k])}" ${['cost','price','stock'].includes(k)?`type="number" min="0" step="${k==='stock'?'1':'0.01'}"`:'type="text"'} required></td>`).join('')+'<td><button type="button" class="text" data-remove-sku>×</button></td>';const cell=document.createElement('td');const img=document.createElement('img');img.className='thumb';img.alt='规格图片';img.referrerPolicy='no-referrer';img.loading='lazy';const input=document.createElement('input');input.type='url';input.dataset.key='image';input.setAttribute('aria-label','SKU 图片地址');input.placeholder='未设置时使用商品首图';input.value=s.image||'';const show=()=>{img.hidden=!input.value;if(input.value.startsWith('https://'))img.src=input.value;else img.removeAttribute('src');};input.oninput=show;show();cell.append(img,input);tr.insertBefore(cell,tr.lastElementChild);tr.querySelector('[data-remove-sku]').onclick=()=>tr.remove();$('#skuRows').append(tr);}
function edit(p=null){editing=p;$('#editorTitle').textContent=p?'编辑商品':'添加商品';const f=$('#productForm');f.reset();f.elements.catalog_target.value=p?.catalog_target||'crmeb-pro';$('#batchPriceMode').onchange();for(const key of ['source_url','title','description'])f.elements[key].value=p?.[key]||'';f.elements.tag_ids.value=(p?.tag_ids||[]).join(',');f.elements.virtual_sales.value=p?.virtual_sales??0;f.elements.source_url.readOnly=!!p;f.elements.images.value=p?.images.join('\n')||'';$('#skuRows').innerHTML='';(p?.skus||[]).forEach(skuRow);$('#sourcingHint').textContent=p?.sourcing?`1688 采购参考价：${p.sourcing.purchase_price||'未提供'}；代发价：${p.sourcing.dropship_price||'未提供'}；来源类目：${p.sourcing.category||'未提供'}；来源标签：${p.sourcing.tags||'未提供'}；供应商销量：${p.sourcing.supplier_sales||'未提供'}（不计入商城销量）。请补充完整规格，再确认成本、售价与库存。`:'';$('#editor').showModal();loadCatalogOptions(p).catch(e=>{$('#catalogStatus').textContent=e.message;});}
async function loadCatalogOptions(p=null,force=false){
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
$('#catalogTarget').onchange=()=>{$('#productForm').elements.tag_ids.value='';loadCatalogOptions({catalog_target:$('#catalogTarget').value,category_id:0,brand_ids:[]});};
$('#refreshCatalog').onclick=()=>{
 const f=$('#productForm'),brand=catalog?.brands.find(x=>x.id===Number(f.elements.brand_id.value));
 loadCatalogOptions({catalog_target:$('#catalogTarget').value,category_id:Number(f.elements.category_id.value),category:f.elements.category_id.selectedOptions[0]?.textContent,brand_ids:brand?.ids||editing?.brand_ids||[]},true);
};
$('#newButton').onclick=()=>edit();$('#closeEditor').onclick=()=>$('#editor').close();$('#addSku').onclick=()=>skuRow();
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
$('#applyBatchPrice').onclick=()=>{
 try{
  const rows=[...$('#skuRows').children];
  const prices=batchPrices(rows.map(row=>row.querySelector('[data-key="cost"]').value),$('#batchPriceMode').value,$('#batchPriceValue').value);
  rows.forEach((row,i)=>{row.querySelector('[data-key="price"]').value=prices[i];});
  toast(`已设置 ${prices.length} 个规格的售价，请检查后保存商品`);
 }catch(e){toast(e.message);}
};
$('#productRows').onclick=async e=>{const b=e.target.closest('button');if(!b)return;try{if(b.dataset.edit)edit(state.products.find(p=>p.id===b.dataset.edit));if(b.dataset.approve){const p=state.products.find(p=>p.id===b.dataset.approve);if(!confirm('确认图片、分类、所有规格与售价无误，将当前版本标记为审核通过？'))return;await api('/api/products/'+p.id+'/approve','POST',{revision:p.revision});await load();toast('审核通过，可以创建发布任务');}if(b.dataset.publish){publishing=state.products.find(p=>p.id===b.dataset.publish);$('#publishTitle').textContent=publishing.title;$('#target').innerHTML=state.targets.filter(t=>!publishing.category_id||t.id===(publishing.catalog_target||'crmeb-pro')).map(t=>`<option value="${t.id}" ${t.configured?'':'disabled'}>${esc(t.name)}${t.configured?'':'（未配置连接）'}</option>`).join('');$('#publishDialog').showModal();}}catch(e){toast(e.message);}};
$('#productForm').onsubmit=async e=>{e.preventDefault();const b=e.submitter;b.disabled=true;try{const f=e.target,p={};for(const k of ['source_url','title','description'])p[k]=f.elements[k].value;const tags=f.elements.tag_ids.value.trim();p.tag_ids=tags?tags.split(/[,，\s]+/).map(Number):[];p.catalog_target=f.elements.catalog_target.value;p.category_id=Number(f.elements.category_id.value);p.category=catalog?.categories.find(x=>x.id===p.category_id)?.label||'';const brandId=Number(f.elements.brand_id.value);const brand=catalog?.brands.find(x=>x.id===brandId);if(brandId&&!brand)throw Error('请刷新后选择有效商城品牌');p.brand_ids=brand?.ids||[];p.virtual_sales=Number(f.elements.virtual_sales.value);p.images=f.elements.images.value.split('\n').map(x=>x.trim()).filter(Boolean);p.skus=[...$('#skuRows').children].map(tr=>Object.fromEntries([...tr.querySelectorAll('input')].map(i=>[i.dataset.key,i.type==='number'?Number(i.value):i.value])));if(editing){p.revision=editing.revision;if(editing.sourcing)p.sourcing=editing.sourcing;}await api(editing?'/api/products/'+editing.id:'/api/products',editing?'PUT':'POST',p);$('#editor').close();await load();toast('商品已保存为待整理');}catch(e){toast(e.message);}finally{b.disabled=false;}};
$('#importButton').onclick=()=>{$('#importResult').textContent='';$('#importDialog').showModal();};$('#closeImport').onclick=()=>$('#importDialog').close();$('#importFile').onchange=async e=>{const file=e.target.files[0];if(file){if(file.size>2*1024*1024)return toast('文件请小于 2 MB');$('#importText').value=await file.text();}};
$('#importForm').onsubmit=async e=>{e.preventDefault();const b=e.submitter;b.disabled=true;try{const r=await api('/api/import','POST',(/^[\s\uFEFF]*[\[{]/.test($('#importText').value)?JSON.parse($('#importText').value.replace(/^\uFEFF/,'')):{table:$('#importText').value}));$('#importResult').textContent=r.results.map(x=>`第 ${x.index+1} 件：${x.ok?'导入成功':x.error}`).join('\n');await load();toast(`成功导入 ${r.results.filter(x=>x.ok).length} 件商品`);}catch(e){toast(e.message);}finally{b.disabled=false;}};
$('#closePublish').onclick=()=>$('#publishDialog').close();$('#publishForm').onsubmit=async e=>{e.preventDefault();const b=e.submitter;b.disabled=true;try{await api('/api/products/'+publishing.id+'/publish','POST',{revision:publishing.revision,target:$('#target').value});$('#publishDialog').close();await load();toast('发布任务已记录，请查看任务列表');}catch(e){toast(e.message);}finally{b.disabled=false;}};
$('#refresh').onclick=()=>load().catch(e=>toast(e.message));$('#logout').onclick=async()=>{try{await api('/auth/logout','POST',{});location.reload();}catch(e){toast(e.message);}};
async function init(){try{me=await api('/api/me');$('#mode').textContent=me.demo?'本地演示 · 不执行发布':'内部运营空间';if(!me.user){$('#login').classList.remove('hidden');$('#loginHint').textContent=me.demo?'演示模式仅限本机，所有数据保存在本机数据库。':me.authReady?'使用你的统一账号继续。':'服务已启动，等待管理员配置 Casdoor 应用和账号允许名单。';return;}$('#username').textContent=me.user.name;$('#logout').classList.remove('hidden');$('#workspace').classList.remove('hidden');await load();setInterval(()=>{if(page==='jobs'&&!document.querySelector('dialog[open]'))load().catch(()=>{});},10000);}catch(e){toast(e.message);}}
init();

$('#jobRows').onclick=async e=>{const b=e.target.closest('button');if(!b)return;try{if(b.dataset.verify){const id=prompt('从商城仓库找到任务编码对应的商品，输入数字商品 ID。此操作只读取详情核对，不会再次创建商品。');if(id===null)return;await api('/api/jobs/'+b.dataset.verify+'/verify','POST',{remote_id:id.trim()});toast('核对请求已提交，请等待结果');}if(b.dataset.retry){if(!confirm('仅重发尚未领取创建操作的任务；已领取的创建操作不会被重复执行。继续？'))return;await api('/api/jobs/'+b.dataset.retry+'/retry','POST',{});toast('已重发同一任务');}await load();}catch(e){toast(e.message);}};
