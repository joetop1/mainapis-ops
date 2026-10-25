// Explicit dimensions only. Legacy display text is never guessed into dimensions.
export function specificationMatrix(product){
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

export function remapSpecificationValues(skus,previous,next){
 if(next.length)specificationMatrix({spec_names:next,skus:[]});
 return skus.map(s=>{
  const row={...s};
  if(next.length)row.spec_values=next.map(name=>{const index=previous.indexOf(name);return index>=0?s.spec_values?.[index]||'':'';});
  else delete row.spec_values;
  return row;
 });
}

export function matchSpecificationImport(sourceUrl,current,incoming){
 const canonical=value=>typeof value==='string'?value.match(/^https:\/\/detail\.1688\.com\/offer\/(\d+)\.html(?:[?#].*)?$/)?.[1]:null;
 if(!canonical(sourceUrl)||canonical(sourceUrl)!==canonical(incoming?.source_url))throw Error('规格导入来源与当前商品不一致');
 if(!Array.isArray(current)||!current.length||!Array.isArray(incoming?.skus)||incoming.skus.length!==current.length)throw Error('重新采集的 SKU 数量与当前商品不一致，请核对完整规格');
 const matrix=specificationMatrix(incoming);if(!matrix.structured)throw Error('采集文件不含独立规格维度，请使用新版采集助手重新采集');
 const rows=new Map();incoming.skus.forEach((sku,i)=>{if(typeof sku.sku!=='string'||!sku.sku||rows.has(sku.sku))throw Error('采集文件 SKU 编码缺失或重复');rows.set(sku.sku,matrix.rows[i]);});
 if(new Set(current.map(s=>s.sku)).size!==current.length||current.some(s=>!rows.has(s.sku)))throw Error('SKU 编码不一致，不能自动匹配规格');
 return {names:matrix.names,skus:current.map(s=>({...s,spec_values:[...rows.get(s.sku)],spec:rows.get(s.sku).join(' / ')}))};
}
