export function setupOperations({$,api,isAdmin}){
 let timer=null,generation=0;
 async function load(){if(!isAdmin())return;const request=++generation;try{
  const s=await api('/api/operations');if(request!==generation)return;
  $('#operationsHealth').textContent=s.health.ok?'服务正常':'需检查：'+({database_unavailable:'数据库不可读取',connection_key_invalid:'连接解密密钥异常',disk_low:'数据盘剩余空间不足',storage_unavailable:'数据目录不可读写'}[s.health.reason]||'服务状态异常');
  $('#operationsDisk').textContent=s.health.freeBytes===undefined?'无法读取':(s.health.freeBytes/1024**3).toFixed(2)+' GB';
  $('#operationsTasks').textContent='超30分钟未结束 '+s.tasks.stalled+' 条；需人工核对 '+s.tasks.review+' 条（不会自动重新创建）';
  $('#operationsBackup').textContent=(s.backup.running?'正在备份…；':'')+'最近成功：'+(s.backup.lastSuccess?new Date(s.backup.lastSuccess).toLocaleString('zh-CN'):'尚无')+'；'+(s.backup.enabled?'每'+s.backup.intervalHours+'小时自动备份':'自动备份未启用')+'，保留最近'+s.backup.keep+'份';
  $('#operationsStatus').textContent=s.backup.lastError||'仅备份OPS数据库和连接解密密钥；OSS图片、部署环境配置及未完成的货盘预览需另行保管。';
  $('#operationsBackupNow').disabled=s.backup.running;clearTimeout(timer);if(s.backup.running)timer=setTimeout(load,2000);
 }catch(e){$('#operationsStatus').textContent='读取运行状态失败：'+e.message;}}
 $('#operationsRefresh').onclick=load;
 $('#operationsBackupNow').onclick=async()=>{const b=$('#operationsBackupNow');b.disabled=true;try{const r=await api('/api/operations/backup','POST',{});$('#operationsStatus').textContent=r.started?'已开始生成一致性备份。':'备份正在进行，请稍候。';await load();}catch(e){$('#operationsStatus').textContent=e.message;b.disabled=false;}};
 return {load};
}
