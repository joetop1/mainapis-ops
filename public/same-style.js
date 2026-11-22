import {openMergedProduct} from './product-flow.js';
export function styleSourceIds(products){return new Set(products.filter(p=>p.same_style).flatMap(p=>[p.same_style.reference_id,...p.same_style.stock_ids]));}
export function suggestedStyleMatch(stock,reference){
 const normalize=v=>String(v||'').trim().toLowerCase().replace(/\s+/g,'');
 const value=normalize(stock.spec);if(!value||['默认','默认规格'].includes(value))return '';
 const matches=reference.skus.filter(s=>normalize(s.spec)===value);return matches.length===1?matches[0].sku:'';
}
export function setupSameStyle({$,esc,context,api,load,edit,openMerged,toast,clipboard=globalThis.navigator?.clipboard}){
 let stocks=[],reference=null,requestId='',previewKey='',pending=null,busy=false,generation=0;
 const feedback=text=>{$('#sameStyleStatus').textContent=text;};
 const invalidate=()=>{if(busy)return;previewKey='';$('#confirmSameStyle').disabled=true;feedback('设置已变化，请重新预览。');};
 function drawRows(){
  const stockOnly=!$('#sameStyleReference').value;
  reference=stockOnly?stocks.find(p=>p.id===$('#sameStyleMain').value):context().products.find(p=>p.id===$('#sameStyleReference').value);if(!reference)return;
  $('#sameStyleReferenceTitle').value=reference.title||'';
  $('#sameStyleMedia').innerHTML='<p>资料商品：'+esc(reference.title)+' · '+reference.images.length+'张主图 · '+(reference.detail_images||[]).length+'张详情图</p><div class="supplier-pictures">'+reference.images.slice(0,6).map(url=>'<img loading="lazy" referrerpolicy="no-referrer" src="'+esc(url)+'" alt="采集主图参考">').join('')+'</div>';
  $('#sameStyleRows').innerHTML=stocks.flatMap(p=>p.skus.map(s=>{const matched=stockOnly?'':suggestedStyleMatch(s,reference);return '<tr data-style-product="'+esc(p.id)+'" data-style-sku="'+esc(s.sku)+'"><td>'+(s.image||p.images[0]?'<img class="thumb" loading="lazy" src="'+esc(s.image||p.images[0])+'" alt="货盘配图">':'')+esc(p.title)+'<small>条码 / 编码：'+esc(s.sku)+'</small><div class="style-sku-metrics"><span>成本 <b>¥'+esc(s.cost)+'</b></span><span>售价 <b>¥'+esc(s.price)+'</b></span><span>库存 <b>'+esc(s.stock)+'</b></span></div></td><td><input data-style-value maxlength="100" required value="'+esc(matched?reference.skus.find(r=>r.sku===matched).spec:s.spec&& !['默认','默认规格'].includes(s.spec)?s.spec:p.title)+'"></td><td><select data-style-match><option value="">不对应，保留货盘配图</option>'+(stockOnly?[]:reference.skus).map(r=>'<option value="'+esc(r.sku)+'" '+(r.sku===matched?'selected':'')+'>'+esc(r.spec||r.sku)+'</option>').join('')+'</select></td></tr>';})).join('');
  invalidate();
 }
 function input(){const stockOnly=!$('#sameStyleReference').value;return {mode:'same-style',products:(stockOnly?stocks:[...stocks,reference]).map(p=>({id:p.id,revision:p.revision})),reference_id:stockOnly?'':reference.id,main_id:$('#sameStyleMain').value,title:$('#sameStyleTitle').value,dimension:$('#sameStyleDimension').value,images:$('#sameStyleImages').value,rows:[...$('#sameStyleRows').querySelectorAll('[data-style-product]')].map(row=>({product_id:row.dataset.styleProduct,original_sku:row.dataset.styleSku,value:row.querySelector('[data-style-value]').value,reference_sku:row.querySelector('[data-style-match]').value}))};}
 function lock(value){busy=value;$('#sameStyleForm').querySelectorAll('input,select,button').forEach(el=>el.disabled=value);$('#confirmSameStyle').disabled=value||!previewKey;}
 $('#sameStyleProducts').onclick=()=>{try{
  const {products,selected}=context();stocks=products.filter(p=>selected.has(p.id)&&p.supplier_import);
  if(!stocks.length||stocks.length>19||stocks.some(p=>!p.skus?.length)||stocks.reduce((n,p)=>n+p.skus.length,0)>500)throw Error('请勾选1至19条已录入SKU的同款货盘商品，合计最多500个SKU');
  const references=products.filter(p=>!p.supplier_import&&!stocks.includes(p)&&p.skus?.length&&!p.same_style);
  if(!references.length&&stocks.length<2)throw Error('请先将对应的1688、淘宝或天猫商品采集到采集箱，再打开同款整理');
  generation++;requestId=crypto.randomUUID();previewKey='';pending=null;lock(false);
  $('#sameStyleReference').innerHTML=(stocks.length>=2?'<option value="" selected>仅合并货盘规格（沿用主商品图文）</option>':'')+references.map(p=>'<option value="'+esc(p.id)+'">'+esc(p.title)+'</option>').join('');
  const selectedReference=references.filter(p=>selected.has(p.id));if(selectedReference.length===1)$('#sameStyleReference').value=selectedReference[0].id;
  $('#sameStyleMain').innerHTML=stocks.map(p=>'<option value="'+esc(p.id)+'">'+esc(p.title)+'</option>').join('');
  $('#sameStyleTitle').value=stocks[0].title;$('#sameStyleDimension').value='规格';$('#sameStyleImages').value='reference';$('#sameStylePreview').replaceChildren();drawRows();feedback('请逐行确认规格对应关系。条码、成本、售价和库存来自货盘，不采用采集商品的数据。');$('#sameStyleDialog').showModal();$('#sameStyleBody')?.scrollTo({top:0});$('#sameStyleBackToTop')?.classList.add('hidden');
 }catch(e){toast(e.message,{error:true});}};
 $('#sameStyleReference').onchange=drawRows;
 $('#sameStyleMain').onchange=()=>{if(!$('#sameStyleReference').value)drawRows();};
 $('#copySameStyleTitle').onclick=async()=>{if(busy||pending)return;const field=$('#sameStyleReferenceTitle');try{if(!clipboard?.writeText)throw Error('clipboard unavailable');await clipboard.writeText(field.value);feedback('采集标题已复制。');}catch{field.focus();field.select();feedback('请按系统复制快捷键，或长按已选中的标题复制。');}};
 $('#useSameStyleTitle').onclick=()=>{if(busy||pending||!reference)return;$('#sameStyleTitle').value=reference.title||'';invalidate();feedback('已采用采集标题，可以继续编辑；请重新预览后生成。');};
 $('#sameStyleForm').addEventListener('input',invalidate);$('#sameStyleForm').addEventListener('change',invalidate);
 $('#closeSameStyle').onclick=()=>{if(!busy&&!pending)$('#sameStyleDialog').close();};
 $('#sameStyleDialog').addEventListener('cancel',event=>{if(busy||pending)event.preventDefault();});
 $('#previewSameStyle').onclick=async()=>{const current=generation;try{const body=input(),key=JSON.stringify(body);lock(true);feedback('正在检查规格与来源…');const result=await api('/api/products/merge-preview','POST',body);if(current!==generation||key!==JSON.stringify(input()))return;previewKey=key;$('#sameStylePreview').innerHTML='<h3>'+esc(result.product.title)+'</h3><p>'+result.product.skus.length+'个SKU · '+result.product.images.length+'张主图 · '+result.product.detail_images.length+'张详情图</p>'+result.warnings.map(w=>'<p class="notice">'+esc(w)+'</p>').join('');feedback('预览通过；确认后生成新商品，不会向商城发布。');}catch(e){previewKey='';feedback(e.message);}finally{lock(false);}};
 $('#sameStyleForm').onsubmit=async event=>{event.preventDefault();try{if(!pending){const body=input();if(JSON.stringify(body)!==previewKey)throw Error('请先预览当前设置');pending={...body,request_id:requestId};}lock(true);feedback('正在生成待整理商品…');const result=await api('/api/products/merge','POST',pending);pending=null;context().selected.clear();$('#sameStyleDialog').close();await (openMerged|| (id=>openMergedProduct(id,{api,apply(){},edit,refresh:load,notify:message=>toast(message,{error:true})})))(result.id);toast('已生成同款商品，请检查图文和全部SKU后保存、审核');}catch(e){if(e.httpStatus&&e.httpStatus<500){pending=null;previewKey='';feedback(e.message);}else feedback('结果尚未确认，请点击确认按钮重试同一次请求，不会重复生成。'+e.message);}finally{lock(false);if(pending){$('#sameStyleForm').querySelectorAll('input,select').forEach(el=>el.disabled=true);$('#closeSameStyle').disabled=true;$('#previewSameStyle').disabled=true;$('#confirmSameStyle').disabled=false;}}};
}
