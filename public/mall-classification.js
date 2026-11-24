const states={draft:'待确认',queued:'排队中',running:'执行中',done:'执行结束',pending:'等待执行',succeeded:'核对成功',unknown:'结果待核对',not_applied:'核对未应用',conflict:'冲突或未执行'};
export function setupMallClassification({$,api,esc,malls,role,active}){
 const base='/api/mall-classification';let rows=[],dictionary=null,plan=null,page=1,total=0,loading=false,request=0;
 const selected=new Set();
 const names=(key,ids)=>ids.map(id=>dictionary?.[key]?.find(r=>Number(r.id)===id)?.[key==='categories'?'cate_name':'label_name']||'#'+id).join('、')||'无';
 const path=(suffix)=>base+suffix+'?'+new URLSearchParams({mall:$('#classificationMall').value});
 const status=text=>{$('#classificationStatus').textContent=text;};
 function buttons(){const write=['admin','reviewer'].includes(role()||'admin');$('#classificationPreview').disabled=loading||!selected.size||!write;$('#classificationSubmit').disabled=loading||!plan||plan.state!=='draft'||!write;$('#classificationRollback').disabled=loading||!plan||plan.state!=='done'||!plan.items.some(i=>i.state==='succeeded')||!write;}
 function invalidate(){request++;plan=null;$('#classificationPlan').replaceChildren();buttons();}
 function draw(){
  $('#classificationRows').innerHTML=rows.map(r=>'<tr><td><input type="checkbox" data-classification-id="'+r.id+'" '+(selected.has(r.id)?'checked':'')+' aria-label="'+esc('选择 '+r.title)+'"></td><td><strong>'+esc(r.title)+'</strong><small>商品 ID '+r.id+' · '+(r.is_show===1?'上架':r.is_show===0?'下架':'状态 '+r.is_show)+'</small></td><td>'+esc(names('categories',r.category_ids))+'</td><td>'+esc(names('tags',r.tag_ids))+'</td></tr>').join('');
  $('#classificationPage').textContent='第 '+page+' 页 · 共 '+total+' 件 · 当前页选中 '+selected.size+' 件';$('#classificationPrev').disabled=loading||page<=1;$('#classificationNext').disabled=loading||page*50>=total;$('#classificationAll').checked=!!rows.length&&selected.size===rows.length;buttons();
 }
 function drawPlan(){
  if(!plan)return;
  $('#classificationPlan').innerHTML='<h3>'+esc(states[plan.state]||plan.state)+' · '+plan.items.length+' 件商品</h3><p class="hint">只变更分类和商品标签。标签替换会移除原有标签；价格、库存、规格、图片及上下架状态不在更新范围内。</p><div class="table-scroll"><table><thead><tr><th>商品</th><th>分类：原 → 新</th><th>标签：原 → 新</th><th>执行结果</th></tr></thead><tbody>'+plan.items.map(i=>'<tr><td>'+esc(i.title)+'<small>ID '+i.id+'</small></td><td>'+esc(names('categories',i.before.category_ids))+' → '+esc(names('categories',i.after.category_ids))+'</td><td>'+esc(names('tags',i.before.tag_ids))+' → '+esc(names('tags',i.after.tag_ids))+'</td><td>'+esc(states[i.state]||i.state)+'<small>'+esc(i.message)+'</small>'+(['unknown','not_applied','conflict'].includes(i.state)?'<button type="button" class="secondary" data-classification-verify="'+i.id+'">只读核对</button>':'')+'</td></tr>').join('')+'</tbody></table></div>';buttons();
 }
 async function act(fn){if(loading)return;loading=true;$('#classification').querySelectorAll('input,select,button').forEach(e=>e.disabled=true);buttons();try{await fn();}catch(e){status(e.message);}finally{loading=false;$('#classification').querySelectorAll('input,select,button').forEach(e=>e.disabled=false);draw();}}
 async function history(){const r=await api(base+'/history');$('#classificationHistory').replaceChildren(new Option('选择历史整理记录',''),...r.plans.map(p=>new Option(new Date(p.created).toLocaleString()+' · '+(malls().find(m=>m.id===p.mall)?.name||p.mall)+' · '+(states[p.state]||p.state),p.id)));}
 async function load(){const mall=$('#classificationMall').value;if(!mall){status('请先配置CRMEB会员商城连接');return;}
  selected.clear();invalidate();dictionary=await api(path('/catalog'));const categories=new Map(dictionary.categories.map(c=>[Number(c.id),c]));
  const categoryLabel=c=>{const parts=[c.cate_name],seen=new Set([Number(c.id)]);let parent=categories.get(Number(c.pid));while(parent&&!seen.has(Number(parent.id))){seen.add(Number(parent.id));parts.unshift(parent.cate_name);parent=categories.get(Number(parent.pid));}return parts.join(' / ');};
  $('#classificationCategory').replaceChildren(...dictionary.categories.map(c=>new Option(categoryLabel(c)+' (#'+c.id+')',c.id)));$('#classificationTags').replaceChildren(...dictionary.tags.map(t=>new Option(t.label_name+' (#'+t.id+')',t.id)));
  const data=await api(path('/products')+'&'+new URLSearchParams({page:String(page),q:$('#classificationSearch').value,show:$('#classificationShow').value}));rows=data.products;total=data.total;status('已读取商城现有商品。先选择商品和修改项，再生成对照预览。');draw();await history();
 }
 $('#classificationRows').onchange=e=>{const id=Number(e.target.dataset.classificationId);if(!id)return;e.target.checked?selected.add(id):selected.delete(id);invalidate();draw();};
 $('#classificationAll').onchange=e=>{selected.clear();if(e.target.checked)rows.forEach(r=>selected.add(r.id));invalidate();draw();};
 for(const id of ['classificationCategory','classificationTags','classificationTagMode','classificationChangeCategory'])$('#'+id).onchange=invalidate;
 $('#classificationMall').onchange=()=>act(async()=>{page=1;await load();});
 $('#classificationSearchForm').onsubmit=e=>{e.preventDefault();act(async()=>{page=1;await load();});};
 $('#classificationPrev').onclick=()=>act(async()=>{page--;await load();});$('#classificationNext').onclick=()=>act(async()=>{page++;await load();});
 $('#classificationPreview').onclick=()=>act(async()=>{
  plan=await api(base+'/preview','POST',{mall:$('#classificationMall').value,products:rows.filter(r=>selected.has(r.id)).map(r=>({id:r.id,revision:r.revision})),category_ids:$('#classificationChangeCategory').checked?[...$('#classificationCategory').selectedOptions].map(o=>Number(o.value)):null,tag_mode:$('#classificationTagMode').value,tag_ids:[...$('#classificationTags').selectedOptions].map(o=>Number(o.value))});drawPlan();status('请核对每件商品的修改前后内容，确认后点击“确认同步商城”。');
 });
 $('#classificationSubmit').onclick=()=>act(async()=>{if(!plan||plan.state!=='draft')return;const id=plan.id;plan=await api(base+'/plans/'+id+'/submit','POST',{});drawPlan();status('已加入Worker队列，请等待读回核对结果。');await history();});
 $('#classificationRollback').onclick=()=>act(async()=>{plan=await api(base+'/plans/'+plan.id+'/rollback','POST',{});drawPlan();status('已生成回退预览；核对后确认同步才会回退。');await history();});
 $('#classificationPlan').onclick=e=>{const button=e.target.closest('[data-classification-verify]');if(!button)return;act(async()=>{plan=await api(base+'/plans/'+plan.id+'/verify','POST',{product_id:Number(button.dataset.classificationVerify)});drawPlan();status('只读核对完成。未应用或冲突的商品请重新读取并生成新预览。');});};
 $('#classificationHistory').onchange=e=>{const id=e.target.value;if(!id)return;act(async()=>{const record=await api(base+'/plans/'+id);$('#classificationMall').value=record.mall;await load();plan=record;drawPlan();});};
 setInterval(async()=>{if(!active()||loading||!plan||!['queued','running'].includes(plan.state))return;const id=plan.id,revision=request;try{const next=await api(base+'/plans/'+id);if(plan?.id===id&&request===revision){plan=next;drawPlan();}}catch(e){status('进度读取失败：'+e.message);}},3000);
 return {open(){return act(async()=>{const current=$('#classificationMall').value;$('#classificationMall').replaceChildren(...malls().filter(m=>m.type==='crmeb-pro'&&m.configured).map(m=>new Option(m.name,m.id)));if([...$('#classificationMall').options].some(o=>o.value===current))$('#classificationMall').value=current;page=1;await load();});}};
}
