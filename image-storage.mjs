import {createHash,createHmac,randomUUID} from 'node:crypto';
import {mallOrigin,mallDispatcher} from './mall-address.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');
const hmac=(key,value)=>createHmac('sha256',key).update(value).digest();
const MAX=10*1024*1024;
export function storageConfig(input,previous={}){
 const bucket=String(input.bucket||'').trim(),region=String(input.region||'').trim();
 if(!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket))throw Error('Bucket 名称无效');
 if(!/^[a-z]{2}-[a-z0-9-]{2,40}$/.test(region))throw Error('地域请填写 cn-hangzhou 等地域 ID，不含 oss- 前缀');
 const publicOrigin=mallOrigin(input.publicOrigin),allowedOrigins=[...new Set((Array.isArray(input.allowedOrigins)?input.allowedOrigins:String(input.allowedOrigins||'').split(/\s+/)).filter(Boolean).map(mallOrigin))];
 if(!allowedOrigins.length||allowedOrigins.length>100)throw Error('请配置1至100个允许转存的商城 HTTPS 域名');
 const accessKeyId=String(input.accessKeyId||previous.accessKeyId||'').trim(),accessKeySecret=String(input.accessKeySecret||previous.accessKeySecret||'').trim();
 if(!/^[A-Za-z0-9]{10,128}$/.test(accessKeyId)||!/^[A-Za-z0-9+/=_-]{16,128}$/.test(accessKeySecret))throw Error('请填写有效的 OSS AccessKey ID 和 Secret');
 return {enabled:input.enabled===true,bucket,region,publicOrigin,allowedOrigins,accessKeyId,accessKeySecret};
}
export function publicStorage(c){return c?{enabled:c.enabled,bucket:c.bucket,region:c.region,publicOrigin:c.publicOrigin,allowedOrigins:c.allowedOrigins,credentialsSaved:true}:{enabled:false,allowedOrigins:[],credentialsSaved:false};}
export const storageDestination=c=>hash(JSON.stringify([c.bucket,c.region,c.publicOrigin]));
export function imageType(b){
 if(b.length>=24&&b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return {mime:'image/png',ext:'png'};
 if(b.length>3&&b[0]===255&&b[1]===216&&b[2]===255)return {mime:'image/jpeg',ext:'jpg'};
 if(b.length>=12&&b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WEBP')return {mime:'image/webp',ext:'webp'};
 if(b.length>=10&&['GIF87a','GIF89a'].includes(b.toString('ascii',0,6)))return {mime:'image/gif',ext:'gif'};
 throw Error('图片内容不是支持的 PNG、JPEG、WebP 或 GIF');
}
function imageURL(value){const u=new URL(value);mallOrigin(u.origin);if(u.hash||u.username||u.password)throw Error('图片地址无效');return u.href;}
export async function readImage(url,{fetchImpl=fetch,signal=AbortSignal.timeout(30000),referer}={}){
 let current=imageURL(url);
 for(let i=0;i<4;i++){
  const r=await fetchImpl(current,{dispatcher:mallDispatcher,redirect:'manual',signal,headers:referer?{Referer:referer+'/'}:{}});
  if([301,302,303,307,308].includes(r.status)){await r.body?.cancel();const next=r.headers.get('location');if(!next)throw Error('图片重定向无效');current=imageURL(new URL(next,current).href);continue;}
  if(!r.ok){await r.body?.cancel();throw Error('图片读取失败 HTTP '+r.status);}
  if(Number(r.headers.get('content-length'))>MAX){await r.body?.cancel();throw Error('单张图片不能超过10MB');}
  const reader=r.body.getReader(),chunks=[];let size=0;
  try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>MAX)throw Error('单张图片不能超过10MB');chunks.push(value);}}catch(e){await reader.cancel();throw e;}
  const bytes=Buffer.concat(chunks);return {bytes,...imageType(bytes)};
 }
 throw Error('图片重定向次数过多');
}
// OSS V4, no query parameters or user controlled endpoints. Sign only the fixed OSS service host.
export function ossHeaders(c,key,mime,bytes,date=new Date()){
 const stamp=date.toISOString().replace(/[-:]|\.\d{3}/g,''),day=stamp.slice(0,8),scope=day+'/'+c.region+'/oss/aliyun_v4_request';
 const headers={'content-type':mime,'content-md5':createHash('md5').update(bytes).digest('base64'),'x-oss-content-sha256':'UNSIGNED-PAYLOAD','x-oss-date':stamp};
 const canonical=Object.keys(headers).sort().map(k=>k+':'+headers[k]+'\n').join('');
 const request='PUT\n/'+c.bucket+'/'+key+'\n\n'+canonical+'\n\nUNSIGNED-PAYLOAD';
 const signing=hmac(hmac(hmac(hmac('aliyun_v4'+c.accessKeySecret,day),c.region),'oss'),'aliyun_v4_request');
 headers.authorization='OSS4-HMAC-SHA256 Credential='+c.accessKeyId+'/'+scope+',Signature='+hmac(signing,'OSS4-HMAC-SHA256\n'+stamp+'\n'+scope+'\n'+hash(request)).toString('hex');
 return headers;
}
export async function uploadImage(c,key,image,{fetchImpl=fetch}={}){
 const r=await fetchImpl('https://'+c.bucket+'.oss-'+c.region+'.aliyuncs.com/'+key,{method:'PUT',dispatcher:mallDispatcher,redirect:'error',headers:ossHeaders(c,key,image.mime,image.bytes),body:image.bytes,signal:AbortSignal.timeout(60000)});
 await r.body?.cancel();if(!r.ok)throw Error('OSS 上传失败 HTTP '+r.status+'，请检查地域、权限和存储配置');
 const url=c.publicOrigin+'/'+key;
 const read=await readImage(url,{fetchImpl});if(hash(read.bytes)!==hash(image.bytes))throw Error('图片域名返回内容与上传文件不一致，请检查域名、公开读取和防盗链设置');
 return url;
}
export function imageStorage({db,store,fetchImpl=fetch}){
 db.exec(`CREATE TABLE IF NOT EXISTS image_transfer_jobs(job_id TEXT PRIMARY KEY,destination TEXT NOT NULL,mall_origin TEXT NOT NULL,original TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'pending');CREATE TABLE IF NOT EXISTS image_transfer_files(job_id TEXT NOT NULL,source TEXT NOT NULL,url TEXT NOT NULL,bytes INTEGER NOT NULL,PRIMARY KEY(job_id,source));`);
 const active=new Set();let running=0;const waiters=[];
 const get=()=>store.get('global');
 function requireAllowed(origin){const c=get();if(!c?.enabled||!c.allowedOrigins.includes(mallOrigin(origin)))throw Error('OPS 图片存储未启用，或该商城域名不在允许列表');return c;}
 return {
  get,view:()=>publicStorage(get()),save(input){const c=storageConfig(input,get()||{});store.set('global',c);return publicStorage(c);},
  available(origin){try{requireAllowed(origin);return true;}catch{return false;}},
  prepare(origin){return {destination:storageDestination(requireAllowed(origin)),origin:mallOrigin(origin)};},
  record(id,p,plan){db.prepare('INSERT INTO image_transfer_jobs(job_id,destination,mall_origin,original) VALUES(?,?,?,?)').run(id,plan.destination,plan.origin,JSON.stringify(p));},
  async test(input){const c=storageConfig(input,get()||{}),bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhWQAAAAASUVORK5CYII=','base64');await uploadImage(c,'ops/probes/'+randomUUID()+'.png',{bytes,mime:'image/png'},{fetchImpl});return {ok:true,message:'上传及公开读取核对通过；已写入一张测试图片，配置尚需点击保存'};},
  async transfer(job){
   const row=db.prepare('SELECT * FROM image_transfer_jobs WHERE job_id=?').get(job.id);if(!row)return null;
   if(active.has(job.id))throw Error('图片正在转存，请等待当前任务完成');active.add(job.id);
   if(running>=2)await new Promise(resolve=>waiters.push(resolve));else running++;
   try{
    const c=requireAllowed(row.mall_origin);if(storageDestination(c)!==row.destination)throw Error('存储目标已变化，请恢复原 Bucket、地域和图片域名后重试原任务');
    if(row.state==='done')return JSON.parse(db.prepare('SELECT product FROM job_snapshots WHERE job_id=?').get(job.id).product);
    const snap=db.prepare('SELECT claimed FROM job_snapshots WHERE job_id=?').get(job.id);if(snap?.claimed)throw Error('任务已领取，不能改写图片');
    const p=JSON.parse(row.original),urls=[...new Set([...p.images,...(p.detail_images||[]),...p.skus.map(s=>s.image).filter(Boolean)])];
    if(urls.length>300)throw Error('转存最多支持300张不同图片，请整理后发布');let total=0;const map=new Map();
    for(const [i,source]of urls.entries()){
     const existing=db.prepare('SELECT * FROM image_transfer_files WHERE job_id=? AND source=?').get(job.id,source);
     if(existing){total+=existing.bytes;if(total>200*1024*1024)throw Error('单任务图片总大小不能超过200MB');map.set(source,existing.url);continue;}
     db.prepare("UPDATE jobs SET message=?,updated=? WHERE id=? AND status='dispatching'").run('正在转存图片 '+(i+1)+'/'+urls.length,new Date().toISOString(),job.id);
     const image=await readImage(source,{fetchImpl});total+=image.bytes.length;if(total>200*1024*1024)throw Error('单任务图片总大小不能超过200MB');
     const key='ops/'+hash(job.owner).slice(0,24)+'/'+hash(job.mall_connection_id).slice(0,24)+'/'+job.id+'/'+hash(image.bytes)+'.'+image.ext;
     const url=await uploadImage(c,key,image,{fetchImpl});db.prepare('INSERT INTO image_transfer_files VALUES(?,?,?,?)').run(job.id,source,url,image.bytes.length);map.set(source,url);
    }
    const transferred={...p,images:p.images.map(x=>map.get(x)),detail_images:(p.detail_images||[]).map(x=>map.get(x)),skus:p.skus.map(s=>({...s,...(s.image?{image:map.get(s.image)}:{})}))};
    if(storageDestination(requireAllowed(row.mall_origin))!==row.destination)throw Error('存储目标在转存中发生变化，未替换任务图片');
    db.exec('BEGIN IMMEDIATE');try{const result=db.prepare('UPDATE job_snapshots SET product=? WHERE job_id=? AND claimed=0').run(JSON.stringify(transferred),job.id);if(!result.changes)throw Error('任务状态已变化，未替换图片');db.prepare("UPDATE image_transfer_jobs SET state='done' WHERE job_id=?").run(job.id);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
    return transferred;
   }finally{active.delete(job.id);const next=waiters.shift();if(next)next();else running--;}
  }
 };
}
