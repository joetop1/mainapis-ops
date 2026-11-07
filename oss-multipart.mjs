import {createHash,createHmac,randomUUID} from 'node:crypto';
import {mallDispatcher} from './mall-address.mjs';
import {storageDestination} from './image-storage.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex'),hmac=(k,v)=>createHmac('sha256',k).update(v).digest();
const enc=x=>encodeURIComponent(x).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
export const PART_BYTES=8*1024*1024,MAX_WORKBOOK_BYTES=500*1024*1024;
export function ossSignedURL(c,key,method,query={},headers={},date=new Date()){
 const stamp=date.toISOString().replace(/[-:]|\.\d{3}/g,''),day=stamp.slice(0,8),scope=day+'/'+c.region+'/oss/aliyun_v4_request';
 const q={...query,'x-oss-date':stamp,'x-oss-expires':'900','x-oss-signature-version':'OSS4-HMAC-SHA256','x-oss-credential':c.accessKeyId+'/'+scope};
 const canonicalQuery=Object.entries(q).map(([k,v])=>[enc(k),enc(String(v))]).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>k+'='+v).join('&');
 const canonicalHeaders=Object.entries(headers).sort(([a],[b])=>a<b?-1:1).map(([k,v])=>k.toLowerCase()+':'+v.trim()+'\n').join('');
 const request=method+'\n/'+c.bucket+'/'+key.split('/').map(enc).join('/')+'\n'+canonicalQuery+'\n'+canonicalHeaders+'\n\nUNSIGNED-PAYLOAD';
 const signing=hmac(hmac(hmac(hmac('aliyun_v4'+c.accessKeySecret,day),c.region),'oss'),'aliyun_v4_request');
 return 'https://'+c.bucket+'.oss-'+c.region+'.aliyuncs.com/'+key+'?'+canonicalQuery+'&x-oss-signature='+hmac(signing,'OSS4-HMAC-SHA256\n'+stamp+'\n'+scope+'\n'+hash(request)).toString('hex');
}
export async function ossRequest(c,key,method,query={},headers={},body,fetchImpl=fetch){
 const r=await fetchImpl(ossSignedURL(c,key,method,query,headers),{method,headers,body,dispatcher:mallDispatcher,redirect:'error',signal:AbortSignal.timeout(120000)});
 if(!r.ok){await r.body?.cancel();throw Error('OSS操作失败 HTTP '+r.status+'，请检查存储权限及跨域配置');}return r;
}
export function workbookUploads({db,getStorage,allowedStorage,enqueueRemote,fetchImpl=fetch}){
 db.exec("CREATE TABLE IF NOT EXISTS supplier_uploads(id TEXT PRIMARY KEY,owner TEXT NOT NULL,supplier TEXT NOT NULL,filename TEXT NOT NULL,size INTEGER NOT NULL,object_key TEXT NOT NULL,upload_id TEXT NOT NULL DEFAULT '',destination TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'uploading',batch_id TEXT NOT NULL DEFAULT '',created INTEGER NOT NULL)");
 const config=owner=>{const c=getStorage();if(!c?.enabled||!allowedStorage(owner,c))throw Error('请先配置共享OSS并授权当前商城域名');return c;};
 const load=(owner,id)=>{const r=db.prepare('SELECT * FROM supplier_uploads WHERE id=? AND owner=?').get(id,owner);if(!r)throw Error('上传记录不存在或不属于当前空间');const c=config(owner);if(storageDestination(c)!==r.destination)throw Error('OSS配置已变化，请恢复原配置');return {r,c};};
 const busy=new Set();
 return {
  async create(owner,input){
   const c=config(owner),supplier=String(input.supplier||'').trim(),filename=String(input.filename||'');const size=input.size;
   if(!supplier||supplier.length>100||filename.length>180||!filename.toLowerCase().endsWith('.xlsx')||!Number.isSafeInteger(size)||size<4||size>MAX_WORKBOOK_BYTES)throw Error('请选择不超过500MB的xlsx并填写供应商');
   if(db.prepare("SELECT COUNT(*) n FROM supplier_uploads WHERE owner=? AND state IN ('uploading','completing')").get(owner).n>=5)throw Error('最多保留5个未完成上传，请先取消旧上传');
   const id=randomUUID(),key='ops-private/workbooks/'+hash(owner).slice(0,16)+'/'+id+'.xlsx';
   db.prepare('INSERT INTO supplier_uploads(id,owner,supplier,filename,size,object_key,destination,created) VALUES(?,?,?,?,?,?,?,?)').run(id,owner,supplier,filename,size,key,storageDestination(c),Date.now());
   try{const response=await ossRequest(c,key,'POST',{uploads:''},{'x-oss-object-acl':'private'},undefined,fetchImpl),text=await response.text(),uploadId=text.match(/<UploadId>([^<]+)<\/UploadId>/)?.[1];if(!uploadId||!/^[A-Za-z0-9_-]{1,256}$/.test(uploadId))throw Error('OSS分片初始化响应无效');db.prepare('UPDATE supplier_uploads SET upload_id=? WHERE id=?').run(uploadId,id);return {id,partBytes:PART_BYTES,size};}catch(e){db.prepare("UPDATE supplier_uploads SET state='failed' WHERE id=?").run(id);throw e;}
  },
  sign(owner,id,part){const {r,c}=load(owner,id);if(r.state!=='uploading'||Date.now()-r.created>86400000||!Number.isSafeInteger(part)||part<1||part>Math.ceil(r.size/PART_BYTES))throw Error('上传已结束、过期或分片编号无效');const headers={'content-type':'application/octet-stream'};return {url:ossSignedURL(c,r.object_key,'PUT',{partNumber:String(part),uploadId:r.upload_id},headers),headers};},
  async complete(owner,id,input){
   const {r,c}=load(owner,id);if(r.batch_id)return {id:r.batch_id};if(busy.has(id))throw Error('正在确认上传，请稍后重试');if(!['uploading','completing'].includes(r.state))throw Error('上传状态无效');
   const count=Math.ceil(r.size/PART_BYTES);if(!Array.isArray(input.parts)||input.parts.length!==count||input.parts.some((p,i)=>p.number!==i+1||!/^"?[a-fA-F0-9]{32}"?$/.test(p.etag)))throw Error('分片列表不完整');
   busy.add(id);try{
    db.prepare("UPDATE supplier_uploads SET state='completing' WHERE id=?").run(id);
    // HEAD first makes retry after a lost completion response safe.
    let exists=false;try{const head=await ossRequest(c,r.object_key,'HEAD',{}, {},undefined,fetchImpl);exists=Number(head.headers.get('content-length'))===r.size;await head.body?.cancel();}catch{}
    if(!exists){const xml='<CompleteMultipartUpload>'+input.parts.map(p=>'<Part><PartNumber>'+p.number+'</PartNumber><ETag>'+p.etag.replaceAll('"','')+'</ETag></Part>').join('')+'</CompleteMultipartUpload>';const done=await ossRequest(c,r.object_key,'POST',{uploadId:r.upload_id},{'content-type':'application/xml'},xml,fetchImpl);const text=await done.text();if(/<Error[>\s]/.test(text))throw Error('OSS合并分片失败，请重试');}
    const head=await ossRequest(c,r.object_key,'HEAD',{}, {},undefined,fetchImpl);const size=Number(head.headers.get('content-length'));await head.body?.cancel();if(size!==r.size)throw Error('上传文件大小与原文件不符');
    const acl=await ossRequest(c,r.object_key,'GET',{acl:''},{},undefined,fetchImpl);if(!/<Grant>private<\/Grant>/.test(await acl.text()))throw Error('货盘文件未保持私有，停止解析');
    const batch=await enqueueRemote(owner,{uploadId:r.id,supplier:r.supplier,filename:r.filename,key:r.object_key,size:r.size,destination:r.destination});db.prepare("UPDATE supplier_uploads SET state='done',batch_id=? WHERE id=?").run(batch.id,id);return {id:batch.id};
   }finally{busy.delete(id);}
  },
  async cancel(owner,id){const {r,c}=load(owner,id);if(busy.has(id)||r.batch_id)throw Error('文件已进入解析或正在确认，不能取消上传');if(r.upload_id){try{const response=await ossRequest(c,r.object_key,'DELETE',{uploadId:r.upload_id},{},undefined,fetchImpl);await response.body?.cancel();}catch{throw Error('取消OSS分片失败，请检查权限后重试');}}db.prepare("UPDATE supplier_uploads SET state='cancelled' WHERE id=?").run(id);return {ok:true};}
 };
}
