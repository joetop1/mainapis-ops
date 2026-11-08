import {canonicalSourceURL} from './source-url.js';
import {specificationMatrix} from './specifications.js';
// Advisory UI checks. Server and channel validation remain authoritative.
export function editorReadiness(p,{editor=false,categorySelected}={}){
 const issues=[],add=(stage,group,field,message,row,key)=>issues.push({stage,group,field,message,...(row===undefined?{}:{row,key})});
 try{if(!/^supplier:[a-f0-9]{64}$/.test(p.source_url||''))canonicalSourceURL(p.source_url);}catch{add('save','basic','source_url','请填写有效的1688、淘宝或天猫商品链接');}
 if(!String(p.title||'').trim())add('review','basic','title','审核前请补充商品标题');
 const category=categorySelected??!!(p.category||p.category_id||p.mall_mappings?.some(m=>m.category_id&&m.category));
 if(!category)add('review','mapping','categorySelect','当前商城审核发布前请选择分类');
 if(!p.images?.length)add('review','main-images','localMainImages','审核前请至少添加一张商品主图');
 for(const [field,group] of [['images','main-images'],['detail_images','detail-images']])if((p[field]||[]).some(value=>{try{const u=new URL(value);return u.protocol!=='https:'||!!u.username||!!u.password;}catch{return true;}}))add('save',group,field,'图片地址须为无账号密码的HTTPS链接');
 const skus=p.skus||[],codes=new Set();if(!skus.length)add('review','skus','addSku','审核前请至少添加一个 SKU');
 skus.forEach((s,row)=>{
  const code=String(s.sku||'').trim();if(!code)add('save','skus','skuRows','SKU编码不能为空',row,'sku');else if(codes.has(code))add('save','skus','skuRows','SKU编码重复，请使用不同编码',row,'sku');codes.add(code);
  for(const key of ['cost','price','stock']){const raw=s[key],number=Number(raw),empty=raw===undefined||raw===null||String(raw).trim()==='';if(empty||!Number.isFinite(number)||number<0||(key==='stock'&&!Number.isSafeInteger(number)))add('save','skus','skuRows',({cost:'成本须为非负金额，允许0',price:'售价须为非负金额，允许先填0',stock:'库存须为非负整数，允许0'})[key],row,key);else if(key==='price'&&number===0)add('review','skus','skuRows','审核前售价须大于0',row,key);}
  if(editor&&!p.spec_names&&!String(s.spec||'').trim())add('save','skus','skuRows','请填写规格；单规格可填写“默认”',row,'spec');
 });
 if(p.spec_names?.length){try{specificationMatrix(p);}catch(error){const row=skus.findIndex(s=>!Array.isArray(s.spec_values)||s.spec_values.some(v=>!String(v||'').trim()));if(row>=0){const key='specValue'+Math.max(0,skus[row].spec_values?.findIndex(v=>!String(v||'').trim())??0);add('save','skus','skuRows',error.message,row,key);}else add('save','skus','specNames',error.message);}}
 return {issues,save:issues.filter(i=>i.stage==='save'),review:issues.filter(i=>i.stage==='review')};
}
