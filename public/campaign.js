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
 const selected=new Map(),money=n=>n.toFixed(2);let rows=[],limit=50;
 const costLabel=r=>knownCost(r.cost)?money(r.cost):'待核对';
 const quote=()=>campaignQuote([...selected.values()],Number($('#campaignPrice').value),Number($('#campaignFixed').value),Number($('#campaignRate').value));
 function totals(){
  const q=quote(),n=selected.size,missing=[...selected.values()].filter(r=>!knownCost(r.cost)).length;
  $('#campaignResult').textContent=!n?'勾选一个 SKU 可试算单品；勾选多个 SKU 可试算一套组合。':missing?'有 '+missing+' 个 SKU 成本缺失或为 0，请先核对成本。':!q?'请填写有效的活动价、费用和费率。':'每套商品成本 '+money(q.cost)+' · 预计利润 '+money(q.profit)+' · 利润率 '+money(q.margin)+'% · 保本价 '+(q.breakEven===null?'无法保本':money(q.breakEven));
  $('#campaignExport').disabled=!q;
 }
 function draw(){
  const term=$('#campaignSearch').value.trim().toLowerCase(),supplier=$('#campaignSupplier').value,mall=$('#campaignMall').value;
  const filtered=rows.filter(r=>(!supplier||r.supplier===supplier)&&(!mall||r.channels.some(j=>j.id===mall))&&[r.title,r.sku,r.spec].join(' ').toLowerCase().includes(term));
  $('#campaignRows').innerHTML=filtered.slice(0,limit).map(r=>'<tr><td><input type="checkbox" data-campaign-row="'+r.id+'" aria-label="'+esc('选择 '+r.title+' '+r.spec)+'" '+(selected.has(r.id)?'checked':'')+'></td><td>'+esc(r.title)+'<small>'+esc(r.spec+' · '+r.sku)+'</small></td><td>'+costLabel(r)+'</td><td>'+esc(r.price)+'</td><td>'+esc(r.stock)+'</td></tr>').join('');
  $('#campaignCount').textContent='已选 '+selected.size+' 个 SKU · 当前显示 '+Math.min(limit,filtered.length)+' / '+filtered.length+' 个';
  $('#campaignMore').hidden=limit>=filtered.length;
  $('#campaignSelected').innerHTML=[...selected.values()].map(r=>'<div class="campaign-item"><span>'+esc(r.title+' · '+r.spec)+'（成本 '+costLabel(r)+'）</span><label>每套数量<input type="number" min="1" max="999" step="1" data-campaign-qty="'+r.id+'" value="'+esc(r.quantity)+'"></label><button class="text" type="button" data-campaign-remove="'+r.id+'">移除</button></div>').join('');
  totals();
 }
 $('#campaignButton').onclick=()=>{
  selected.clear();limit=50;
  rows=products().flatMap(p=>(p.skus||[]).map(s=>({...s,title:p.title,supplier:p.supplier_import?.supplier||'',channels:(p.publications||[]).filter(j=>j.status==='succeeded').map(j=>({id:j.mall_connection_id||j.target,name:mallName(j.mall_connection_id,j.target),remote:j.remote_id}))}))).map((r,id)=>({...r,id}));
  const options=(node,label,entries)=>node.replaceChildren(new Option(label,''),...Array.from(entries,([id,name])=>new Option(name,id)));
  options($('#campaignSupplier'),'全部供应商',new Map(rows.filter(r=>r.supplier).map(r=>[r.supplier,r.supplier])));
  options($('#campaignMall'),'全部商城',new Map(rows.flatMap(r=>r.channels.map(j=>[j.id,j.name]))));
  $('#campaignSearch').value='';draw();$('#campaignDialog').showModal();
 };
 $('#campaignClose').onclick=()=>$('#campaignDialog').close();
 for(const id of ['campaignSearch','campaignSupplier','campaignMall'])$('#'+id).oninput=()=>{limit=50;draw();};
 for(const id of ['campaignPrice','campaignFixed','campaignRate'])$('#'+id).oninput=totals;
 $('#campaignMore').onclick=()=>{limit+=50;draw();};
 $('#campaignRows').onchange=e=>{const id=e.target.dataset.campaignRow;if(id===undefined)return;const r=rows[Number(id)];if(e.target.checked)selected.set(r.id,{...r,quantity:1});else selected.delete(r.id);draw();};
 $('#campaignSelected').oninput=e=>{const r=selected.get(Number(e.target.dataset.campaignQty));if(r){r.quantity=Number(e.target.value);totals();}};
 $('#campaignSelected').onclick=e=>{const id=e.target.dataset.campaignRemove;if(id!==undefined){selected.delete(Number(id));draw();}};
 $('#campaignExport').onclick=()=>{
  const q=quote();if(!q)return;
  const lines=[['商品','规格','SKU','供应商','记录成本','每套数量','商城商品 ID'],...[...selected.values()].map(r=>[r.title,r.spec,r.sku,r.supplier,r.cost,r.quantity,r.channels.map(j=>j.name+' #'+j.remote).join(' / ')]),[],['每套到手价','每套运费包材','平台费率 (%)','每套商品成本','每套预计利润','利润率 (%)','保本价'],[$('#campaignPrice').value,$('#campaignFixed').value,$('#campaignRate').value,money(q.cost),money(q.profit),money(q.margin),q.breakEven===null?'':money(q.breakEven)]];
  const cell=v=>{let s=String(v??'');if(/^[\s\uFEFF]*[=+\-@]/.test(s)&&! /^-?\d+(?:\.\d+)?$/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
  const url=URL.createObjectURL(new Blob(['\uFEFF'+lines.map(row=>row.map(cell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='campaign-selection.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 };
}
