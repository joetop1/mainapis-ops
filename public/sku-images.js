import {canonicalSourceURL} from './source-url.js';
export function matchSkuImages(source,skus,product){
 const canonical=canonicalSourceURL;
 if(canonical(source)!==canonical(product?.source_url))throw Error('配图文件不是当前商品的来源');
 if(!Array.isArray(product.skus)||!product.skus.length)throw Error('配图文件缺少 SKU');
 const known=new Set(skus),seen=new Set(),updates=[];
 for(const row of product.skus){
  if(!known.has(row.sku)||seen.has(row.sku))throw Error('配图文件存在不匹配或重复的 SKU 编码，未修改任何图片');
  seen.add(row.sku);if(!row.image)continue;
  const u=new URL(row.image);if(u.protocol!=='https:'||u.username||u.password)throw Error('SKU 图片必须使用 HTTPS');
  updates.push({sku:row.sku,image:u.href});
 }
 if(!updates.length)throw Error('文件中没有可匹配的 SKU 图片');
 return updates;
}
