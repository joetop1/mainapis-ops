import {queueStatus} from './task-queue.mjs';
import {stat,statfs,access,readFile,writeFile,rename} from 'node:fs/promises';
import {constants} from 'node:fs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {join} from 'node:path';
const execute=promisify(execFile);
export function inspectTasks(db,now=Date.now()){
 return {...db.prepare(`SELECT COALESCE(SUM(status IN ('dispatching','accepted','verifying') AND updated<?),0) stalled,
 COALESCE(SUM(status IN ('unknown','awaiting_review')),0) review FROM jobs`).get(new Date(now-30*60000).toISOString())};
}
export async function readiness(db,dataDir){
 try{db.prepare('SELECT 1 FROM products LIMIT 1').get();}catch{return {ok:false,reason:'database_unavailable'};}
 try{await access(dataDir,constants.W_OK);if((await stat(join(dataDir,'connections.key'))).size!==32)return {ok:false,reason:'connection_key_invalid'};const fs=await statfs(dataDir),freeBytes=fs.bavail*fs.bsize,totalBytes=fs.blocks*fs.bsize;return {ok:freeBytes>=200*1024*1024,reason:freeBytes>=200*1024*1024?'ready':'disk_low',freeBytes,totalBytes};}catch{return {ok:false,reason:'storage_unavailable'};}
}
export async function operations({db,dataDir,root,enabled=true,intervalHours=24,keep=14,workerEnabled=false,workerPaused=false,runBackup,runOffsite,alertService,clock=()=>Date.now()}){
 if(!Number.isFinite(intervalHours)||intervalHours<1||intervalHours>168||!Number.isSafeInteger(keep)||keep<1||keep>90)throw Error('备份周期或保留数量无效');
 const path=join(dataDir,'backup-status.json');let saved={lastSuccess:null,lastAttempt:null,lastError:'',remote:{lastSuccess:null,lastError:'',object:''}},current=null,stopped=false;
 try{const old=JSON.parse(await readFile(path,'utf8'));saved={lastSuccess:old.lastSuccess||null,lastAttempt:old.lastAttempt||null,lastError:String(old.lastError||'').slice(0,300),remote:{lastSuccess:old.remote?.lastSuccess||null,lastError:old.remote?.lastError||'',object:old.remote?.object||''}};}catch{}
 const persist=async()=>{const tmp=path+'.tmp';await writeFile(tmp,JSON.stringify(saved),{mode:0o600});await rename(tmp,path);};
 const start=()=>{
  if(current||stopped)return false;
  saved.lastAttempt=new Date(clock()).toISOString();saved.lastError='';
  current=(async()=>{try{const result=runBackup?await runBackup():JSON.parse((await execute(process.execPath,[join(root,'backup-data.mjs'),dataDir],{timeout:300000,maxBuffer:65536,env:{...process.env,OPS_BACKUP_KEEP:String(keep)}})).stdout);saved.lastSuccess=result.createdAt;await persist();if(runOffsite){try{const remote=await runOffsite(result);saved.remote={lastSuccess:remote.createdAt,lastError:'',object:remote.object};}catch{saved.remote.lastError='加密异地备份失败，请检查独立加密密钥、OSS权限及网络';}await persist();}}catch{saved.lastError='备份失败，请检查磁盘、数据库可读性及备份目录权限';await persist().catch(()=>{});}finally{current=null;}})();return true;
 };
 async function status(){return {worker:{...queueStatus(db,workerEnabled,{clock}),paused:workerPaused},health:await readiness(db,dataDir),uptime:Math.floor(process.uptime()),tasks:inspectTasks(db,clock()),alerts:alertService?.status()||{enabled:false,lastSuccess:null,error:''},backup:{...saved,remote:{...saved.remote,enabled:!!runOffsite},running:!!current,enabled,intervalHours,keep}};}
 const tick=()=>{const time=clock();if(enabled&&(time-Date.parse(saved.lastSuccess||'1970-01-01')>=intervalHours*3600000||runOffsite&&saved.remote.lastError)&&time-Date.parse(saved.lastAttempt||'1970-01-01')>=3600000)start();if(alertService&&!stopped)status().then(s=>alertService.check(s)).catch(()=>{});};
 return {start,tick,stop(){stopped=true;},settled:()=>current||Promise.resolve(),status};
}
