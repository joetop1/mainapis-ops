// Repair for the confirmed OPS-created product. Fill the existing merchant form only.
// No HTTP requests, save calls, inventory methods or credentials are accessed.
export function fillMerchant554Images(product){
 const fail=error=>({error});
 if(location.protocol!=='https:'||!['xlupw.com','www.xlupw.com'].includes(location.hostname)||!location.pathname.startsWith('/admin/'))return fail('请在 CRMEB 会员商城后台打开商品 554 的编辑页');
 let source;try{source=new URL(product?.source_url);}catch{return fail('采集文件来源无效');}
 if(source.protocol!=='https:'||source.hostname!=='detail.1688.com'||source.pathname!=='/offer/755369163302.html')return fail('该补图入口仅用于已确认的袜子商品 554，采集文件来源不匹配');
 if(!Array.isArray(product.skus)||product.skus.length!==64)return fail('采集文件必须包含这件商品的全部 64 个 SKU');
 const images=new Map();
 for(const s of product.skus){
  if(!s.sku||images.has(s.sku)||!s.spec)return fail('采集文件 SKU 编码或名称无效');
  try{const u=new URL(s.image);if(u.protocol!=='https:'||u.username||u.password)throw Error();images.set(s.sku,{image:u.href,spec:s.spec});}catch{return fail('全部 64 个 SKU 都需要有效的 HTTPS 图片');}
 }
 const queue=[],seen=new Set(),matches=[];
 for(const el of [...document.querySelectorAll('*')].slice(0,15000))if(el.__vue__)queue.push(el.__vue__);
 while(queue.length&&seen.size<5000){
  const vm=queue.shift();if(!vm||seen.has(vm))continue;seen.add(vm);
  if(String(vm.$route?.query?.id)==='554'&&!vm.$route?.query?.copy&&vm.formData&&Array.isArray(vm.manyFormValidate))matches.push(vm);
  if(Array.isArray(vm.$children))queue.push(...vm.$children);
 }
 if(matches.length!==1)return fail('未找到唯一的商品 554 编辑表单。请从商城商品列表点击编辑并等待规格加载完成');
 const vm=matches[0],form=vm.formData;
 if(form.code!=='OPS-46499e8b05a944af8f9a418f7d78f2ed'||form.store_name!==product.title||Number(form.spec_type)!==1)return fail('商品任务编码、标题或规格类型不匹配，未修改任何数据');
 const batch=new Set(Array.isArray(vm.oneFormBatch)?vm.oneFormBatch:[]);
 const rows=vm.manyFormValidate.filter(row=>!batch.has(row));
 if(rows.length!==64)return fail('商城编辑表单的 SKU 数量不是 64，未修改任何数据');
 const codes=new Set(),targets=[];
 for(const row of rows){
  const found=images.get(row.code);
  if(!found||codes.has(row.code)||row.detail?.['规格']!==found.spec)return fail('商城 SKU 编码或规格名称与采集文件不一致，未修改任何数据');
  codes.add(row.code);targets.push([row,found.image]);
 }
 // Some builds keep a separate attrs array until submission; only patch matching rows.
 if(Array.isArray(form.attrs)&&form.attrs.length){
  if(form.attrs.length!==64)return fail('商城内部规格数组与当前表单数量不一致');
  const inner=new Set();for(const row of form.attrs){const found=images.get(row.code);if(!found||inner.has(row.code)||row.detail?.['规格']!==found.spec)return fail('商城内部 SKU 数据不一致');inner.add(row.code);targets.push([row,found.image]);}
 }
 const attrTargets=[];
 if(Array.isArray(vm.attrs))for(const group of vm.attrs){
  if(group.value!=='规格'||!Array.isArray(group.detail))return fail('商城规格维度已改变，未修改图片');
  for(const item of group.detail){
   if(!item||typeof item!=='object')return fail('商城规格图片结构不受支持');
   const found=product.skus.find(s=>s.spec===item.value);if(!found)return fail('规格项名称不匹配');attrTargets.push([item,images.get(found.sku).image]);
  }
 }
 // All checks precede the first mutation. Keep everything except pic byte-for-byte.
 const unique=[...new Map([...targets,...attrTargets].map(([row,url])=>[row,url])).entries()];
 const before=unique.map(([row])=>({row,had:Object.hasOwn(row,'pic'),pic:row.pic}));
 try{
  for(const [row,url]of unique){if(typeof vm.$set==='function')vm.$set(row,'pic',url);else row.pic=url;}
  if(typeof vm.$forceUpdate==='function')vm.$forceUpdate();
 }catch{
  for(const old of before){if(old.had)old.row.pic=old.pic;else delete old.row.pic;}
  return fail('填入失败，已恢复原图片；未提交商城');
 }
 return {ok:true,product_id:554,count:64,message:'已填入商品 554 的 64 个 SKU 图片，尚未提交。请在商城核对图片、售价和库存后点击原页面保存。'};
}
