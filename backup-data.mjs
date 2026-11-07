import {DatabaseSync} from 'node:sqlite';
import {mkdir,mkdtemp,readFile,writeFile,chmod,stat,statfs,readdir,rm} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const names=['ops.sqlite','connections.key'];
async function digest(path){const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);return hash.digest('hex');}
export async function verifyBackup(directory){
 const manifest=JSON.parse(await readFile(join(directory,'manifest.json'),'utf8'));
 if(manifest.application!=='mainapis-ops-backup'||manifest.version!==1||!Number.isFinite(Date.parse(manifest.createdAt)))throw Error('备份清单无效');
 for(const name of names){const file=await stat(join(directory,name));if(!file.isFile()||await digest(join(directory,name))!==manifest.files?.[name])throw Error('备份文件校验失败');}
 if((await stat(join(directory,'connections.key'))).size!==32)throw Error('备份连接密钥长度错误');
 const db=new DatabaseSync(join(directory,'ops.sqlite'),{readOnly:true});try{if(Object.values(db.prepare('PRAGMA quick_check').get())[0]!=='ok')throw Error('备份数据库完整性校验失败');}finally{db.close();}
 return manifest;
}
export async function backupData(dataDir,{keep=14,now=new Date()}={}){
 if(!Number.isSafeInteger(keep)||keep<1||keep>90)throw Error('备份保留数量无效');
 const key=await readFile(join(dataDir,'connections.key'));if(key.length!==32)throw Error('连接密钥无效，未生成备份');
 const size=(await stat(join(dataDir,'ops.sqlite'))).size+(await stat(join(dataDir,'ops.sqlite-wal')).catch(()=>({size:0}))).size,fs=await statfs(dataDir);if(fs.bavail*fs.bsize<size*2+200*1024*1024)throw Error('可用空间不足，未生成备份');
 const parent=join(dataDir,'backups');await mkdir(parent,{recursive:true,mode:0o700});await chmod(parent,0o700);
 const directory=await mkdtemp(join(parent,'backup-'+now.toISOString().replace(/[-:.]/g,'')+'-'));let db;
 try{
  db=new DatabaseSync(join(dataDir,'ops.sqlite'),{readOnly:true});db.exec('PRAGMA busy_timeout=5000');db.prepare('VACUUM INTO ?').run(join(directory,'ops.sqlite'));db.close();db=null;
  await chmod(join(directory,'ops.sqlite'),0o600);await writeFile(join(directory,'connections.key'),key,{flag:'wx',mode:0o600});
  if(!(await readFile(join(dataDir,'connections.key'))).equals(key))throw Error('连接密钥已变化，未提交备份');
  const files=Object.fromEntries(await Promise.all(names.map(async name=>[name,await digest(join(directory,name))])));
  await writeFile(join(directory,'manifest.json'),JSON.stringify({application:'mainapis-ops-backup',version:1,createdAt:now.toISOString(),files}),{flag:'wx',mode:0o600});await verifyBackup(directory);
 }catch(e){db?.close();await rm(directory,{recursive:true,force:true});throw e;}
 // Only retire verified snapshots produced by this module. Unrelated folders stay intact.
 const candidates=[];for(const entry of await readdir(parent,{withFileTypes:true})){if(!entry.isDirectory()||!/^backup-\d{8}T\d{9}Z-[A-Za-z0-9]+$/.test(entry.name))continue;try{const path=join(parent,entry.name),m=JSON.parse(await readFile(join(path,'manifest.json'),'utf8'));if(m.application==='mainapis-ops-backup'&&m.version===1)candidates.push({path,time:Date.parse(m.createdAt)});}catch{}}
 candidates.sort((a,b)=>b.time-a.time||b.path.localeCompare(a.path));for(const item of candidates.slice(keep)){if(item.path===directory)continue;try{await verifyBackup(item.path);await rm(item.path,{recursive:true});}catch{}}
 return {createdAt:now.toISOString(),name:directory.split('/').at(-1),bytes:(await stat(join(directory,'ops.sqlite'))).size};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const result=process.argv[2]==='--verify'?await verifyBackup(resolve(process.argv[3])):await backupData(resolve(process.argv[2]),{keep:Number(process.env.OPS_BACKUP_KEEP||14)});console.log(JSON.stringify(result));}catch(e){console.error(e.message);process.exitCode=1;}
}
