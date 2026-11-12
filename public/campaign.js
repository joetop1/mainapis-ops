const knownCost=v=>typeof v==='number'&&Number.isFinite(v)&&v>0;
export function campaignQuote(items,price,fixed,rate){
 if(!items.length||items.some(x=>!knownCost(x.cost)||!Number.isSafeInteger(x.quantity)||x.quantity<1))return null;
 if(!Number.isFinite(price)||price<=0||!Number.isFinite(fixed)||fixed<0||!Number.isFinite(rate)||rate<0||rate>100)return null;
 const cost=items.reduce((n,x)=>n+Math.round(x.cost*100)*x.quantity,0)/100;
 const revenue=Math.round(price*100),fees=Math.round(revenue*rate/100),expense=Math.round((cost+fixed)*100);
 const profit=(revenue-fees-expense)/100;
 return {cost,profit,margin:profit/price*100,breakEven:rate===100?null:Math.ceil(expense/(1-rate/100))/100};
}
export function recommendCampaign(rows,{price,fixed,rate,size,margin}){
 if(!Number.isInteger(size)||size<2||size>5||!Number.isFinite(margin)||margin<0||margin>100||!campaignQuote([{cost:1,quantity:1}],price,fixed,rate))return [];
 const eligible=rows.filter(r=>knownCost(r.cost)&&Number.isSafeInteger(Number(r.stock))&&Number(r.stock)>0&&r.productId)
  .sort((a,b)=>a.cost-b.cost||Number(b.stock)-Number(a.stock));
 const cheapest=new Map();
 for(const row of eligible)if(!cheapest.has(row.productId))cheapest.set(row.productId,row);
 const pool=[...cheapest.values()],results=[],used=new Set();
 for(let start=0;start<pool.length&&results.length<3;start++){
  const items=[pool[start],...pool.filter((_,i)=>i!==start).slice(0,size-1)].sort((a,b)=>a.id-b.id).map(r=>({...r,quantity:1}));
  if(items.length!==size)break;
  const quote=campaignQuote(items,price,fixed,rate);
  if(!quote||quote.margin+1e-9<margin)break;
  const key=items.map(r=>r.id).join(',');
  if(used.has(key))continue;
  used.add(key);results.push({items,quote,stock:Math.min(...items.map(r=>Number(r.stock)))});
 }
 return results;
}
export function setupCampaign({$,esc,products,mallName,explain}){
 const selected=new Map(),money=n=>n.toFixed(2);let rows=[],limit=50,view='list',recommendations=[],recommendationRevision=0;
 const costLabel=r=>knownCost(r.cost)?money(r.cost):'待核对';
 const quote=()=>campaignQuote([...selected.values()],Number($('#campaignPrice').value),Number($('#campaignFixed').value),Number($('#campaignRate').value));
 function totals(){
  const q=quote(),n=selected.size,missing=[...selected.values()].filter(r=>!knownCost(r.cost));
  $('#campaignResult').textContent=!n?'勾选一个 SKU 可试算单品；勾选多个 SKU 可试算一套组合。':missing.length?'待核对成本：'+missing.slice(0,3).map(r=>r.title+' · '+r.spec).join('、')+(missing.length>3?' 等 '+missing.length+' 项':''):!q?'请填写有效的活动价、费用和费率。':(q.profit<0?'每套预计亏损 ¥'+money(-q.profit):'每套预计利润 ¥'+money(q.profit))+' · 商品成本 ¥'+money(q.cost)+' · 利润率 '+money(q.margin)+'% · 保本价 '+(q.breakEven===null?'无法保本':money(q.breakEven));
  $('#campaignResult').classList.toggle('campaign-loss',!!q&&q.profit<0);
  $('#campaignMobileSummary').textContent='已选 '+n+' 个 SKU · '+(q?(q.profit<0?'预计亏损 ¥'+money(-q.profit):'预计利润 ¥'+money(q.profit)):'查看试算');
  $('#campaignExport').disabled=!q;
 }
 function filteredRows(){
  const term=$('#campaignSearch').value.trim().toLowerCase(),supplier=$('#campaignSupplier').value,mall=$('#campaignMall').value;
  const category=$('#campaignCategory').value,sort=$('#campaignSort').value,known=$('#campaignKnownOnly').checked;
  const filtered=rows.filter(r=>(!category||r.category===category)&&(!known||knownCost(r.cost))&&(!supplier||r.supplier===supplier)&&(!mall||r.channels.some(j=>j.id===mall))&&[r.title,r.sku,r.spec].join(' ').toLowerCase().includes(term));
  if(sort)filtered.sort((a,b)=>Number(knownCost(b.cost))-Number(knownCost(a.cost))||(knownCost(a.cost)&&knownCost(b.cost)?(sort==='asc'?1:-1)*(a.cost-b.cost):0));
  return filtered;
 }
 function draw(){
  const filtered=filteredRows(),visible=filtered.slice(0,limit),grid=view==='grid';
  const checkbox=r=>'<input type="checkbox" data-campaign-row="'+r.id+'" aria-label="'+esc('选择 '+r.title+' '+r.spec)+'" '+(selected.has(r.id)?'checked':'')+'>';
  const image=r=>'<div class="campaign-image"><span aria-hidden="true">▧</span>'+(r.image?'<img loading="lazy" decoding="async" referrerpolicy="no-referrer" src="'+esc(r.image)+'" alt="">':'')+'</div>';
  const title=r=>'<div class="campaign-product-name"><strong>'+esc(r.title)+'</strong><small>'+esc(r.spec+' · '+r.sku)+'</small></div>';
  $('#campaignTable').hidden=grid;$('#campaignCards').hidden=!grid;
  $('#campaignListView').setAttribute('aria-pressed',String(!grid));$('#campaignGridView').setAttribute('aria-pressed',String(grid));
  $('#campaignRows').innerHTML=grid?'':visible.map(r=>'<tr><td>'+checkbox(r)+'</td><td><div class="campaign-row-product">'+image(r)+title(r)+'</div></td><td>'+costLabel(r)+'</td><td>'+esc(r.price)+'</td><td>'+esc(r.stock)+'</td></tr>').join('');
  $('#campaignCards').innerHTML=grid?visible.map(r=>'<label class="campaign-card">'+image(r)+title(r)+'<span class="campaign-card-values">成本 '+costLabel(r)+' · 售价 '+esc(r.price)+' · 库存 '+esc(r.stock)+'</span><span class="campaign-card-select">'+checkbox(r)+' 选择规格</span></label>').join(''):'';
  $('#campaignCount').textContent='已选 '+selected.size+' 个 SKU · 当前显示 '+Math.min(limit,filtered.length)+' / '+filtered.length+' 个';
  $('#campaignMore').hidden=limit>=filtered.length;
  $('#campaignSelected').innerHTML=[...selected.values()].map(r=>'<div class="campaign-item"><span>'+esc(r.title+' · '+r.spec)+'（成本 '+costLabel(r)+'）</span><label>每套数量<input type="number" min="1" max="999" step="1" data-campaign-qty="'+r.id+'" value="'+esc(r.quantity)+'"></label><button class="text" type="button" data-campaign-remove="'+r.id+'">移除</button></div>').join('');
  totals();
 }
 function open(){
  selected.clear();limit=50;
  rows=products().flatMap(p=>(p.skus||[]).map(s=>({...s,productId:p.id,title:p.title,image:[s.image,p.images?.[0]].find(url=>typeof url==='string'&&url.startsWith('https://'))||'',category:p.category||'',supplier:p.supplier_import?.supplier||'',channels:(p.publications||[]).filter(j=>j.status==='succeeded').map(j=>({id:j.mall_connection_id||j.target,name:mallName(j.mall_connection_id,j.target),remote:j.remote_id}))}))).map((r,id)=>({...r,id}));
  const options=(node,label,entries)=>node.replaceChildren(new Option(label,''),...Array.from(entries,([id,name])=>new Option(name,id)));
  options($('#campaignSupplier'),'全部供应商',new Map(rows.filter(r=>r.supplier).map(r=>[r.supplier,r.supplier])));
  options($('#campaignMall'),'全部商城',new Map(rows.flatMap(r=>r.channels.map(j=>[j.id,j.name]))));
  options($('#campaignCategory'),'全部类目',new Map(rows.filter(r=>r.category).map(r=>[r.category,r.category])));
  $('#campaignSearch').value='';clearRecommendations();draw();
 }
 $('#campaignMobileSummary').onclick=()=>{
  const expanded=$('#campaign').classList.toggle('campaign-expanded');
  $('#campaignMobileSummary').setAttribute('aria-expanded',String(expanded));
 };
 for(const id of ['campaignSearch','campaignSupplier','campaignMall','campaignCategory','campaignSort','campaignKnownOnly'])$('#'+id).oninput=()=>{limit=50;clearRecommendations();draw();};
 for(const id of ['campaignPrice','campaignFixed','campaignRate','campaignSize','campaignMinimumMargin'])$('#'+id).oninput=()=>{clearRecommendations();totals();};
 $('#campaignMore').onclick=()=>{limit+=50;draw();};
 $('#campaignListView').onclick=()=>{view='list';draw();};
 $('#campaignGridView').onclick=()=>{view='grid';draw();};
 $('#campaignRows').onchange=$('#campaignCards').onchange=e=>{const id=e.target.dataset.campaignRow;if(id===undefined)return;const r=rows[Number(id)];if(e.target.checked)selected.set(r.id,{...r,quantity:1});else selected.delete(r.id);draw();};
 for(const id of ['campaignRows','campaignCards'])$('#'+id).addEventListener('error',event=>{if(event.target.matches('.campaign-image img'))event.target.remove();},true);
 $('#campaignSelected').oninput=e=>{const r=selected.get(Number(e.target.dataset.campaignQty));if(r){r.quantity=Number(e.target.value);totals();}};
 $('#campaignSelected').onclick=e=>{const id=e.target.dataset.campaignRemove;if(id!==undefined){selected.delete(Number(id));draw();}};
 function clearRecommendations(){
  recommendationRevision++;recommendations=[];
  $('#campaignSuggestions').replaceChildren();
  $('#campaignExplain').disabled=true;
  $('#campaignRecommendationStatus').textContent='';
 }
 $('#campaignRecommend').onclick=()=>{
  clearRecommendations();
  const ids=['Price','Fixed','Rate','Size','MinimumMargin'];
  if(ids.some(id=>!$('#campaign'+id).value.trim()||!$('#campaign'+id).reportValidity()))return;
  const [price,fixed,rate,size,margin]=ids.map(id=>Number($('#campaign'+id).value));
  recommendations=recommendCampaign(filteredRows(),{price,fixed,rate,size,margin});
  $('#campaignRecommendationStatus').textContent=recommendations.length?'找到 '+recommendations.length+' 套可试算组合，按利润优先。':'当前筛选范围内没有满足条件的组合。需要不同商品、已知成本和正库存，可放宽筛选或降低利润率。';
  $('#campaignSuggestions').innerHTML=recommendations.map(({items,quote,stock},index)=>'<article class="campaign-suggestion"><strong>方案 '+(index+1)+' · 预计利润 ¥'+money(quote.profit)+' · '+money(quote.margin)+'%</strong><ul>'+items.map(r=>'<li>'+esc(r.title+' · '+r.spec)+'</li>').join('')+'</ul><small>商品成本 ¥'+money(quote.cost)+' · 按记录库存可组 '+stock+' 套</small><p data-campaign-reason="'+index+'" hidden></p><button type="button" class="secondary" data-campaign-apply="'+index+'">载入试算</button></article>').join('');
  $('#campaignExplain').disabled=!recommendations.length;
 };
 $('#campaignSuggestions').onclick=e=>{
  const index=e.target.closest('[data-campaign-apply]')?.dataset.campaignApply;
  const r=index===undefined?null:recommendations[Number(index)];if(!r)return;
  selected.clear();for(const item of r.items)selected.set(item.id,{...item});draw();
 };
 $('#campaignExplain').onclick=async()=>{
  if(!recommendations.length)return;
  const revision=recommendationRevision,button=$('#campaignExplain');button.disabled=true;
  $('#campaignRecommendationStatus').textContent='正在生成搭配理由…';
  try{
   const result=await explain(recommendations.map(r=>r.items.map(x=>({id:x.productId,sku:x.sku}))));
   if(revision!==recommendationRevision)return;
   for(const {index,reason} of result.reasons){
    const el=$('#campaignSuggestions').querySelector('[data-campaign-reason="'+index+'"]');
    if(el){el.hidden=false;el.textContent='AI 建议：'+reason;}
   }
   $('#campaignRecommendationStatus').textContent='已生成搭配理由，请结合活动目标核对。';
  }catch(e){if(revision===recommendationRevision)$('#campaignRecommendationStatus').textContent=e.message+'；仍可使用本地推荐。';}
  finally{if(revision===recommendationRevision)button.disabled=false;}
 };
 $('#campaignExport').onclick=()=>{
  const q=quote();if(!q)return;
  const lines=[['商品','规格','SKU','供应商','记录成本','每套数量','商城商品 ID'],...[...selected.values()].map(r=>[r.title,r.spec,r.sku,r.supplier,r.cost,r.quantity,r.channels.map(j=>j.name+' #'+j.remote).join(' / ')]),[],['每套到手价','每套运费包材','平台费率 (%)','每套商品成本','每套预计利润','利润率 (%)','保本价'],[$('#campaignPrice').value,$('#campaignFixed').value,$('#campaignRate').value,money(q.cost),money(q.profit),money(q.margin),q.breakEven===null?'':money(q.breakEven)]];
  const cell=v=>{let s=String(v??'');if(/^[\s\uFEFF]*[=+\-@]/.test(s)&&! /^-?\d+(?:\.\d+)?$/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
  const url=URL.createObjectURL(new Blob(['\uFEFF'+lines.map(row=>row.map(cell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='campaign-selection.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 };
 return {open};
}
