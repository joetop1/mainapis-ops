import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const files=['manifest.json','popup.html','popup.js','popup.css','collector.js','merchant-images.js','README.md'];
function crc32(bytes){let n=0xffffffff;for(const b of bytes){n^=b;for(let i=0;i<8;i++)n=(n>>>1)^((n&1)?0xedb88320:0);}return (n^0xffffffff)>>>0;}
// Standard ZIP with stored entries. Fixed allowlist excludes credentials and user data.
export async function createCollectorPackage(directory){
 const manifest=JSON.parse(await readFile(join(directory,'manifest.json'),'utf8'));
 if(!/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(manifest.version))throw Error('采集插件版本无效');
 const chunks=[],central=[];let offset=0;
 for(const name of files){
  const data=await readFile(join(directory,name));
  const entry=Buffer.from('mainapis-1688-collector/'+name),crc=crc32(data);
  const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(0x800,6);local.writeUInt16LE(33,12);local.writeUInt32LE(crc,14);local.writeUInt32LE(data.length,18);local.writeUInt32LE(data.length,22);local.writeUInt16LE(entry.length,26);
  const header=Buffer.alloc(46);header.writeUInt32LE(0x02014b50);header.writeUInt16LE(20,4);header.writeUInt16LE(20,6);header.writeUInt16LE(0x800,8);header.writeUInt16LE(33,14);header.writeUInt32LE(crc,16);header.writeUInt32LE(data.length,20);header.writeUInt32LE(data.length,24);header.writeUInt16LE(entry.length,28);header.writeUInt32LE(offset,42);
  chunks.push(local,entry,data);central.push(header,entry);offset+=local.length+entry.length+data.length;
 }
 const index=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);end.writeUInt32LE(index.length,12);end.writeUInt32LE(offset,16);
 const bytes=Buffer.concat([...chunks,index,end]);
 return {bytes,version:manifest.version,name:manifest.name,filename:'mainapis-1688-collector-'+manifest.version+'.zip',sha256:createHash('sha256').update(bytes).digest('hex')};
}
