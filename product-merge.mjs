import {createHash} from 'node:crypto';
import {validateProduct,decodeProduct,uid,now} from './core.mjs';
export function buildMergedProduct(products,input){
 if(!Array.isArray(products)||products.length<2||products.length>20)throw Error('请选择2至20条商品合并');
 const main=products.find(p=>p.id===input.main_id);if(!main)throw Error('请选择所选商品中的主商品');
 if(typeof input.title!=='string'||!input.title.trim()||input.title.trim().length>200)throw Error('合并商品标题须为1至200字');
 if(!Array.isArray(input.rows)||!input.rows.length||input.rows.length>500)throw Error('合并后须有1至500个SKU');
 if(!['main','all'].includes(input.images)||!['main','all'].includes(input.details))throw Error('请选择主图和详情图的保留方式');
 const expected=new Map(),leaf=new Set();
 for(const p of products){if(!p.skus?.length)throw Error('所选商品尚未录入SKU，请先补齐');for(const sku of p.skus){const key=JSON.stringify([p.id,sku.sku]);if(expected.has(key))throw Error('来源SKU重复');expected.set(key,{p,sku});}}
 if(input.rows.length!==expected.size)throw Error('合并须包含所选商品的全部SKU，请重新预览');
 const seen=new Set(),skus=input.rows.map(row=>{
  if(!row||typeof row!=='object'||Array.isArray(row))throw Error('合并SKU记录格式无效');
  const key=JSON.stringify([row.product_id,row.original_sku]),entry=expected.get(key);if(!entry||seen.has(key))throw Error('来源SKU不匹配或重复，请重新选择');seen.add(key);
  const {p,sku}=entry,source=sku.source||{url:p.source_url,sku:sku.sku,product_id:p.id,revision:p.revision,spec:sku.spec||''};
  const leafKey=JSON.stringify([source.url,source.sku]);if(leaf.has(leafKey))throw Error('所选记录包含重复的原始来源SKU，请去掉重复商品');leaf.add(leafKey);
  if(typeof row.sku!=='string'||!/^[A-Za-z0-9_.-]{1,64}$/.test(row.sku))throw Error('合并SKU编码须为1至64位英文、数字、点、横线或下划线');
  return {...sku,sku:row.sku,spec_values:[row.value],spec:row.value,image:sku.image||p.images?.[0]||'',source};
 });
 const ordered=[main,...products.filter(p=>p.id!==main.id)],gallery=(field,mode)=>[...new Set((mode==='main'?[main]:ordered).flatMap(p=>p[field]||[]))];
 const inputProduct={...main,title:input.title.trim(),spec_names:[input.dimension],skus,images:gallery('images',input.images),detail_images:gallery('detail_images',input.details),merge_sources:products.map(p=>({product_id:p.id,revision:p.revision,url:p.source_url})),description:main.description||''};
 const product=validateProduct(inputProduct);
 return {product,warnings:['标题、描述、产品参数、商城映射和虚拟销量继承主商品，请检查其是否适用于全部规格。','原商品、审核状态及历史商城商品均保留；合并商品为新的待整理记录，需要重新审核发布。',...(skus.some(s=>!s.image)?['部分SKU没有配图，请在编辑页补齐。']:[])]};
}
export function productMerge({db,collectors,audit,actor}){
 db.exec('CREATE TABLE IF NOT EXISTS product_merge_requests(owner TEXT NOT NULL,request_id TEXT NOT NULL,fingerprint TEXT NOT NULL,product_id TEXT NOT NULL REFERENCES products(id),PRIMARY KEY(owner,request_id),UNIQUE(owner,fingerprint));');
 const prepare=(owner,input)=>{
  if(!Array.isArray(input.products)||input.products.length<2||input.products.length>20||new Set(input.products.map(r=>r?.id)).size!==input.products.length)throw Error('请选择2至20条互不重复的商品');
  const products=input.products.map(ref=>{if(!ref||typeof ref.id!=='string'||!Number.isSafeInteger(ref.revision)||ref.revision<1)throw Error('来源商品或版本无效');const row=db.prepare('SELECT * FROM products WHERE owner=? AND id=?').get(owner,ref.id);if(!row)throw Error('来源商品不存在或不属于当前工作空间');if(row.revision!==ref.revision)throw Error('来源商品已更新，请重新选择并预览');return decodeProduct(row);});
  const built=buildMergedProduct(products,input);
  const published=products.filter(p=>db.prepare('SELECT 1 FROM jobs WHERE owner=? AND product_id=? LIMIT 1').get(owner,p.id));
  if(published.length)built.warnings.push('其中'+published.length+'条来源已有发布任务；本次仅合并OPS资料，不会合并或更新商城中的现有商品，后续发布可能形成另一款商品。');
  return {...built,products};
 };
 const create=(owner,input)=>{
  if(typeof input.request_id!=='string'||!/^[A-Za-z0-9_-]{16,100}$/.test(input.request_id))throw Error('缺少有效合并请求编号');
  // Replays must remain readable even if originals changed after the successful merge.
  const fingerprint=createHash('sha256').update(JSON.stringify({products:input.products,main_id:input.main_id,title:input.title,dimension:input.dimension,rows:input.rows,images:input.images,details:input.details})).digest('hex');
  const prior=db.prepare('SELECT * FROM product_merge_requests WHERE owner=? AND request_id=?').get(owner,input.request_id);if(prior){if(prior.fingerprint!==fingerprint)throw Error('合并请求已用于其他设置，请重新打开合并窗口');return {id:prior.product_id,reused:true};}
  const duplicate=db.prepare('SELECT * FROM product_merge_requests WHERE owner=? AND fingerprint=?').get(owner,fingerprint);if(duplicate)return {id:duplicate.product_id,reused:true};
  const {product}=prepare(owner,input),id=uid(),time=now();db.exec('BEGIN IMMEDIATE');
  try{
   for(const ref of input.products)if(db.prepare('SELECT revision FROM products WHERE owner=? AND id=?').get(owner,ref.id)?.revision!==ref.revision)throw Error('来源商品已更新，请重新预览');
   // Primary 1688 URL stays real. Internal uniqueness uses a new merge identity, not an invented upstream URL.
   db.prepare('INSERT INTO products(id,owner,source,data,created,updated) VALUES(?,?,?,?,?,?)').run(id,owner,'merge:'+id,JSON.stringify(product),time,time);
   const who=actor();collectors.record(id,who.sub,who.name);audit(owner,'product.create',id);audit(owner,'product.merge',id);
   db.prepare('INSERT INTO product_merge_requests VALUES(?,?,?,?)').run(owner,input.request_id,fingerprint,id);db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}
  return {id,reused:false};
 };
 return {preview:(owner,input)=>{const {product,warnings}=prepare(owner,input);return {product,warnings};},create};
}
