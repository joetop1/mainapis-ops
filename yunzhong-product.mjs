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
 if(![2,3].includes(categoryLevel)||!Array.isArray(categoryIds)||categoryIds.length!==2||categoryIds.at(-1)!==product.category_id||categoryIds.some(id=>!Number.isSafeInteger(id)||id<=0))throw Error('请选择真实的两级芸众分类路径');
 if(typeof product.title!=='string'||!product.title.trim()||product.title.length>100)throw Error('芸众商品标题须为1–100字');
 if(!Array.isArray(product.images)||product.images.length<1||product.images.length>30)throw Error('商品主图须为1–30张');
 if(product.detail_images!==undefined&&(!Array.isArray(product.detail_images)||product.detail_images.length>100))throw Error('详情图最多100张');
 if(String(product.description||'').trim()||normalizeProductAttributes(product.attributes).length)throw Error('现有芸众接口仅接受图片详情；尚不能完整保存文字详情和产品参数，已阻止创建以免丢失内容');
 if(product.brand_ids?.length)throw Error('芸众官方接口未提供品牌校验，请不要设置品牌');
 if(product.tag_ids?.length||product.virtual_sales)throw Error('芸众标签和虚拟销量尚未映射，请清空CRMEB标签并将虚拟销量设为0');
 if(typeof dispatchPrice!=='string'||!/^\d{1,7}(\.\d{1,2})?$/.test(dispatchPrice))throw Error('请明确配置芸众固定运费，单位元');
 if(!Array.isArray(product.skus)||product.skus.length<1||product.skus.length>100)throw Error('请使用1–100个SKU');
 const images=product.images.map(image),detail=(product.detail_images||[]).map(image),matrix=specificationMatrix(product);
 const names=matrix.structured?matrix.names:['规格'];
 if(names.length!==1)throw Error('当前芸众规格服务存在跨维度ID累积问题，暂不提交多维SKU；请等待官方接口修复');
 const values=matrix.structured?matrix.rows:product.skus.map(s=>[String(s.spec||'默认').trim()]);
 const codes=new Set(),combinations=new Set();let stock=0;
 product.skus.forEach((sku,index)=>{
  if(typeof sku.sku!=='string'||!/^[A-Za-z0-9_.-]{1,64}$/.test(sku.sku)||codes.has(sku.sku))throw Error('SKU编码不正确或重复');codes.add(sku.sku);
  if(!Number.isFinite(sku.price)||sku.price<=0||sku.price>99999999||!Number.isFinite(sku.cost)||sku.cost<0||sku.cost>99999999||!Number.isSafeInteger(sku.stock)||sku.stock<0)throw Error('价格、成本或库存无效');
  if(Number(sku.price.toFixed(2))!==sku.price||Number(sku.cost.toFixed(2))!==sku.cost)throw Error('芸众金额最多支持两位小数');
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

export function verifyYunzhongOfficialProduct(actual,optionData,lease,config){
 const pending=message=>({status:'awaiting_review',remote_id:String(lease.candidate_id||''),message});
 let expected;try{expected=buildYunzhongProduct(lease,config);}catch{return pending('任务字段不受当前芸众官方API支持，请核对原任务');}
 if(String(actual?.id)!==String(lease.candidate_id)||actual.goods_sn!==lease.marker||Number(actual.status)!==0||actual.title!==expected.base.title)return pending('商品ID、任务货号、下架状态或标题不匹配');
 if(Number(actual.price)!==Number(expected.base.price)||Number(actual.cost_price)!==Number(expected.base.cost_price)||Number(actual.stock)!==expected.base.stock||actual.thumb!==expected.base.thumb)return pending('基础价格成本、总库存或首图不一致');
 const definitions=optionData?.specs,rows=optionData?.option;
 if(Number(optionData?.has_option)!==1||!Array.isArray(definitions)||definitions.length!==1||definitions[0].title!==expected.options.specs[0].title||!Array.isArray(rows)||rows.length!==expected.options.option.length||new Set(rows.map(row=>row.goods_sn)).size!==rows.length)return pending('SKU数量、编码或规格维度不一致');
 const items=definitions[0].spec_item;if(!Array.isArray(items))return pending('规格值未返回');
 const names=new Map(items.map(item=>[String(item.id),item.title]));
 for(const want of expected.options.option){
  const row=rows.find(item=>item.goods_sn===want.goods_sn),specs=String(row?.specs||'').split('_');
  const value=expected.options.specs[0].spec_item.find(item=>item.id===want.specs)?.title;
  if(!row||Number(row.product_price)!==Number(want.product_price)||Number(row.cost_price)!==Number(want.cost_price)||Number(row.stock)!==want.stock||row.thumb!==want.thumb||specs.length!==1||names.get(specs[0])!==value)return pending('SKU价格成本、库存、图片或规格值不一致');
 }
 return pending('已创建下架商品，基础字段与SKU已核对；官方API未返回分类、完整主图组和详情内容，请到商城人工核对，当前尚未确认为发布成功');
}
