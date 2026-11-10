import {validateProduct} from './core.mjs';
export function buildSameStyleProduct(products,input){
 const stockOnly=input.reference_id==='',main=products.find(p=>p.id===input.main_id);
 const reference=stockOnly?main:products.find(p=>p.id===input.reference_id);
 const stocks=stockOnly?products:products.filter(p=>p.id!==input.reference_id);
 if(stockOnly&&stocks.length<2)throw Error('仅合并货盘需要至少两款商品');
 if(!reference||(!stockOnly&&reference.supplier_import)||!reference.skus?.length)throw Error('请选择已采集且有SKU的图文资料商品');
 if(!stocks.length||stocks.some(p=>!p.supplier_import)||!stocks.includes(main))throw Error('请选择货盘商品作为库存来源和分类品牌来源');
 if(typeof input.title!=='string'||!input.title.trim()||input.title.trim().length>200)throw Error('请填写1至200字商品标题');
 if(!['reference','stock'].includes(input.images))throw Error('请选择主图来源');
 const expected=new Map(stocks.flatMap(p=>p.skus.map(s=>[JSON.stringify([p.id,s.sku]),{p,s}])));
 if(!Array.isArray(input.rows)||input.rows.length!==expected.size||!input.rows.length||input.rows.length>500)throw Error('须逐一对应全部货盘SKU，最多500个');
 const seen=new Set(),matched=new Set();
 const skus=input.rows.map(row=>{
  const key=JSON.stringify([row.product_id,row.original_sku]),entry=expected.get(key);
  if(!entry||seen.has(key))throw Error('货盘SKU遗漏或重复');seen.add(key);
  const {p,s}=entry;let image=s.image||p.images[0]||'';
  if(row.reference_sku){if(stockOnly)throw Error('仅合并货盘不能对应采集规格');const target=reference.skus.find(s=>s.sku===row.reference_sku);if(!target||matched.has(target.sku))throw Error('采集规格不存在或被重复对应，请逐行核对');matched.add(target.sku);image=target.image||reference.images[0]||image;}
  return {...s,spec:String(row.value||'').trim(),spec_values:[String(row.value||'').trim()],image,source:s.source||{url:p.source_url,sku:s.sku,product_id:p.id,revision:p.revision,spec:s.spec||''}};
 });
 const product=validateProduct({...main,source_url:reference.source_url,title:input.title.trim(),description:reference.description||'',attributes:reference.attributes||[],sourcing:undefined,supplier_import:undefined,virtual_sales:0,spec_names:[input.dimension],skus,images:[...new Set(stockOnly||input.images==='reference'?reference.images:stocks.flatMap(p=>p.images))],detail_images:reference.detail_images||[],merge_sources:products.map(p=>({product_id:p.id,revision:p.revision,url:p.source_url})),same_style:{reference_id:reference.id,stock_ids:stocks.map(p=>p.id),matches:input.rows.map(row=>({product_id:row.product_id,sku:row.original_sku,reference_sku:row.reference_sku||''}))}},stockOnly?{supplier:main.supplier_import}:{});
 return {product,warnings:stockOnly?['沿用主商品图文、分类和品牌；各 SKU 保留各自的条码、成本、售价、库存及配图。','原货盘商品保留，本次生成新的待整理商品。']:['货盘的条码、成本、售价和库存保留；采集商品的价格、库存和多余规格不会导入。','分类品牌继承所选货盘主商品，图文参数来自资料商品，请检查是否适用于全部规格。','来源记录和商城已有商品均保留，本次只生成一件新的待整理商品。',...(matched.size<skus.length?['有'+(skus.length-matched.size)+'个SKU未对应采集规格，保留货盘原图，请在编辑页补图。']:[])]};
}
