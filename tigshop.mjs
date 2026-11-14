import {specificationMatrix} from './public/specifications.js';
import {tigshopPrices} from './tigshop-pricing.mjs';
const httpsImage=value=>{try{const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||/[\u0000-\u0020]/.test(value))throw Error();return value;}catch{throw Error('图片必须为无账号密码的 HTTPS 地址');}};
const html=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function assertTigshopAttributes(attributes){
 if(!Array.isArray(attributes)||attributes.length>100)throw Error('Tigshop 商品参数须为列表，最多 100 项');
 const issues=[];
 for(const [i,row] of attributes.entries()){
  const name=typeof row?.name==='string'?row.name:'',value=typeof row?.value==='string'?row.value:'';
  const label='第 '+(i+1)+' 项'+(name.trim()?'「'+[...name].slice(0,30).join('')+([...name].length>30?'…':'')+'」':'');
  const reasons=[];
  for(const [field,text,limit] of [['名称',name,60],['内容',value,120]]){
   const length=[...text].length;
   if(!text.trim())reasons.push(field+'为空');
   if(length>limit)reasons.push(field+'有 '+length+' 字，最多 '+limit+' 字');
   if(/[\u{10000}-\u{10FFFF}]/u.test(text))reasons.push(field+'含表情或其他四字节字符');
  }
  if(reasons.length)issues.push(label+'：'+reasons.join('、'));
 }
 if(issues.length)throw Error('Tigshop 商品参数（参数与说明）：'+issues.slice(0,3).join('；')+(issues.length>3?'；另有 '+(issues.length-3)+' 项':''));
}
export function buildTigshopProduct(lease,fx,shipping={}){
 if(!Number.isSafeInteger(shipping.templateId)||shipping.templateId<=0)throw Error("请选择 Tigshop 真实运费模板");
 const p=lease?.product;
 if(!/^OPS-[0-9a-f]{32}$/.test(lease?.marker||''))throw Error('缺少可信任务标记');
 if(p?.catalog_target!=='tigshop'||!Number.isSafeInteger(p.category_id)||p.category_id<=0)throw Error('请选择 Tigshop 分类');
 if(typeof p.title!=='string'||!p.title.trim()||p.title.length>100)throw Error('Tigshop 标题须为 1–100 字符');
 if(!Array.isArray(p.images)||!p.images.length||p.images.length>30)throw Error('图片数量无效');
 if((p.brand_ids?.length||0)>1||p.brand_ids?.some(id=>!Number.isSafeInteger(id)||id<=0))throw Error('Tigshop 只支持单个品牌');
 if(p.tag_ids?.length)throw Error('Tigshop 标签映射尚未配置，请清空 CRMEB 标签');
 if(!Array.isArray(p.skus)||p.skus.length<1||p.skus.length>100)throw Error('SKU 数量无效');
 if(p.detail_images!==undefined&&(!Array.isArray(p.detail_images)||p.detail_images.length>100))throw Error('详情图数量无效');
 const detailImages=(p.detail_images||[]).map(httpsImage);
 const images=p.images.map(httpsImage),codes=new Set(),specs=new Set();
 const skus=tigshopPrices(p.skus,fx),matrix=specificationMatrix(p);
 const values=matrix.structured?matrix.rows:skus.map(s=>[String(s.spec||'默认').trim()]);
 skus.forEach((s,i)=>{
  const combination=JSON.stringify(values[i]);
  if(values[i].some(v=>!v||v.length>100||/[;:=]/.test(v))||specs.has(combination))throw Error('规格值无效或重复');specs.add(combination);
  if(typeof s.sku!=='string'||!/^[A-Za-z0-9._-]{1,64}$/.test(s.sku)||codes.has(s.sku))throw Error('SKU 编码无效或重复');codes.add(s.sku);
  if(!Number.isSafeInteger(s.stock)||s.stock<0||s.stock>2147483647)throw Error('库存无效');
 });
 const spe=matrix.names.map((name,j)=>{
  const seen=new Set(),attrList=[];
  values.forEach((row,i)=>{
   const value=row[j];if(seen.has(value))return;seen.add(value);
   const pics=new Set(skus.filter((s,k)=>values[k][j]===value).map(s=>httpsImage(s.image||images[0])));
   if(j===0&&pics.size>1)throw Error('Tigshop 同一首级规格的配图不一致，请统一配图或调整规格维度顺序');
   const pic=pics.size===1?[...pics][0]:'';
   attrList.push({attrType:1,attrName:name,attrValue:value,attrPrice:0,attrColor:'',attrPic:pic,attrPicThumb:pic,sortOrder:attrList.length});
  });
  return {attrName:name,attrList};
 });
 const stock=skus.reduce((n,s)=>n+s.stock,0);
 if(stock<=0)throw Error('Tigshop 商品总库存必须大于 0，请先填写实际库存');
 if(stock>2147483647)throw Error('总库存超出范围');
 const normal=[];
 if(p.tigshop_native_attributes===true){
  assertTigshopAttributes(p.attributes);
  const groups=new Map();
  for(const row of p.attributes){
   if(!groups.has(row.name)){const group={attrName:row.name,attrList:[]};groups.set(row.name,group);normal.push(group);}
   const group=groups.get(row.name);if(group.attrList.some(x=>x.attrValue===row.value))continue;
   group.attrList.push({attrType:0,attrName:row.name,attrValue:row.value,attrPrice:0,attrColor:'',attrPic:'',attrPicThumb:'',sortOrder:0});
  }
 }
 const sales=p.virtual_sales??0;if(!Number.isSafeInteger(sales)||sales<0||sales>2147483647)throw Error('虚拟销量无效');
 return {productType:1,shopId:0,productStatus:0,checkStatus:1,saleMode:0,deliveryMode:1,
  productName:p.title,productSn:lease.marker,categoryId:p.category_id,brandId:p.brand_ids?.[0]||0,
  productStock:stock,productPrice:Math.min(...skus.map(s=>s.price)),costPrice:Math.min(...skus.map(s=>s.cost)),marketPrice:0,
  productBrief:'',productDesc:'<p>'+html(p.description||'').replace(/\n/g,'<br>')+'</p>'+detailImages.map(src=>'<p><img src="'+html(src)+'"></p>').join(''),
  imgList:images.map((picUrl,sortOrder)=>({picUrl,picOriginal:picUrl,picThumb:picUrl,picLarge:picUrl,sortOrder})),picUrl:images[0],picOriginal:images[0],picThumb:images[0],
  attrList:{normal,extra:[],spe},skuType:2,
  productList:skus.map((s,i)=>({skuSn:s.sku,skuValue:matrix.names.map((name,j)=>name+':'+values[i][j]).join(';'),attrs:matrix.names.map((name,j)=>({attrName:name,attrValue:values[i][j]})),skuPrice:s.price.toFixed(2),costPrice:s.cost,marketPrice:0,skuStock:s.stock,isEnabled:1})),
  virtualSales:sales,remark:lease.marker,freeShipping:0,shippingTplId:shipping.templateId,noShipping:0,isLogistics:1,isShopDelivery:0,isShopPickup:0,
  productWeight:0,productVolume:0,productServiceIds:[],productArticleList:[],productRelated:[],productVideoInfo:[],isPromote:false,isPromoteActivity:false,isDelete:0,isBest:0,isNew:0,isHot:0,
  sortOrder:0,storeSortOrder:0,limitNumber:0,isSupportReturn:0,isSupportCod:0,giveIntegral:-1,rankIntegral:-1,integral:0,fixedShippingType:2,fixedShippingFee:0};
}
export function tigshopCreateReceipt(response){
 if(response?.code!==0)return {status:'unknown',message:'Tigshop 未明确返回创建成功，请先核对商城，禁止重复创建'};
 return {status:'awaiting_review',message:'Tigshop 已返回，请按任务货号查找自营下架商品，填写商品 ID 核对；暂未确认入库正确'};
}
export function verifyTigshopProduct(response,lease,fx,shipping){
 const fail=message=>({status:'awaiting_review',message});
 if(response?.code!==0||!response.data)return fail('Tigshop 商品详情读取失败');
 const d=response.data,e=buildTigshopProduct(lease,fx,shipping);
 if(String(d.productId)!==String(lease.candidate_id)||d.productSn!==e.productSn||d.shopId!==0||d.productStatus!==0||d.isDelete!==0||d.productName!==e.productName||d.categoryId!==e.categoryId||Number(d.brandId||0)!==e.brandId)return fail('Tigshop 商品 ID、货号、归属、下架状态、分类或品牌不一致');
 if(!Array.isArray(d.productList)||d.productList.length!==e.productList.length)return fail('Tigshop SKU 数量不一致');
 if(Number(d.shippingTplId)!==e.shippingTplId||d.fixedShippingType!==2||d.freeShipping!==0)return fail('Tigshop 运费模板不一致');
 const seen=new Set();
 for(const s of e.productList){const a=d.productList.find(x=>x.skuSn===s.skuSn);if(!a||seen.has(a.skuSn)||Number(a.skuPrice)!==Number(s.skuPrice)||Number(a.costPrice)!==s.costPrice||a.skuStock!==s.skuStock||a.isEnabled!==1||a.skuData?.length!==s.attrs.length||s.attrs.some(attr=>!a.skuData.some(value=>value.name===attr.attrName&&value.value===attr.attrValue)))return fail('Tigshop SKU 规格、欧元金额或库存不一致');seen.add(a.skuSn);}
 if(!Array.isArray(d.attrList?.spe)||d.attrList.spe.length!==e.attrList.spe.length)return fail('Tigshop 规格维度数量不一致');
 for(const group of e.attrList.spe){
  const actual=(d.attrList?.spe||[]).filter(g=>g.attrName===group.attrName);
  if(actual.length!==1||actual[0].attrList?.length!==group.attrList.length)return fail('Tigshop 规格维度或选项数量不一致');
  for(const s of group.attrList){const matches=actual[0].attrList.filter(a=>a.attrValue===s.attrValue);if(matches.length!==1||String(matches[0].attrPic||'')!==s.attrPic)return fail('Tigshop SKU 配图不一致');}
 }
 if(lease.product.tigshop_native_attributes===true){
  const actual=d.attrList?.normal;
  if(!Array.isArray(actual)||actual.length!==e.attrList.normal.length)return fail('Tigshop 商品参数数量不一致');
  for(const [index,group] of e.attrList.normal.entries()){
   const found=actual[index];
   if(found?.attrName!==group.attrName||!Array.isArray(found.attrList)||found.attrList.length!==group.attrList.length||group.attrList.some((row,i)=>found.attrList[i]?.attrName!==row.attrName||found.attrList[i]?.attrValue!==row.attrValue||Number(found.attrList[i]?.attrType)!==0))return fail('Tigshop 商品参数名称、内容或顺序不一致');
  }
 }
 return {status:'succeeded',remote_id:String(d.productId),message:'Tigshop 自营下架商品已核对：货号、分类品牌、SKU、欧元价格成本、库存与配图地址一致；图片内容仍需人工检查'};
}
