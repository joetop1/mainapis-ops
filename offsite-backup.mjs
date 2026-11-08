import {createCipheriv,createDecipheriv,randomBytes,createHash} from 'node:crypto';
import {createReadStream,createWriteStream} from 'node:fs';
import {readFile,writeFile,appendFile,stat,rm,mkdir} from 'node:fs/promises';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {createGzip,gunzipSync} from 'node:zlib';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyBackup} from './backup-data.mjs';
import {ossSignedURL,ossRequest} from './oss-multipart.mjs';
import {mallDispatcher} from './mall-address.mjs';
const MAGIC=Buffer.from('OPSBAK1\n'),names=['ops.sqlite','connections.key','manifest.json'],MAX=256*1024*1024;
export function offsiteKey(value){const key=Buffer.from(String(value||''),'base64');if(key.length!==32||key.toString('base64')!==value)throw Error('异地备份需要独立的32字节Base64加密密钥');return key;}
async function digest(file){const h=createHash('sha256');for await(const b of createReadStream(file))h.update(b);return h.digest('hex');}
export async function sealBackup(directory,destination,keyText){
 await verifyBackup(directory);const key=offsiteKey(keyText),iv=randomBytes(12),files=[];for(const name of names)files.push({name,size:(await stat(join(directory,name))).size});if(files.reduce((n,f)=>n+f.size,0)>MAX)throw Error('备份超过当前256MB归档上限');
 const metadata=Buffer.from(JSON.stringify(files)),length=Buffer.alloc(4);length.writeUInt32BE(metadata.length);
 async function* chunks(){yield length;yield metadata;for(const f of files)for await(const chunk of createReadStream(join(directory,f.name)))yield chunk;}
 const cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(MAGIC);let created=false;
 try{await writeFile(destination,Buffer.concat([MAGIC,iv]),{flag:'wx',mode:0o600});created=true;await pipeline(Readable.from(chunks()),createGzip(),cipher,createWriteStream(destination,{flags:'a',mode:0o600}));await appendFile(destination,cipher.getAuthTag());return {bytes:(await stat(destination)).size,sha256:await digest(destination)};}catch(e){if(created)await rm(destination,{force:true});throw e;}
}
export async function unsealBackup(file,destination,keyText){
 if((await stat(file)).size>MAX+1024*1024)throw Error('加密备份文件过大');const bytes=await readFile(file);if(bytes.length<36||!bytes.subarray(0,8).equals(MAGIC))throw Error('备份格式无效');
 const cipher=createDecipheriv('aes-256-gcm',offsiteKey(keyText),bytes.subarray(8,20));cipher.setAAD(MAGIC);cipher.setAuthTag(bytes.subarray(-16));let archive;try{archive=gunzipSync(Buffer.concat([cipher.update(bytes.subarray(20,-16)),cipher.final()]),{maxOutputLength:MAX+65536});}catch{throw Error('备份解密或完整性校验失败，未恢复文件');}
 const length=archive.readUInt32BE(0);if(length>4096||length+4>archive.length)throw Error('归档清单无效');const files=JSON.parse(archive.subarray(4,4+length));if(!Array.isArray(files)||files.length!==3||files.some((f,i)=>f.name!==names[i]||!Number.isSafeInteger(f.size)||f.size<0)||files.reduce((n,f)=>n+f.size,4+length)!==archive.length)throw Error('归档文件范围无效');
 await mkdir(destination,{mode:0o700});try{let offset=4+length;for(const f of files){await writeFile(join(destination,f.name),archive.subarray(offset,offset+f.size),{flag:'wx',mode:0o600});offset+=f.size;}return await verifyBackup(destination);}catch(e){await rm(destination,{recursive:true,force:true});throw e;}
}
export function offsiteBackups({getStorage,dataDir,key,fetchImpl=fetch}){
 return async result=>{
  if(!/^backup-\d{8}T\d{9}Z-[A-Za-z0-9]+$/.test(result.name||''))throw Error('备份目录名无效');const c=getStorage();if(!c?.enabled)throw Error('请先配置并启用OSS存储');
  const directory=join(dataDir,'backups',result.name),file=join(directory,'offsite-'+randomBytes(8).toString('hex')+'.opsenc'),object='ops-private/backups/'+result.name+'.opsenc';
  try{const sealed=await sealBackup(directory,file,key),headers={'content-type':'application/octet-stream','x-oss-object-acl':'private'};
   const response=await fetchImpl(ossSignedURL(c,object,'PUT',{},headers),{method:'PUT',headers:{...headers,'content-length':String(sealed.bytes)},body:createReadStream(file),duplex:'half',dispatcher:mallDispatcher,redirect:'error',signal:AbortSignal.timeout(120000)});await response.body?.cancel();if(!response.ok)throw Error('OSS加密备份上传失败');
   const acl=await ossRequest(c,object,'GET',{acl:''},{},undefined,fetchImpl);if(!/<Grant>\s*private\s*<\/Grant>/.test(await acl.text()))throw Error('OSS备份私有权限核对失败');
   const read=await ossRequest(c,object,'GET',{}, {},undefined,fetchImpl),h=createHash('sha256');let size=0;for await(const b of read.body){size+=b.length;if(size>sealed.bytes)throw Error('OSS备份读回大小异常');h.update(b);}if(size!==sealed.bytes||h.digest('hex')!==sealed.sha256)throw Error('OSS备份读回校验失败');return {createdAt:new Date().toISOString(),object,bytes:sealed.bytes,sha256:sealed.sha256};
  }finally{await rm(file,{force:true});}
 };
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{if(process.argv[2]!=='--decrypt'||!process.argv[3]||!process.argv[4])throw Error('用法：node offsite-backup.mjs --decrypt 加密文件 新目录');const result=await unsealBackup(resolve(process.argv[3]),resolve(process.argv[4]),process.env.OPS_OFFSITE_ENCRYPTION_KEY);console.log(JSON.stringify({ok:true,createdAt:result.createdAt,message:'已解密并验证到新目录，未修改运行数据库；恢复前先暂停Worker'}));}catch(e){console.error(e.message);process.exitCode=1;}
}
