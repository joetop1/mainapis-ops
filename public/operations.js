export function operationsPresentation(s){
 const health=s.health||{},worker=s.worker||{},backup=s.backup||{},tasks=s.tasks||{},remote=backup.remote||{},alerts=s.alerts||{};
 const known=Number.isFinite(health.freeBytes)&&health.freeBytes>=0,totalKnown=Number.isFinite(health.totalBytes)&&health.totalBytes>0;
 const diskPercent=known&&totalKnown?Math.min(100,Math.max(0,health.freeBytes/health.totalBytes*100)):null;
 const workerState=!worker.enabled?'muted':worker.paused?'muted':worker.online?'good':'warn';
 const workerText=!worker.enabled?'单进程模式':worker.paused?'已暂停':worker.online?'在线':'等待连接';
 const localState=backup.running?'busy':backup.lastError?'error':backup.lastSuccess?'good':backup.enabled?'warn':'muted';
 const remoteState=!remote.enabled?'muted':remote.lastError?'error':remote.lastSuccess?'good':backup.running?'busy':'warn';
 const review=tasks.review||0,stalled=tasks.stalled||0,attention=localState==='error'||remoteState==='error'||alerts.error||known&&health.freeBytes<2*1024**3;
 return {diskPercent,diskState:!known?'muted':health.freeBytes<200*1024**2?'error':health.freeBytes<2*1024**3?'warn':'good',workerState,workerText,localState,remoteState,alertState:!alerts.enabled?'muted':alerts.error?'error':'good',summaryState:!health.ok?'error':workerState==='warn'||review||stalled||attention?'warn':'good',summary:!health.ok?'服务状态需检查':workerState==='warn'?'网页正常 · Worker待连接':review||stalled?'服务正常 · 有任务待处理':attention?'服务正常 · 有运行项待检查':worker.paused?'服务正常 · 发布已暂停':'当前服务正常'};
}
export function setupOperations({$,api,isAdmin,isVisible=()=>!$('#systemSettings').classList.contains('hidden')}){
 let timer=null,generation=0;
 const tone=(selector,state)=>{$(selector).dataset.state=state;};
 const date=value=>value?new Date(value).toLocaleString('zh-CN'):'尚无成功记录';
 async function load(){if(!isAdmin())return;clearTimeout(timer);const request=++generation;$('#operationsRefresh').disabled=true;try{
  const s=await api('/api/operations');if(request!==generation)return;const view=operationsPresentation(s),health=s.health,worker=s.worker||{},backup=s.backup,remote=backup.remote||{},alerts=s.alerts||{};
  $('#operationsSummary').textContent=view.summary;tone('#operationsSummary',view.summaryState);$('#operationsUpdated').textContent='更新于 '+new Date().toLocaleTimeString('zh-CN');
  $('#operationsHealth').textContent=health.ok?'正常':'需检查';tone('#operationsServiceTile',health.ok?'good':'error');
  const uptime=s.uptime||0;$('#operationsUptime').textContent=health.ok?'已运行 '+(uptime>=3600?Math.floor(uptime/3600)+'小时 '+Math.floor(uptime%3600/60)+'分钟':Math.floor(uptime/60)+'分钟'):({database_unavailable:'数据库不可读取',connection_key_invalid:'连接解密密钥异常',disk_low:'数据盘剩余空间不足',storage_unavailable:'数据目录不可读写'}[health.reason]||'请检查服务状态');
  $('#operationsWorker').textContent=view.workerText;tone('#operationsWorkerTile',view.workerState);for(const [field,key]of [['Queued','queued'],['Running','running'],['Interrupted','interrupted']])$('#operations'+field).textContent=worker[key]??0;
  $('#operationsDisk').textContent=!Number.isFinite(health.freeBytes)?'无法读取':(health.freeBytes/1024**3).toFixed(2)+' GB';tone('#operationsDiskTile',view.diskState);
  const meter=$('#operationsDiskMeter');meter.hidden=view.diskPercent===null;if(view.diskPercent!==null){meter.value=view.diskPercent;meter.setAttribute('aria-valuetext','可用空间占比 '+view.diskPercent.toFixed(1)+'%');}
  $('#operationsDiskDetail').textContent=view.diskPercent===null?'未取得完整容量信息':'总容量 '+(health.totalBytes/1024**3).toFixed(1)+' GB · 可用 '+view.diskPercent.toFixed(1)+'%';
  $('#operationsTasks').textContent=s.tasks.review+' 项待核对';tone('#operationsTaskTile',s.tasks.review||s.tasks.stalled?'warn':'good');$('#operationsTaskDetail').textContent='超30分钟未结束 '+s.tasks.stalled+' 项；不会自动重建';
  tone('#operationsLocalNode',view.localState);tone('#operationsLocalState',view.localState);$('#operationsLocalState').textContent=backup.running?'备份中':backup.lastError?'备份失败':backup.lastSuccess?'已备份':backup.enabled?'等待首次备份':'未启用';$('#operationsBackup').textContent='最近成功：'+date(backup.lastSuccess)+'；'+(backup.enabled?'每'+backup.intervalHours+'小时自动备份':'自动备份关闭')+'，保留'+backup.keep+'份';
  tone('#operationsRemoteNode',view.remoteState);tone('#operationsRemoteState',view.remoteState);$('#operationsRemoteState').textContent=!remote.enabled?'未启用':remote.lastError?'上传失败':remote.lastSuccess?'已核验':backup.running?'等待上传':'等待首次备份';$('#operationsOffsite').textContent=remote.enabled?'最近成功：'+date(remote.lastSuccess)+(remote.lastError?'；'+remote.lastError:''):'启用后加密上传私有OSS，独立恢复密钥须另行保管。';
  tone('#operationsAlertState',view.alertState);$('#operationsAlertState').textContent=!alerts.enabled?'未启用':alerts.error?'发送失败':'已启用';$('#operationsAlerts').textContent=alerts.enabled?(alerts.error||'企业微信群运行告警已配置；最近发送：'+(alerts.lastSuccess?date(alerts.lastSuccess):'尚未触发')):'可配置企业微信群机器人接收运行告警。';
  $('#operationsStatus').textContent=backup.lastError||'备份范围：OPS数据库和连接解密密钥。OSS图片、部署环境配置及未完成货盘预览需另行保管。';
  $('#operationsBackupNow').disabled=backup.running;
  if(isVisible())timer=setTimeout(()=>{if(isVisible())load();},backup.running?2000:15000);
 }catch(e){if(request===generation){$('#operationsSummary').textContent='状态读取失败';tone('#operationsSummary','error');$('#operationsStatus').textContent='读取运行状态失败：'+e.message+'；其他指标保留上次读取值，请刷新确认。';}}finally{if(request===generation)$('#operationsRefresh').disabled=false;}}
 $('#operationsRefresh').onclick=load;
 $('#operationsBackupNow').onclick=async()=>{const b=$('#operationsBackupNow');b.disabled=true;try{const r=await api('/api/operations/backup','POST',{});$('#operationsStatus').textContent=r.started?'已开始生成一致性备份。':'备份正在进行，请稍候。';await load();}catch(e){$('#operationsStatus').textContent=e.message;b.disabled=false;}};
 return {load,stop(){generation++;clearTimeout(timer);}};
}
