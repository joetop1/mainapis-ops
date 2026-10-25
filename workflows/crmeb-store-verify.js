// Explicit dimensions only. Legacy display text is never guessed into dimensions.
function specificationMatrix(product){
 const skus=product.skus||[],raw=product.spec_names;
 if(raw===undefined){
  if(skus.some(s=>s.spec_values!==undefined))throw Error('SKU 提供了分维度规格值，请同时填写规格名称');
  return {structured:false,names:['规格'],rows:skus.map(s=>[String(s.spec||'默认').trim()])};
 }
 if(!Array.isArray(raw)||raw.length<1||raw.length>5)throw Error('请填写 1–5 个规格维度');
 const clean=(value,limit)=>{
  if(typeof value!=='string'||!value.trim()||value.trim().length>limit||/[\u0000-\u001f,;=:]/.test(value))throw Error('规格名称或值为空、过长或含不支持的分隔符');
  return value.trim();
 };
 const names=raw.map(n=>clean(n,30));
 if(new Set(names).size!==names.length||names.some(n=>['__proto__','constructor','prototype'].includes(n)))throw Error('规格名称重复或无效');
 const combinations=new Set();
 const rows=skus.map(s=>{
  if(!Array.isArray(s.spec_values)||s.spec_values.length!==names.length)throw Error('每个 SKU 的规格值数量必须与规格维度一致');
  const values=s.spec_values.map(v=>clean(v,100)),key=JSON.stringify(values);
  if(values.join(' / ').length>300||combinations.has(key))throw Error('SKU 规格组合重复或过长');
  combinations.add(key);return values;
 });
 return {structured:true,names,rows};
}

function remapSpecificationValues(skus,previous,next){
 if(next.length)specificationMatrix({spec_names:next,skus:[]});
 return skus.map(s=>{
  const row={...s};
  if(next.length)row.spec_values=next.map(name=>{const index=previous.indexOf(name);return index>=0?s.spec_values?.[index]||'':'';});
  else delete row.spec_values;
  return row;
 });
}

function matchSpecificationImport(sourceUrl,current,incoming){
 const canonical=value=>typeof value==='string'?value.match(/^https:\/\/detail\.1688\.com\/offer\/(\d+)\.html(?:[?#].*)?$/)?.[1]:null;
 if(!canonical(sourceUrl)||canonical(sourceUrl)!==canonical(incoming?.source_url))throw Error('规格导入来源与当前商品不一致');
 if(!Array.isArray(current)||!current.length||!Array.isArray(incoming?.skus)||incoming.skus.length!==current.length)throw Error('重新采集的 SKU 数量与当前商品不一致，请核对完整规格');
 const matrix=specificationMatrix(incoming);if(!matrix.structured)throw Error('采集文件不含独立规格维度，请使用新版采集助手重新采集');
 const rows=new Map();incoming.skus.forEach((sku,i)=>{if(typeof sku.sku!=='string'||!sku.sku||rows.has(sku.sku))throw Error('采集文件 SKU 编码缺失或重复');rows.set(sku.sku,matrix.rows[i]);});
 if(new Set(current.map(s=>s.sku)).size!==current.length||current.some(s=>!rows.has(s.sku)))throw Error('SKU 编码不一致，不能自动匹配规格');
 return {names:matrix.names,skus:current.map(s=>({...s,spec_values:[...rows.get(s.sku)],spec:rows.get(s.sku).join(' / ')}))};
}

// Official outapi/product field defaults, checked against the supplied Pro 4.3 controller.
function requireOfficialToken(response){
  if(Number(response?.status)!==200 || typeof response?.data?.access_token!=='string' || !response.data.access_token)throw Error('CRMEB 授权未成功，请检查凭据或权限；不要将整个响应贴出');
  return response.data.access_token;
}
function officialCreateReceipt(response){
  // Even a business error can follow a committed save/event failure. Never release a write for retry.
  if(response?.error||Number(response?.status)!==200)return {status:'unknown',message:'创建请求未返回明确成功（接口错误或响应异常）；请先在商城按任务编码核对，禁止自动重新创建'};
  return {status:'awaiting_review',message:'官方接口已返回成功；请到商城仓库查找该任务编码，填回商品 ID 后核验。此接口不返回 ID，当前尚未计为成功'};
}
function buildOfficialProduct(lease,config){
  const p=lease?.product;
  if(!p || !lease.marker || !/^OPS-[0-9a-f]{32}$/.test(lease.marker))throw Error('缺少可信任务标记');
  const ids=Number.isSafeInteger(p.category_id)&&p.category_id>0?[p.category_id]:config.categoryMap?.[p.category];
  if(!Array.isArray(ids)||!ids.length||ids.some(x=>!Number.isSafeInteger(x)||x<=0))throw Error('分类尚未映射到真实商城 ID');
  if(!Number.isSafeInteger(config.shippingTemplateId)||config.shippingTemplateId<=0)throw Error('请先设置商城真实运费模板 ID');
  if(typeof p.title!=='string'||!p.title.trim()||p.title.length>200)throw Error('标题为空或过长');
  if(!Array.isArray(p.images)||!p.images.length||p.images.length>30)throw Error('图片数量不正确');
  const images=p.images.map(x=>{if(typeof x!=='string'||!/^https:\/\/[a-z0-9.-]+(?::443)?(?:[/?#]|$)/i.test(x)||/[\u0000-\u0020]/.test(x))throw Error('图片必须是无账号密码的HTTPS地址');return x;});
  if(!Array.isArray(p.skus)||!p.skus.length||p.skus.length>100)throw Error('请使用1–100个SKU');
  const codes=new Set(),specs=new Set();
  const matrix=specificationMatrix(p);
  for(const key of ['brand_ids','tag_ids'])if(p[key]!==undefined&&(!Array.isArray(p[key])||p[key].length>50||p[key].some(id=>!Number.isSafeInteger(id)||id<=0)||new Set(p[key]).size!==p[key].length))throw Error('品牌或商品标签 ID 无效');
  const virtualSales=p.virtual_sales??0;
  if(!Number.isSafeInteger(virtualSales)||virtualSales<0||virtualSales>2147483647)throw Error('虚拟销量无效');
  const multi=config.forceMulti===true||p.skus.length>1||matrix.structured||Boolean(String(p.skus[0].spec||'').trim());
  const attrs=p.skus.map((s,i)=>{
    if(typeof s.sku!=='string'||!/^[A-Za-z0-9_.-]{1,64}$/.test(s.sku)||codes.has(s.sku))throw Error('SKU编码不正确或重复');codes.add(s.sku);
    const values=matrix.structured?matrix.rows[i]:[multi?String(s.spec||'').trim():'默认'];
    const value=JSON.stringify(values);
    if(values.some(v=>!v||v.length>100||/[,;=]/.test(v))||specs.has(value))throw Error('规格为空、重复或含不支持的分隔符');specs.add(value);
    if(!Number.isFinite(s.price)||s.price<=0||s.price>99999999||!Number.isFinite(s.cost)||s.cost<0||s.cost>99999999||!Number.isSafeInteger(s.stock)||s.stock<0||s.stock>2147483647)throw Error('价格、成本或库存错误');
    const pic=s.image||images[0];
    if(typeof pic!=='string'||!/^https:\/\/[a-z0-9.-]+(?::443)?(?:[/?#]|$)/i.test(pic)||/[\u0000-\u0020]/.test(pic))throw Error('SKU图片必须是无账号密码的HTTPS地址');
    return {attr_arr:values,detail:Object.fromEntries(matrix.names.map((name,j)=>[name,values[j]])),price:s.price,cost:s.cost,stock:s.stock,pic,ot_price:s.price,code:s.sku,bar_code:'',weight:0,volume:0,is_show:1,is_default_select:0,is_virtual:0,brokerage:0,brokerage_two:0,vip_price:0,vip_proportion:0,unique:''};
  });
  const items=matrix.names.map((name,j)=>{
    const seen=new Set(),detail=[];
    for(const row of attrs){const value=row.attr_arr[j];if(seen.has(value))continue;seen.add(value);
      const pics=new Set(attrs.filter(a=>a.attr_arr[j]===value).map(a=>a.pic));
      detail.push({value,pic:pics.size===1?[...pics][0]:''});
    }
    return {value:name,detail};
  });
  const escape=x=>String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  if(p.detail_images!==undefined&&(!Array.isArray(p.detail_images)||p.detail_images.length>100))throw Error('详情图数量不正确');
  const detailImages=(p.detail_images||[]).map(u=>{if(typeof u!=='string'||!/^https:\/\/[a-z0-9.-]+(?::443)?(?:[/?#]|$)/i.test(u)||/[\u0000-\u0020\\]/.test(u))throw Error('详情图必须使用无账号密码的 HTTPS 地址');return u;});
  const description=escape(p.description||'').replaceAll('\n','<br>')+detailImages.map(u=>'<p><img src="'+escape(u)+'" alt=""></p>').join('');
  return {...JSON.parse(JSON.stringify(CR_DEFAULTS)),store_name:p.title,store_info:String(p.description||'').slice(0,100),cate_id:ids,slider_image:images,description,
    is_show:0,auto_on_time:0,auto_off_time:0,is_copy:0,ficti:virtualSales,sales:0,brand_id:p.brand_ids??[],store_label_id:p.tag_ids??[],min_qty:1,spec_type:multi?1:0,
    freight:3,temp_id:config.shippingTemplateId,delivery_type:[1],product_clear:['is_general_product'],
    // Deliberately empty: CRMEB treats matching soure_link as an UPDATE even through POST create.
    // The original source remains in the immutable OPS snapshot, linked by the task marker.
    soure_link:'',code:lease.marker,items,attrs:multi?attrs:[],attr:multi?[]:attrs[0]};
}
function verifyOfficialProduct(response,lease,config){
  const pending=message=>({status:'awaiting_review',message});
  if(Number(response?.status)!==200||!response.data||typeof response.data!=='object')return pending('未读取到商品详情，请检查权限或商品 ID');
  // Pro 4.3 getInfo wraps the editable product in data.productInfo.
  const d=response.data.productInfo??response.data;
  if(String(d.id)!==lease.candidate_id||d.code!==lease.marker)return pending('商品 ID 或任务编码不匹配，未确认成功');
  if(d.is_show===undefined||Number(d.is_show)!==0)return pending('商品未处于下架状态，请在商城核对');
  let expected;try{expected=buildOfficialProduct(lease,config);}catch{return pending('本地字段映射配置未通过，请核对配置');}
  const ids=Array.isArray(d.cate_id)?d.cate_id.map(Number):String(d.cate_id||'').split(',').map(Number);
  if(d.store_name!==expected.store_name||expected.cate_id.some(id=>!ids.includes(id))||Number(d.spec_type)!==expected.spec_type)return pending('标题、分类或规格类型不一致，请在商城核对');
  const readIds=value=>Array.isArray(value)?value.map(x=>Number(typeof x==='object'?x.id:x)):String(value??'').split(',').filter(Boolean).map(Number);
  for(const key of ['brand_id','store_label_id'])if(expected[key].length){const actualIds=readIds(d[key]);if(actualIds.length!==expected[key].length||expected[key].some(id=>!actualIds.includes(id)))return pending('品牌或商品标签不一致，请在商城核对');}
  if(lease.product.virtual_sales!==undefined&&Number(d.ficti)!==expected.ficti)return pending('虚拟销量不一致，请在商城核对');
  const actual=expected.spec_type?d.attrs:[d.attr],want=expected.spec_type?expected.attrs:[expected.attr];
  if(!Array.isArray(actual)||actual.length!==want.length)return pending('SKU 数量不一致，未确认成功');
  for(const sku of want){const row=actual.find(s=>s?.code===sku.code);if(!row||Number(row.price)!==sku.price||Number(row.cost)!==sku.cost||Number(row.stock)!==sku.stock)return pending('SKU 编码、价格、成本或库存不一致');if(expected.spec_type&&(Object.keys(row.detail||{}).length!==Object.keys(sku.detail).length||Object.entries(sku.detail).some(([name,value])=>row.detail?.[name]!==value)))return pending('SKU 规格维度或内容不一致');}
  for(const source of lease.product.skus.filter(s=>s.image)){const row=actual.find(s=>s?.code===source.sku);if((row?.pic||row?.image)!==source.image)return pending('SKU 图片地址不一致，请检查该规格图片');}
  return {status:'succeeded',remote_id:String(d.id),message:'官方商品详情已核验：任务编码、下架状态、标题、分类、SKU 和价格库存一致；图片尚需人工检查'};
}
const CR_DEFAULTS = {"product_type":0,"supplier_id":0,"cate_id":[],"store_name":"","store_info":"","keyword":"","unit_name":"件","recommend_image":"","slider_image":[],"is_brokerage":0,"is_sub":[],"is_vip":0,"sort":0,"sales":0,"ficti":100,"give_integral":0,"is_show":0,"is_hot":0,"is_benefit":0,"is_best":0,"is_new":0,"mer_use":0,"is_postage":0,"is_good":0,"is_picks":0,"description":"","spec_type":0,"video_open":0,"video_link":"","items":[],"attrs":[],"attr":[],"recommend":[],"activity":[],"coupon_ids":[],"label_id":[],"command_word":"","tao_words":"","is_copy":0,"delivery_type":[],"freight":1,"postage":0,"temp_id":0,"recommend_list":[],"brand_id":[],"soure_link":"","bar_code":"","code":"","is_support_refund":1,"is_presale_product":0,"presale_time":[],"presale_day":0,"is_vip_product":0,"product_clear":["is_general_product"],"auto_on_time":0,"auto_off_time":0,"custom_form":[],"system_form_id":0,"store_label_id":[],"ensure_id":[],"specs":[],"specs_id":0,"is_limit":0,"limit_type":0,"limit_num":0,"share_content":"","min_qty":1,"presale_status":0,"is_send_gift":0,"send_gift_price":0,"level_type":1};

// Allowlist transcribed from the deployed MULTI 4.2 Product::productSave supplied by the operator, plus the confirmed presale_status default repair.
const STORE_FIELDS=['product_type','supplier_id','cate_id','store_name','store_info','keyword','unit_name','recommend_image','slider_image','is_sub','sort','sales','ficti','give_integral','is_show','is_good','is_picks','description','spec_type','video_open','video_link','items','attrs','recommend','activity','coupon_ids','label_id','command_word','tao_words','type','delivery_type','freight','postage','temp_id','recommend_list','brand_id','soure_link','bar_code','code','is_support_refund','is_presale_product','presale_status','presale_time','presale_day','is_vip_product','auto_on_time','auto_off_time','custom_form','store_label_id','ensure_id','specs','specs_id','is_limit','limit_type','limit_num','applicable_type','applicable_store_id'];
function requireStoreToken(response){
 if(response?.status!==undefined&&Number(response.status)!==200)throw Error('多门店授权失败，请核对独立凭据');
 const data=response?.data||response,token=data?.token||data?.access_token;
 if(typeof token!=='string'||!token)throw Error('多门店未返回有效 token');return token;
}
function storeLease(lease){
 const p=lease?.product;
 if(p?.catalog_target!=='crmeb-store'||!Number.isSafeInteger(p.category_id)||p.category_id<=0)throw Error('请从多门店的分类列表选择分类，不能使用会员商城分类');
 if(!Array.isArray(p.skus))throw Error('缺少 SKU');
 return {...lease,product:{...p,skus:p.skus.map(s=>({...s,spec:p.skus.length===1&&!String(s.spec||'').trim()?'默认':s.spec}))}};
}
function buildStoreProduct(lease,config){
 const payload=buildOfficialProduct(storeLease(lease),{...config,forceMulti:true});payload.type=0;
 const scope=lease.product.applicable_type??0;if(![0,1].includes(scope))throw Error('请选择所有门店或仅平台');
 payload.applicable_type=scope;payload.applicable_store_id=[];
 // Keep the full source gallery in description; the database carousel is a short list.
 // Match PHP json_encode escaping when applying the conservative serialized budget.
 const serializedLength=value=>JSON.stringify(value).replace(/\//g,'\\/').replace(/[\u007f-\uffff]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0')).length;
 const carousel=[];
 for(const image of payload.slider_image.slice(0,5)){
  if(serializedLength([...carousel,image])>1000){if(!carousel.length)throw Error('商品首图地址过长，请先转存图片');break;}
  carousel.push(image);
 }
 payload.slider_image=carousel;
 return Object.fromEntries(STORE_FIELDS.map(key=>[key,payload[key]]));
}
function verifyStoreProduct(response,lease,config){
 const d=response?.data?.productInfo||response?.data;
 if(d&&(Number(d.applicable_type)!==(lease.product.applicable_type??0)||(Array.isArray(d.applicable_store_id)?d.applicable_store_id.length>0:!!String(d.applicable_store_id??'').trim())))return {status:'awaiting_review',message:'门店适用范围未确认一致，请检查商城对外接口是否接收 applicable_type 和 applicable_store_id'};
 if(d&&d.product_type!==undefined&&Number(d.product_type)!==0)return {status:'awaiting_review',message:'多门店商品类型不是普通实物，未确认成功'};
 return verifyOfficialProduct(response,storeLease(lease),{...config,forceMulti:true});
}

const lease=$('读取可信任务快照').first().json;
const config=$('配置分类运费并转换字段').first().json.config;
return [{json:verifyStoreProduct($json,lease,config)}];
