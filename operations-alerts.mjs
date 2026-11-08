import {readFile,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {mallDispatcher} from './mall-address.mjs';
export async function operationsAlerts({dataDir,webhook,clock=()=>Date.now(),fetchImpl=fetch}){
 if(webhook){const u=new URL(webhook);if(u.origin!=='https://qyapi.weixin.qq.com'||u.pathname!=='/cgi-bin/webhook/send'||u.username||u.password||!u.searchParams.get('key')||u.hash)throw Error('运行告警仅支持企业微信群机器人HTTPS地址');}
 const path=join(dataDir,'operations-alerts.json');let saved={fingerprint:'',attempt:0,lastSuccess:null,error:''},active=false;try{saved={...saved,...JSON.parse(await readFile(path,'utf8'))};}catch{}
 async function persist(){await writeFile(path+'.tmp',JSON.stringify(saved),{mode:0o600});await rename(path+'.tmp',path);}
 return {status:()=>({enabled:!!webhook,lastSuccess:saved.lastSuccess,error:saved.error}),async check(s){
  if(!webhook||active)return;const issues=[];if(!s.health.ok)issues.push('服务就绪检查异常');if(s.health.freeBytes!==undefined&&s.health.freeBytes<2*1024**3)issues.push('数据盘剩余不足2GB');if(s.worker.enabled&&!s.worker.paused&&!s.worker.online&&s.uptime>180)issues.push('发布Worker心跳超时');if(s.backup.lastError)issues.push('本地备份失败');if(s.backup.remote?.enabled&&(s.backup.remote.lastError||!s.backup.remote.lastSuccess&&s.uptime>3600))issues.push('异地备份未成功');if(s.tasks.stalled)issues.push('存在超过30分钟未结束的发布任务');
  const fingerprint=issues.join('|');if(!fingerprint&&!saved.fingerprint)return;if(clock()-saved.attempt<3600000)return;active=true;saved.attempt=clock();
  try{await persist();const content=issues.length?'OPS运行告警\n'+issues.join('\n')+'\n请到系统设置查看；不会自动重新创建商品。':'OPS运行恢复\n此前监测到的异常已消失。';const r=await fetchImpl(webhook,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({msgtype:'text',text:{content}}),dispatcher:mallDispatcher,redirect:'error',signal:AbortSignal.timeout(10000)});if(!r.ok||(await r.json()).errcode!==0)throw Error('发送失败');saved.fingerprint=fingerprint;saved.lastSuccess=new Date(clock()).toISOString();saved.error='';}catch{saved.error='运行告警发送失败，请检查机器人配置及网络';}finally{await persist().catch(()=>{});active=false;}
 }};
}
