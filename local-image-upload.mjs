import {createHash} from 'node:crypto';
import {imageType,uploadImage,storageDestination} from './image-storage.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
export function localImageUploader({getStorage,allowedStorage,fetchImpl=fetch}){
 let active=0;
 return async(owner,input)=>{
  const c=getStorage();if(!c?.enabled||!allowedStorage(owner,c))throw Error('请先启用OPS共享图片存储，并授权当前空间的商城域名');
  if(typeof input?.data!=='string'||input.data.length>14*1024*1024||!/^[A-Za-z0-9+/]+={0,2}$/.test(input.data))throw Error('图片数据无效，单张最大10MB');
  const bytes=Buffer.from(input.data,'base64');if(!bytes.length||bytes.length>10*1024*1024)throw Error('单张图片最大10MB');const type=imageType(bytes);
  if(active>=2)throw Error('图片上传繁忙，请稍后重试');active++;
  try{const key='ops/'+hash(owner).slice(0,24)+'/local/'+hash(bytes)+'.'+type.ext,url=await uploadImage(c,key,{bytes,...type},{fetchImpl});const latest=getStorage();if(!latest?.enabled||!allowedStorage(owner,latest)||storageDestination(latest)!==storageDestination(c))throw Error('存储配置已变化，图片未加入商品，请重新上传');return {url,bytes:bytes.length,mime:type.mime};}
  finally{active--;}
 };
}
