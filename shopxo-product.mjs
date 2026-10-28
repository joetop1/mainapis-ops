import {specificationMatrix} from './public/specifications.js';
import {descriptionWithAttributes} from './public/product-attributes.js';
const image=value=>{let u;try{u=new URL(value);}catch{}if(!u||u.protocol!=='https:'||u.username||u.password||/[\u0000-\u0020\\]/.test(value)||value.length>250)throw Error('ShopXO图片须为不超过250字符的HTTPS地址，请先转存过长图片链接');return value;};
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function buildShopxoProduct(lease,warehouseId){
 const p=lease?.product;if(!/^OPS-[a-f0-9]{32}$/.test(lease?.marker||'')||p?.catalog_target!=='shopxo')throw Error('缺少可信ShopXO任务信息');
 if(!Number.isSafeInteger(warehouseId)||warehouseId<1)throw Error('请先选择ShopXO实际仓库');
 if(!Number.isSafeInteger(p.category_id)||p.category_id<1)throw Error('请选择ShopXO分类');
 if(typeof p.title!=='string'||p.title.trim().length<2||p.title.length>160)throw Error('ShopXO标题须为2–160字');
 if(p.brand_ids?.length>1||p.brand_ids?.some(id=>!Number.isSafeInteger(id)||id<1))throw Error('ShopXO仅支持单个品牌');
 if(p.tag_ids?.length)throw Error('ShopXO尚未映射CRMEB标签，请清空标签后提交；虚拟销量自动忽略');
 if(!Array.isArray(p.images)||!p.images.length||p.images.length>30||!Array.isArray(p.skus)||!p.skus.length||p.skus.length>100)throw Error('ShopXO须为1–30张主图、1–100个SKU');
 const images=p.images.map(image),detail=(p.detail_images||[]).map(image),matrix=specificationMatrix(p),names=matrix.structured?matrix.names:['规格'];
 const rows=matrix.structured?matrix.rows:p.skus.map(s=>[String(s.spec||'默认').trim()]);
 const axes=names.map((_,i)=>new Set(rows.map(row=>row[i]))),codes=new Set(),keys=new Set();
 axes.forEach((axis,i)=>axes.forEach((other,j)=>{if(i!==j&&[...axis].some(v=>other.has(v)))throw Error('ShopXO不同规格维度不能包含相同值，请调整规格值');}));
 let total=0;
 const skus=p.skus.map((s,i)=>{
  const key=rows[i].join('');if(!/^[A-Za-z0-9_.-]{1,64}$/.test(s.sku||'')||codes.has(s.sku)||keys.has(key)||rows[i].some(v=>!v||v.length>60||v.includes('{|}')))throw Error('ShopXO的SKU编码或规格组合无效、重复或有歧义');codes.add(s.sku);keys.add(key);
  if(!Number.isFinite(s.price)||s.price<=0||s.price>99999999||Number(s.price.toFixed(2))!==s.price||!Number.isFinite(s.cost)||s.cost<0||s.cost>99999999||Number(s.cost.toFixed(2))!==s.cost||!Number.isSafeInteger(s.stock)||s.stock<0)throw Error('ShopXO价格、成本或库存无效');
  total+=s.stock;if(total>2147483647)throw Error('ShopXO总库存超出范围');
  return {sku:s.sku,values:rows[i],price:s.price.toFixed(2),cost:s.cost.toFixed(2),stock:s.stock,image:image(s.image||images[0])};
 });
 // ShopXO native images attach to specification values rather than arbitrary combination rows.
 const imageAxis=names.findIndex((_,i)=>[...axes[i]].every(v=>new Set(skus.filter(s=>s.values[i]===v).map(s=>s.image)).size===1));
 if(imageAxis<0)throw Error('ShopXO规格图片无法完整映射，请让同一颜色等维度的规格使用一致图片');
 const text=descriptionWithAttributes(p.description,p.attributes);
 const content_html=(text?'<p>'+escape(text).replace(/\n/g,'<br>')+'</p>':'')+detail.map(url=>'<p><img src="'+escape(url)+'" alt=""></p>').join('');
 return {marker:lease.marker,title:p.title,category_id:p.category_id,brand_id:p.brand_ids?.[0]||0,warehouse_id:warehouseId,images,detail_images:detail,content_html,spec_names:names,image_axis:imageAxis,skus};
}
export function verifyShopxoProduct(actual,lease){
 const pending=message=>({status:'awaiting_review',remote_id:String(lease.candidate_id||actual?.id||''),message});
 let expected;try{expected=buildShopxoProduct(lease,lease.product.shopxo.warehouseId);}catch{return pending('本地ShopXO快照校验失败');}
 if(actual?.marker!==lease.marker||String(actual.id)!==String(lease.candidate_id)||Number(actual.status)!==0||actual.title!==expected.title||Number(actual.category_id)!==expected.category_id||Number(actual.brand_id)!==expected.brand_id||Number(actual.warehouse_id)!==expected.warehouse_id)return pending('ShopXO货号、标题、下架状态、分类品牌或仓库不一致');
 if(actual.cover!==expected.images[0]||Number(actual.stock)!==expected.skus.reduce((n,s)=>n+s.stock,0)||JSON.stringify(actual.detail_images)!==JSON.stringify(expected.detail_images)||JSON.stringify(actual.images)!==JSON.stringify(expected.images)||actual.content_html!==expected.content_html||JSON.stringify(actual.spec_names)!==JSON.stringify(expected.spec_names))return pending('ShopXO主图、详情或规格维度不一致，请检查商城');
 if(!Array.isArray(actual.skus)||actual.skus.length!==expected.skus.length||new Set(actual.skus.map(s=>s.sku)).size!==actual.skus.length)return pending('ShopXO SKU数量不一致');
 for(const row of expected.skus){const saved=actual.skus.find(s=>s.sku===row.sku);if(!saved||JSON.stringify(saved.values)!==JSON.stringify(row.values)||Number(saved.price)!==Number(row.price)||typeof saved.cost!=='string'||Number(saved.cost)!==Number(row.cost)||Number(saved.stock)!==row.stock||Number(saved.warehouse_stock)!==row.stock||saved.image!==row.image)return pending('ShopXO SKU价格、参考成本、仓库库存或配图不一致');}
 return {status:'succeeded',remote_id:String(actual.id),message:'ShopXO下架入库已核对：货号、分类品牌、主图详情、规格售价及仓库库存一致；采购参考成本保存在规格扩展字段，图片显示仍需人工检查。运费使用商城自身配置。'};
}
