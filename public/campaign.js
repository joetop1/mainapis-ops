const knownCost=v=>typeof v==='number'&&Number.isFinite(v)&&v>0;
export function campaignQuote(items,price,fixed,rate){
 if(!items.length||items.some(x=>!knownCost(x.cost)||!Number.isSafeInteger(x.quantity)||x.quantity<1))return null;
 if(!Number.isFinite(price)||price<=0||!Number.isFinite(fixed)||fixed<0||!Number.isFinite(rate)||rate<0||rate>100)return null;
 const cost=items.reduce((n,x)=>n+Math.round(x.cost*100)*x.quantity,0)/100;
 const revenue=Math.round(price*100),fees=Math.round(revenue*rate/100),expense=Math.round((cost+fixed)*100);
 const profit=(revenue-fees-expense)/100;
 return {cost,profit,margin:profit/price*100,breakEven:rate===100?null:Math.ceil(expense/(1-rate/100))/100};
}
export function setupCampaign({$,esc,products,mallName}){
 const selected=new Map(),money=n=>n.toFixed(2);let rows=[],limit=50,view='list';
 const costLabel=r=>knownCost(r.cost)?money(r.cost):'待核对';
 const quote=()=>campaignQuote([...selected.values()],Number($('#campaignPrice').value),Number($('#campaignFixed').value),Number($('#campaignRate').value));
 function totals(){
  const q=quote(),n=selected.size,missing=[...selected.values()].filter(r=>!knownCost(r.cost));
  $('#campaignResult').textContent=!n?'勾选一个 SKU 可试算单品；勾选多个 SKU 可试算一套组合。':missing.length?'待核对成本：'+missing.slice(0,3).map(r=>r.title+' · '+r.spec).join('、')+(missing.length>3?' 等 '+missing.length+' 项':''):!q?'请填写有效的活动价、费用和费率。':(q.profit<0?'每套预计亏损 ¥'+money(-q.profit):'每套预计利润 ¥'+money(q.profit))+' · 商品成本 ¥'+money(q.cost)+' · 利润率 '+money(q.margin)+'% · 保本价 '+(q.breakEven===null?'无法保本':money(q.breakEven));
  $('#campaignResult').classList.toggle('campaign-loss',!!q&&q.profit<0);
  $('#campaignMobileSummary').textContent='已选 '+n+' 个 SKU · '+(q?(q.profit<0?'预计亏损 ¥'+money(-q.profit):'预计利润 ¥'+money(q.profit)):'查看试算');
  $('#campaignExport').disabled=!q;
 }
 function draw(){
  const term=$('#campaignSearch').value.trim().toLowerCase(),supplier=$('#campaignSupplier').value,mall=$('#campaignMall').value;
  const category=$('#campaignCategory').value,sort=$('#campaignSort').value,known=$('#campaignKnownOnly').checked;
  const filtered=rows.filter(r=>(!category||r.category===category)&&(!known||knownCost(r.cost))&&(!supplier||r.supplier===supplier)&&(!mall||r.channels.some(j=>j.id===mall))&&[r.title,r.sku,r.spec].join(' ').toLowerCase().includes(term));
  if(sort)filtered.sort((a,b)=>Number(knownCost(b.cost))-Number(knownCost(a.cost))||(knownCost(a.cost)&&knownCost(b.cost)?(sort==='asc'?1:-1)*(a.cost-b.cost):0));
  const visible=filtered.slice(0,limit),grid=view==='grid';
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
  rows=products().flatMap(p=>(p.skus||[]).map(s=>({...s,title:p.title,image:[s.image,p.images?.[0]].find(url=>typeof url==='string'&&url.startsWith('https://'))||'',category:p.category||'',supplier:p.supplier_import?.supplier||'',channels:(p.publications||[]).filter(j=>j.status==='succeeded').map(j=>({id:j.mall_connection_id||j.target,name:mallName(j.mall_connection_id,j.target),remote:j.remote_id}))}))).map((r,id)=>({...r,id}));
  const options=(node,label,entries)=>node.replaceChildren(new Option(label,''),...Array.from(entries,([id,name])=>new Option(name,id)));
  options($('#campaignSupplier'),'全部供应商',new Map(rows.filter(r=>r.supplier).map(r=>[r.supplier,r.supplier])));
  options($('#campaignMall'),'全部商城',new Map(rows.flatMap(r=>r.channels.map(j=>[j.id,j.name]))));
  options($('#campaignCategory'),'全部类目',new Map(rows.filter(r=>r.category).map(r=>[r.category,r.category])));
  $('#campaignSearch').value='';draw();
 }
 $('#campaignButton').onclick=()=>document.querySelector('[data-page="campaign"]').click();
 $('#campaignMobileSummary').onclick=()=>{
  const expanded=$('#campaign').classList.toggle('campaign-expanded');
  $('#campaignMobileSummary').setAttribute('aria-expanded',String(expanded));
 };
 for(const id of ['campaignSearch','campaignSupplier','campaignMall','campaignCategory','campaignSort','campaignKnownOnly'])$('#'+id).oninput=()=>{limit=50;draw();};
 for(const id of ['campaignPrice','campaignFixed','campaignRate'])$('#'+id).oninput=totals;
 $('#campaignMore').onclick=()=>{limit+=50;draw();};
 $('#campaignListView').onclick=()=>{view='list';draw();};
 $('#campaignGridView').onclick=()=>{view='grid';draw();};
 $('#campaignRows').onchange=$('#campaignCards').onchange=e=>{const id=e.target.dataset.campaignRow;if(id===undefined)return;const r=rows[Number(id)];if(e.target.checked)selected.set(r.id,{...r,quantity:1});else selected.delete(r.id);draw();};
 for(const id of ['campaignRows','campaignCards'])$('#'+id).addEventListener('error',event=>{if(event.target.matches('.campaign-image img'))event.target.remove();},true);
 $('#campaignSelected').oninput=e=>{const r=selected.get(Number(e.target.dataset.campaignQty));if(r){r.quantity=Number(e.target.value);totals();}};
 $('#campaignSelected').onclick=e=>{const id=e.target.dataset.campaignRemove;if(id!==undefined){selected.delete(Number(id));draw();}};
 $('#campaignExport').onclick=()=>{
  const q=quote();if(!q)return;
  const lines=[['商品','规格','SKU','供应商','记录成本','每套数量','商城商品 ID'],...[...selected.values()].map(r=>[r.title,r.spec,r.sku,r.supplier,r.cost,r.quantity,r.channels.map(j=>j.name+' #'+j.remote).join(' / ')]),[],['每套到手价','每套运费包材','平台费率 (%)','每套商品成本','每套预计利润','利润率 (%)','保本价'],[$('#campaignPrice').value,$('#campaignFixed').value,$('#campaignRate').value,money(q.cost),money(q.profit),money(q.margin),q.breakEven===null?'':money(q.breakEven)]];
  const cell=v=>{let s=String(v??'');if(/^[\s\uFEFF]*[=+\-@]/.test(s)&&! /^-?\d+(?:\.\d+)?$/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
  const url=URL.createObjectURL(new Blob(['\uFEFF'+lines.map(row=>row.map(cell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='campaign-selection.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 };
 return {open};
}
