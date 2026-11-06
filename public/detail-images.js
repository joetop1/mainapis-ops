import {canonicalSourceURL} from './source-url.js';
const source=canonicalSourceURL;
export function detailImagesFromJSON(currentSource,data){
 if(!Array.isArray(data?.products)||data.products.length!==1)throw Error('请选择只包含当前商品的采集 JSON');
 const p=data.products[0];if(source(currentSource)!==source(p.source_url))throw Error('采集文件与当前商品来源不一致，未修改详情');
 return validateDetailImages(p.detail_images);
}
export function validateDetailImages(images){
 if(!Array.isArray(images)||images.length<1||images.length>100)throw Error('请提供 1–100 张真实详情图');
 return images.map(value=>{const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password)throw Error('详情图必须使用无账号密码的 HTTPS 地址');return u.href;});
}
export function detailHTML(text,images){
 const urls=validateDetailImages(images);
 const escape=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 return (text?'<p>'+escape(text).replace(/\n/g,'<br>')+'</p>':'')+urls.map(url=>'<p><img src="'+escape(url)+'" alt=""></p>').join('');
}
