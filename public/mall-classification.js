export function setupMallClassification({$,api,esc,malls,role}){
 const base='/api/mall-classification';let rows=[],dictionary=null,plan=null,page=1,total=0,loading=false;const selected=new Set();
 const status=text=>{$('#classificationStatus').textContent=text;};
 const names=(key,values)=>values===null?'未读取，预览时核对':values.map(id=>key==='categories'?dictionary?.categories.find(c=>c.id===id)?.cate_name||'#'+id:String(id)).join('、')||'无';
 function buttons(){const write=['admin','reviewer'].includes(role()||'admin');$('#classificationPreview').disabled=loading||!selected.size||!write;$('#classificationExport').classList.toggle('hidden',!plan);}
 function invalidate(){plan=null;$('#classificationPlan').replaceChildren();$('#classificationExport').removeAttribute('href');buttons();}
 function draw(){
  $('#classificationRows').innerHTML=rows.map(r=>'<tr><td><input type="checkbox" data-classification-id="'+r.id+'" '+(selected.has(r.id)?'checked':'')+' aria-label="'+esc('选择 '+r.title)+'"></td><td><strong>'+esc(r.title)+'</strong><small>商品 ID '+r.id+' · '+(r.is_show===1?'上架':r.is_show===0?'下架':'状态 '+r.is_show)+'</small></td><td>'+esc(names('categories',r.category_ids))+'</td><td>'+esc(r.tag_names_known?(r.tag_names.join('、')||'无'):r.tag_ids?.length?'标签ID：'+r.tag_ids.join('、'):'预览时读取详情确认')+'</td></tr>').join('');
  $('#classificationPage').textContent='第 '+page+' 页 · 共 '+total+' 件 · 当前页选中 '+selected.size+' 件';$('#classificationPrev').disabled=loading||page<=1||!!$('#classificationIds').value.trim();$('#classificationNext').disabled=loading||page*50>=total||!!$('#classificationIds').value.trim();$('#classificationAll').checked=!!rows.length&&selected.size===rows.length;buttons();
 }
 function drawPlan(){if(!plan)return;
  $('#classificationExport').href=base+'/plans/'+plan.id+'/export';
  $('#classificationPlan').innerHTML='<h3>整理清单 · '+plan.items.length+' 件商品（未同步商城）</h3><p class="hint">导出后在商城后台选择对应商品，分别使用批量修改分类、批量设置商品标签。后台标签操作是替换，请以每件商品的完整目标标签集合为准；目标标签不同的商品不要混批。</p><div class="table-scroll"><table><thead><tr><th>商品</th><th>分类：原 → 建议</th><th>标签：原 → 建议</th><th>核对提示</th></tr></thead><tbody>'+plan.items.map(i=>'<tr><td>'+esc(i.title)+'<small>ID '+i.id+'</small></td><td>'+esc(i.before.category_names.join('、'))+' → '+esc(i.after.category_names.join('、'))+'</td><td>'+esc(i.before.tag_names.join('、')||i.before.tag_ids.map(id=>'#'+id).join('、')||'无')+' → '+esc(i.tag_mode==='keep'?'保留原标签':i.after.tag_names.join('、')||'清空标签')+'</td><td>'+esc(i.warning)+'</td></tr>').join('')+'</tbody></table></div>';buttons();
 }
 async function act(fn){if(loading)return;loading=true;$('#classification').querySelectorAll('input,select,button').forEach(e=>e.disabled=true);buttons();try{await fn();}catch(e){status(e.message);}finally{loading=false;$('#classification').querySelectorAll('input,select,button').forEach(e=>e.disabled=false);draw();}}
 async function history(){const r=await api(base+'/history');$('#classificationHistory').replaceChildren(new Option('选择历史整理清单',''),...r.plans.map(p=>new Option(new Date(p.created).toLocaleString()+' · '+(malls().find(m=>m.id===p.mall)?.name||p.mall),p.id)));}
 async function load(){const mall=$('#classificationMall').value;if(!mall){status('请先配置CRMEB会员商城连接');return;}
  selected.clear();invalidate();dictionary=await api(base+'/catalog?'+new URLSearchParams({mall}));
  $('#classificationCategory').replaceChildren(...dictionary.categories.map(c=>new Option(c.cate_name+' (#'+c.id+')',c.id)));$('#classificationTags').replaceChildren(...dictionary.tags.map(t=>new Option(t.label_name,t.id)));
  const data=await api(base+'/products?'+new URLSearchParams({mall,page:String(page),q:$('#classificationSearch').value,ids:$('#classificationIds').value.trim()}));rows=data.products;total=data.total;if($('#classificationIds').value.trim())page=1;status('官方只读模式：不修改商城。列表仅含上架商品，下架商品请填写商品ID。标签选项是建议名称，需核实产品资料及后台标签。');draw();await history();
 }
 $('#classificationRows').onchange=e=>{const id=Number(e.target.dataset.classificationId);if(!id)return;e.target.checked?selected.add(id):selected.delete(id);invalidate();draw();};
 $('#classificationAll').onchange=e=>{selected.clear();if(e.target.checked)rows.forEach(r=>selected.add(r.id));invalidate();draw();};
 for(const id of ['classificationCategory','classificationTags','classificationTagMode','classificationChangeCategory','classificationCustomTags'])$('#'+id).onchange=invalidate;
 $('#classificationCustomTags').oninput=invalidate;
 $('#classificationMall').onchange=()=>act(async()=>{page=1;await load();});
 $('#classificationSearchForm').onsubmit=e=>{e.preventDefault();act(async()=>{page=1;await load();});};
 $('#classificationPrev').onclick=()=>act(async()=>{page--;await load();});$('#classificationNext').onclick=()=>act(async()=>{page++;await load();});
 $('#classificationPreview').onclick=()=>act(async()=>{
  plan=await api(base+'/preview','POST',{mall:$('#classificationMall').value,products:rows.filter(r=>selected.has(r.id)).map(r=>({id:r.id})),category_ids:$('#classificationChangeCategory').checked?[...$('#classificationCategory').selectedOptions].map(o=>Number(o.value)):null,tag_mode:$('#classificationTagMode').value,tag_names:[...new Set([...$('#classificationTags').selectedOptions].map(o=>o.value).concat($('#classificationCustomTags').value.split(/[,，\n]+/).map(v=>v.trim()).filter(Boolean)))]});drawPlan();status('整理清单已保存，可下载CSV。此文件用于后台人工批量操作核对，不是商城导入模板，也没有同步商城。');await history();
 });
 $('#classificationHistory').onchange=e=>{const id=e.target.value;if(!id)return;act(async()=>{plan=await api(base+'/plans/'+id);$('#classificationMall').value=plan.mall;rows=[];selected.clear();total=0;drawPlan();status('已读取历史整理清单；未自动执行任何商城更新。');});};
 return {open(){return act(async()=>{const current=$('#classificationMall').value;$('#classificationMall').replaceChildren(...malls().filter(m=>m.type==='crmeb-pro'&&m.configured).map(m=>new Option(m.name,m.id)));if([...$('#classificationMall').options].some(o=>o.value===current))$('#classificationMall').value=current;page=1;await load();});}};
}
