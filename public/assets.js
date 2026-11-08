export function assetPresentation(data,now=Date.now()){
 const storage=data.storage||{},number=n=>Number.isFinite(n)?n.toLocaleString('zh-CN'):'—',size=n=>Number.isFinite(n)?(n/1024**3).toFixed(2)+' GB':'—';
 const expiry=Date.parse(storage.expires),remaining=Number.isFinite(expiry)?expiry-now:NaN,active=storage.active&&remaining>0;
 const plan=active?'剩余 '+Math.ceil(remaining/86400000)+' 天':storage.exempt?'免额度限制':Number.isFinite(expiry)&&remaining<=0?'套餐已到期':'无有效套餐';
 const planHint=active?'有效至 '+new Date(expiry).toLocaleDateString('zh-CN')+(storage.exempt?' · 内部免额度':''):storage.exempt?'内部空间，新增上传不受套餐限制':'外链图片可继续使用';
 const used=(storage.storedBytes||0)+(storage.reservedBytes||0),percent=storage.limitBytes>0?Math.min(100,Math.max(0,used/storage.limitBytes*100)):null;
 return {available:number(data.account?.available),frozen:number(data.account?.frozen),mode:data.testMode?'收费测试中':data.account?.exempt?'内部免计费':data.enabled?'按量计费':'未启用扣点',plan,planHint,usage:'已登记 '+size(storage.storedBytes)+(storage.limitBytes>0?' / '+size(storage.limitBytes):''),pending:storage.reservedBytes>0?'待核对 '+size(storage.reservedBytes):'',percent};
}
export function setupAssetPanel({$,api}){
 let running=false,timer=null,debounce=null,busy=false,again=false;
 async function refresh(){if(!running||document.hidden)return;if(busy){again=true;return;}busy=true;try{const data=await api('/api/billing/summary');if(!running)return;const view=assetPresentation(data);$('#sidebarAssets').classList.remove('hidden');$('#assetWorkspace').textContent=data.workspace;$('#assetAvailable').textContent=view.available;$('#assetFrozen').textContent=view.frozen;$('#assetMode').textContent=view.mode;$('#assetPlan').textContent=view.plan;$('#assetPlanHint').textContent=view.planHint;$('#assetUsage').textContent=view.usage;$('#assetPending').textContent=view.pending;const meter=$('#assetMeter');meter.hidden=view.percent===null;if(view.percent!==null)meter.value=view.percent;$('#assetUpdated').textContent='更新于 '+new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'});$('#assetUpdated').classList.remove('is-error');}catch(error){if([401,403].includes(error.httpStatus)){stop();return;}$('#assetUpdated').textContent='读取失败 · 信息可能已过期';$('#assetUpdated').classList.add('is-error');}finally{busy=false;if(running){clearTimeout(timer);timer=setTimeout(refresh,again?200:30000);again=false;}}}
 function start(){if(running)return;running=true;$('#sidebarAssets').classList.remove('hidden');refresh();}
 function stop(){running=false;clearTimeout(timer);clearTimeout(debounce);$('#sidebarAssets').classList.add('hidden');}
 function schedule(){if(!running)return;clearTimeout(debounce);debounce=setTimeout(refresh,200);}
 document.addEventListener('visibilitychange',()=>{if(running&&!document.hidden)refresh();});$('#assetRefresh').onclick=refresh;
 return {start,stop,schedule,refresh};
}
