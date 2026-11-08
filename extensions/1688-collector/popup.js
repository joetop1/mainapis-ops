import {draftCache} from './draft-cache.js';
import {collectTaobao} from './taobao.js';
import {canonicalSourceURL} from './source-url.js';
import {collect1688} from './collector.js';
import {fillMerchant554Images} from './merchant-images.js';
const $=s=>document.querySelector(s),OPS='https://ops.mainapis.com';
function activeCollector(tab){if(!tab?.id)throw Error('请打开1688、淘宝或天猫商品详情页');const url=canonicalSourceURL(tab.url);return new URL(url).hostname==='detail.1688.com'?collect1688:collectTaobao;}
const drafts=draftCache({storage:chrome.storage.local});let draftTimer;
const status=message=>{$('#status').textContent=message;};
function preview(result){
 if(result?.error)throw Error(result.error);if(!result?.product)throw Error('页面未返回商品数据，请刷新后重试');
 $('#preview').hidden=false;$('#title').textContent=result.product.title||'标题待补充';$('#counts').textContent=`${result.product.images.length} 张主图 · ${result.product.detail_images?.length||0} 张详情图 · ${result.product.skus.length} 个 SKU · ${result.product.spec_names?.length||(result.product.skus.length?1:0)} 个规格维度`;
 $('#skuPreview').replaceChildren(...result.product.skus.slice(0,5).map(s=>{const p=document.createElement('p');p.textContent=s.spec+' · 参考成本 ¥'+s.cost+(s.image?' · 已配图':' · 未配图');if(s.image){const img=document.createElement('img');img.src=s.image;img.alt=s.spec;img.width=48;img.height=48;img.referrerPolicy='no-referrer';img.style.objectFit='cover';p.prepend(img);}return p;}));
 $('#warnings').replaceChildren(...(result.warnings||[]).map(message=>{const li=document.createElement('li');li.textContent=message;return li;}));
 $('#attributePreview').textContent=(result.product.attributes||[]).map(row=>row.name+'：'+row.value).join('\n')||'未识别到产品参数，可在 OPS 补充。';
 $('#json').value=JSON.stringify({products:[result.product]},null,2);
}
async function busy(button,work){button.disabled=true;try{await work();}catch(e){status(e.message||'操作失败，请重试');}finally{button.disabled=false;}}
$('#open').onclick=()=>chrome.tabs.create({url:OPS+'/'});
$('#collect').onclick=e=>busy(e.currentTarget,async()=>{
 const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
 const collector=activeCollector(tab);
 status('正在读取已加载的商品资料…');
 const [out]=await chrome.scripting.executeScript({target:{tabId:tab.id},world:'MAIN',func:collector});
 clearTimeout(draftTimer);preview(out.result);const cached=await drafts.save(out.result);status(cached.saved?'采集预览已生成，请核对后导入。':'采集成功，但浏览器未能缓存草稿。请保持窗口打开，直接导入或下载JSON；关闭后可能需要重新采集。');
});
// Runs in an isolated OPS tab. Credentials and CSRF never leave that tab.
export async function quoteIntoOps(product){
 if(location.origin!=='https://ops.mainapis.com')return {error:'OPS 地址不匹配'};
 try{const meResponse=await fetch('/api/me',{credentials:'same-origin',redirect:'error',signal:AbortSignal.timeout(15000)});if(!meResponse.ok)return {error:'无法读取OPS登录状态'};const me=await meResponse.json();if(!me.user||!me.csrf)return {error:'请先在OPS标签页登录，再返回插件。'};
  const response=await fetch('/api/billing/quote',{method:'POST',credentials:'same-origin',redirect:'error',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/json','X-CSRF-Token':me.csrf},body:JSON.stringify({kind:'collect',quantity:1,source_url:product.source_url})});const quote=await response.json();if(!response.ok)return {error:quote.error||'费用预估失败，请更新OPS后重试'};
  const owner=me.team?.id||me.user.sub;if(quote.owner!==owner||!Number.isSafeInteger(quote.due)||quote.due<0||!Number.isSafeInteger(quote.revision))return {error:'费用预估回执无效，请更新OPS后重试'};
  return {quote:{...quote,source_url:product.source_url}};
 }catch{return {error:'费用预估未完成，未导入或扣点，请检查OPS连接。'};}
}
export async function importIntoOps(product,confirmed){
 if(location.origin!=='https://ops.mainapis.com')return {error:'OPS 地址不匹配'};
 try{
  const meResponse=await fetch('/api/me',{credentials:'same-origin',redirect:'error',signal:AbortSignal.timeout(15000)});if(!meResponse.ok)return {error:'无法读取 OPS 登录状态'};const me=await meResponse.json();if(!me.user||!me.csrf)return {error:'请先在 OPS 标签页完成 Casdoor 登录，再返回插件点击导入。'};
  const owner=me.team?.id||me.user.sub;if(!confirmed||confirmed.owner!==owner||confirmed.source_url!==product.source_url)return {error:'工作空间或商品已变化，请重新查看费用并确认'};
  const quoteResponse=await fetch('/api/billing/quote',{method:'POST',credentials:'same-origin',redirect:'error',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/json','X-CSRF-Token':me.csrf},body:JSON.stringify({kind:'collect',quantity:1,source_url:product.source_url})});const quote=await quoteResponse.json();if(!quoteResponse.ok)return {error:quote.error||'费用核对失败，未导入'};
  if(quote.owner!==owner)return {error:'工作空间已变化，请重新查看费用'};if(quote.existing?.id)return {id:quote.existing.id,duplicate:true};
  if(!Number.isSafeInteger(quote.due)||quote.due<0||quote.due>confirmed.due||quote.due>0&&(quote.revision!==confirmed.revision||quote.due!==confirmed.due))return {error:'价格已变化，请重新查看费用并确认，未导入或扣点'};
  if(quote.due>quote.available)return {error:'点数不足，请充值后重新查看费用'};
  const res=await fetch('/api/products',{method:'POST',credentials:'same-origin',redirect:'error',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/json','X-CSRF-Token':me.csrf},body:JSON.stringify({...product,billing_revision:quote.revision,billing_owner:owner})});const data=await res.json();return res.ok?{id:data.id}:{error:data.error||'导入失败'};
 }catch{return {error:'未确认导入结果，请先在OPS按来源链接查找；保留原来源重试不会重复导入或扣点。'};}
}
let pendingImport=null,importing=false;
function cancelImport(){pendingImport=null;$('#billingConfirm').hidden=true;$('#json').disabled=false;$('#collect').disabled=false;}
$('#cancelSend').onclick=()=>{cancelImport();status('已取消导入，未扣点数。');};
$('#send').onclick=e=>busy(e.currentTarget,async()=>{
 if(importing)throw Error('正在提交导入，请等待结果');try{cancelImport();const data=JSON.parse($('#json').value);if(!Array.isArray(data.products)||data.products.length!==1)throw Error('当前仅支持一次导入1件商品。');const product=data.products[0];product.source_url=canonicalSourceURL(product?.source_url);if(JSON.stringify(product).length>1000000)throw Error('商品资料过大，请缩减到1MB以内。');
 const tabs=await chrome.tabs.query({url:OPS+'/*'}),tab=tabs.find(t=>{try{return new URL(t.url).pathname==='/';}catch{return false;}});if(!tab){await chrome.tabs.create({url:OPS+'/'});throw Error('已打开OPS。完成登录后，回到商品页再次查看导入费用。');}
 $('#json').disabled=true;$('#collect').disabled=true;status('正在核对导入目标和费用…');const [out]=await chrome.scripting.executeScript({target:{tabId:tab.id},world:'ISOLATED',func:quoteIntoOps,args:[product]});if(out.result?.error)throw Error(out.result.error);const quote=out.result?.quote;if(!quote)throw Error('未取得费用回执，未导入');
 if(quote.existing?.id){cancelImport();status('当前工作空间已经有这款来源商品，未重复导入或扣点，请到OPS查看。');return;}if(quote.due>quote.available)throw Error('需要'+quote.due+'点，可用'+quote.available+'点，请充值后重试。');
 pendingImport={product,quote,tabId:tab.id};$('#billingTarget').textContent='导入目标：'+quote.workspace;$('#billingCost').textContent=!quote.enabled?'收费未启用，本次不扣点数':quote.exempt?'当前内部工作空间免计费':'本次新增1件商品，扣'+quote.due+'点；可用'+quote.available+'点';$('#confirmSend').textContent=quote.due?'确认导入，扣'+quote.due+'点':'确认导入，不扣点数';$('#billingConfirm').hidden=false;$('#json').disabled=true;$('#collect').disabled=true;status('请核对工作空间和费用后确认。');}catch(error){cancelImport();throw error;}
});
$('#confirmSend').onclick=e=>busy(e.currentTarget,async()=>{
 if(!pendingImport)throw Error('请先查看费用');if(importing)throw Error('正在导入，请稍候');importing=true;$('#send').disabled=true;$('#cancelSend').disabled=true;const request=pendingImport;status('正在导入OPS待整理采集箱…');try{const [out]=await chrome.scripting.executeScript({target:{tabId:request.tabId},world:'ISOLATED',func:importIntoOps,args:[request.product,request.quote]});if(out.result?.error)throw Error(out.result.error);if(!out.result?.id)throw Error('未收到导入结果，请先在OPS核对。');status(out.result.duplicate?'当前工作空间已存在该商品，未重复导入或扣点。':'已导入待整理采集箱。请到OPS设置分类、售价和库存后审核。');}finally{importing=false;$('#send').disabled=false;$('#cancelSend').disabled=false;cancelImport();}
});
$('#download').onclick=()=>{try{const data=JSON.parse($('#json').value);const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='ops-product.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch{status('JSON 格式不正确，请检查预览内容。');}};
$('#json').addEventListener('input',()=>{clearTimeout(draftTimer);draftTimer=setTimeout(async()=>{try{const data=JSON.parse($('#json').value);if(data.products?.length===1){const result=await drafts.save({product:data.products[0],warnings:['已恢复你编辑的采集草稿，请再次核对。']});if(!result.saved)status('修改保留在当前窗口，但未能缓存；请直接导入或下载JSON。');}}catch{}},600);});
const draft=await drafts.read();if(draft){try{preview(draft);status('已恢复上次采集预览；点击「读取当前商品」可替换。');}catch{}}
$('#diagnose').onclick=e=>busy(e.currentTarget,async()=>{
 const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
 const collector=activeCollector(tab);
 const [out]=await chrome.scripting.executeScript({target:{tabId:tab.id},world:'MAIN',func:collector,args:[true]});
 if(!out.result?.diagnostics)throw Error(out.result?.error||'未取得诊断结果');
 $('#diagnostics').hidden=false;$('#diagnosticText').value=JSON.stringify(out.result.diagnostics,null,2);status('诊断已生成，可下载文件用于适配当前页面。');
});
$('#downloadDiagnostic').onclick=()=>{const url=URL.createObjectURL(new Blob([$('#diagnosticText').value],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='ops-product-diagnostic.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
$('#merchantImagesFile').onchange=async e=>{
 try{const file=e.target.files[0];if(!file)return;if(file.size>2*1024*1024)throw Error('文件请小于 2 MB');const data=JSON.parse(await file.text());if(data.products?.length!==1)throw Error('请选择单件商品的采集 JSON');await chrome.storage.local.set({merchantImageProduct:data.products[0]});status('配图文件已就绪，请确认当前打开商品 554 的编辑页，再点击填入。');}catch(e){status(e.message);}
};
$('#fillMerchant').onclick=e=>busy(e.currentTarget,async()=>{
 const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
 const url=new URL(tab?.url||'https://invalid.invalid');if(!['xlupw.com','www.xlupw.com'].includes(url.hostname)||!url.pathname.startsWith('/admin/'))throw Error('请切换到 CRMEB 商品 554 编辑页，再打开插件。');
 const {merchantImageProduct}=await chrome.storage.local.get('merchantImageProduct');if(!merchantImageProduct)throw Error('请先选择含 64 个配图的采集 JSON 文件');
 const [out]=await chrome.scripting.executeScript({target:{tabId:tab.id},world:'MAIN',func:fillMerchant554Images,args:[merchantImageProduct]});
 if(out.result?.error)throw Error(out.result.error);if(!out.result?.ok)throw Error('未确认填入结果，请检查商城表单');status(out.result.message);
});
