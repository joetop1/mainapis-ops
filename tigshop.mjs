import {tigshopPrices} from './tigshop-pricing.mjs';
const httpsImage=value=>{try{const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||/[\u0000-\u0020]/.test(value))throw Error();return value;}catch{throw Error('图片必须为无账号密码的 HTTPS 地址');}};
const html=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
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
 const images=p.images.map(httpsImage),codes=new Set(),specs=new Set();
 const skus=tigshopPrices(p.skus,fx);
 const attrList=skus.map((s,i)=>{
  const spec=String(s.spec||'默认').trim();
  if(!spec||spec.length>100||/[;:=]/.test(spec)||specs.has(spec))throw Error('规格值无效或重复');specs.add(spec);
  if(typeof s.sku!=='string'||!/^[A-Za-z0-9._-]{1,64}$/.test(s.sku)||codes.has(s.sku))throw Error('SKU 编码无效或重复');codes.add(s.sku);
  if(!Number.isSafeInteger(s.stock)||s.stock<0||s.stock>2147483647)throw Error('库存无效');
  return {attrType:1,attrName:'规格',attrValue:spec,attrPrice:0,attrColor:'',attrPic:httpsImage(s.image||images[0]),attrPicThumb:httpsImage(s.image||images[0]),sortOrder:i};
 });
 const stock=skus.reduce((n,s)=>n+s.stock,0);
 if(stock<=0)throw Error('Tigshop 商品总库存必须大于 0，请先填写实际库存');
 if(stock>2147483647)throw Error('总库存超出范围');
 const sales=p.virtual_sales??0;if(!Number.isSafeInteger(sales)||sales<0||sales>2147483647)throw Error('虚拟销量无效');
 return {productType:1,shopId:0,productStatus:0,checkStatus:1,saleMode:0,deliveryMode:1,
  productName:p.title,productSn:lease.marker,categoryId:p.category_id,brandId:p.brand_ids?.[0]||0,
  productStock:stock,productPrice:Math.min(...skus.map(s=>s.price)),costPrice:Math.min(...skus.map(s=>s.cost)),marketPrice:0,
  productBrief:'',productDesc:'<p>'+html(p.description||'').replace(/\n/g,'<br>')+'</p>'+images.map(src=>'<p><img src="'+html(src)+'"></p>').join(''),
  imgList:images.map((picUrl,sortOrder)=>({picUrl,picOriginal:picUrl,picThumb:picUrl,picLarge:picUrl,sortOrder})),picUrl:images[0],picOriginal:images[0],picThumb:images[0],
  attrList:{normal:[],extra:[],spe:[{attrName:'规格',attrList}]},skuType:2,
  productList:skus.map((s,i)=>({skuSn:s.sku,skuValue:'规格:'+attrList[i].attrValue,attrs:[{attrName:'规格',attrValue:attrList[i].attrValue}],skuPrice:s.price.toFixed(2),costPrice:s.cost,marketPrice:0,skuStock:s.stock,isEnabled:1})),
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
 for(const s of e.productList){const a=d.productList.find(x=>x.skuSn===s.skuSn);if(!a||seen.has(a.skuSn)||Number(a.skuPrice)!==Number(s.skuPrice)||Number(a.costPrice)!==s.costPrice||a.skuStock!==s.skuStock||a.isEnabled!==1||a.skuData?.length!==1||a.skuData[0].name!=='规格'||a.skuData[0].value!==s.attrs[0].attrValue)return fail('Tigshop SKU 规格、欧元金额或库存不一致');seen.add(a.skuSn);}
 for(const s of e.attrList.spe[0].attrList){const matches=(d.attrList?.spe||[]).filter(g=>g.attrName==='规格').flatMap(g=>g.attrList||[]).filter(a=>a.attrValue===s.attrValue);if(matches.length!==1||matches[0].attrPic!==s.attrPic)return fail('Tigshop SKU 配图不一致');}
 return {status:'succeeded',remote_id:String(d.productId),message:'Tigshop 自营下架商品已核对：货号、分类品牌、SKU、欧元价格成本、库存与配图地址一致；图片内容仍需人工检查'};
}
