import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
const files=['Bridge.php','MainapisOpsController.php','Compatibility.php','reviewed-sources.json','entry.php','config.php','install.php','apply-update.php','INSTALL.md'];
// Fixed allowlist; never packages runtime config, credentials or database files.
export async function createYunzhongPackage(directory){
 const source=await readFile(join(directory,'Bridge.php'),'utf8');
 const version=source.match(/'bridgeVersion'=>'(\d+\.\d+\.\d+)'/)?.[1];
 if(!version)throw Error('芸众扩展版本无效');
 const chunks=[];
 for(const name of files){
  const data=await readFile(join(directory,name)),header=Buffer.alloc(512);
  header.write(name);const oct=(value,start,length)=>header.write(value.toString(8).padStart(length-1,'0')+'\0',start,length);
  oct(0o644,100,8);oct(0,108,8);oct(0,116,8);oct(data.length,124,12);oct(0,136,12);
  header.fill(32,148,156);header.write('0',156);header.write('ustar\0',257);header.write('00',263);
  const checksum=header.reduce((sum,b)=>sum+b,0);header.write(checksum.toString(8).padStart(6,'0')+'\0 ',148,8);
  chunks.push(header,data,Buffer.alloc((512-data.length%512)%512));
 }
 const bytes=gzipSync(Buffer.concat([...chunks,Buffer.alloc(1024)]));
 return {version,bytes,filename:`mainapis-yunzhong-bridge-${version}.tar.gz`,sha256:createHash('sha256').update(bytes).digest('hex')};
}
