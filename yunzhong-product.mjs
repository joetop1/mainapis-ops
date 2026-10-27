import {specificationMatrix} from './public/specifications.js';
import {normalizeProductAttributes} from './public/product-attributes.js';
const image=value=>{try{const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||/[\u0000-\u0020]/.test(value))throw Error();return value;}catch{throw Error('芸众图片必须是无账号密码的 HTTPS 地址');}};
// Source-verified payload preparation only. This module does not issue writes.
export function buildYunzhongProduct(lease,{categoryIds,categoryLevel,dispatchPrice}={}){
 const product=lease?.product;
 if(!/^OPS-[0-9a-f]{32}$/.test(lease?.marker||''))throw Error('缺少可信任务标记');
 if(product?.catalog_target!=='yunzhong')throw Error('商品资料不属于芸众商城');
 if(!Number.isSafeInteger(product.category_id)||product.category_id<=0)throw Error('请从芸众商城选择分类');
 if(categoryLevel!==2)throw Error('现有芸众外部接口只传入两级分类；三级分类模式尚未兼容');
 if(!Array.isArray(categoryIds)||categoryIds.length!==2||categoryIds.at(-1)!==product.category_id||categoryIds.some(id=>!Number.isSafeInteger(id)||id<=0))throw Error('请选择真实的两级芸众分类路径');
 if(typeof product.title!=='string'||!product.title.trim()||product.title.length>100)throw Error('芸众商品标题须为1–100字');
 if(!Array.isArray(product.images)||product.images.length<1||product.images.length>30)throw Error('商品主图须为1–30张');
 if(product.detail_images!==undefined&&(!Array.isArray(product.detail_images)||product.detail_images.length>100))throw Error('详情图最多100张');
 if(String(product.description||'').trim()||normalizeProductAttributes(product.attributes).length)throw Error('现有芸众接口仅接受图片详情；尚不能完整保存文字详情和产品参数，已阻止创建以免丢失内容');
 if(product.brand_ids?.length||product.tag_ids?.length||product.virtual_sales)throw Error('芸众品牌、标签和虚拟销量尚未完成核验，不能静默忽略');
 if(typeof dispatchPrice!=='string'||!/^\d{1,7}(\.\d{1,2})?$/.test(dispatchPrice))throw Error('请明确配置芸众固定运费，单位元');
 if(!Array.isArray(product.skus)||product.skus.length<1||product.skus.length>100)throw Error('请使用1–100个SKU');
 const images=product.images.map(image),detail=(product.detail_images||[]).map(image),matrix=specificationMatrix(product);
 const names=matrix.structured?matrix.names:['规格'];
 const values=matrix.structured?matrix.rows:product.skus.map(s=>[String(s.spec||'默认').trim()]);
 const codes=new Set(),combinations=new Set();let stock=0;
 product.skus.forEach((sku,index)=>{
  if(typeof sku.sku!=='string'||!/^[A-Za-z0-9_.-]{1,64}$/.test(sku.sku)||codes.has(sku.sku))throw Error('SKU编码不正确或重复');codes.add(sku.sku);
  if(!Number.isFinite(sku.price)||sku.price<=0||sku.price>99999999||!Number.isFinite(sku.cost)||sku.cost<0||sku.cost>99999999||!Number.isSafeInteger(sku.stock)||sku.stock<0)throw Error('价格、成本或库存无效');
  stock+=sku.stock;if(stock>2147483647)throw Error('总库存超出范围');
  const row=values[index],key=JSON.stringify(row);
  if(row.some(value=>!value||value.length>100)||combinations.has(key))throw Error('规格组合为空或重复');combinations.add(key);
 });
 // SC/SV/SP are the insertion prefixes expected by SpecOptionService, not real DB IDs.
 const specifications=names.map((name,index)=>({id:'SC'+index,title:name,spec_item:[...new Set(values.map(row=>row[index]))].map((value,item)=>({id:'SV'+index+'X'+item,title:value,show:1}))}));
 const options=product.skus.map((sku,index)=>({id:'SP'+index,specs:specifications.map((spec,dimension)=>spec.spec_item.find(item=>item.title===values[index][dimension]).id).join('_'),product_price:sku.price.toFixed(2),cost_price:sku.cost.toFixed(2),market_price:sku.price.toFixed(2),stock:sku.stock,weight:0,volume:0,goods_sn:sku.sku,product_sn:'',thumb:sku.image?image(sku.image):images[0],extra_info:{option_title:'',alias:'',thumb_url:[],content:'',param:[],video_image_path:'',goods_video_path:''}}));
 const minimum=key=>Math.min(...product.skus.map(sku=>sku[key])).toFixed(2);
 return {base:{title:product.title,alias:'',brand_id:0,thumb:images[0],thumb_url:images,good_content:detail,cost_price:minimum('cost'),market_price:minimum('price'),price:minimum('price'),sku:'件',stock,goods_sn:lease.marker,product_sn:'',status:0,category_pid:categoryIds[0],category_cid:categoryIds[1],dispatch_price:dispatchPrice},options:{specs:specifications,option:options}};
}
