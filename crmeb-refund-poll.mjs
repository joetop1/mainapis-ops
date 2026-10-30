import {fetchCrmebToken} from './crmeb-auth.mjs';
import {mallOrigin,mallDispatcher} from './mall-address.mjs';
const pending=data=>[0,1,2,4,5].includes(Number(data.refund_type))&&Number(data.is_cancel||0)===0&&Number(data.is_del||0)===0;
export function crmebRefundPoll({db,getCredentials,getNotificationConfig,findMall,enqueue,fetcher=fetch,clock=Date.now}){
 db.exec(`CREATE TABLE IF NOT EXISTS notification_refund_poll(mall_id TEXT PRIMARY KEY,enabled INTEGER NOT NULL DEFAULT 0,origin TEXT NOT NULL,since_ms INTEGER NOT NULL,last_success INTEGER NOT NULL DEFAULT 0,checked INTEGER NOT NULL DEFAULT 0,error TEXT NOT NULL DEFAULT '');`);
 const running=new Set();let stopped=false;
 const state=id=>db.prepare('SELECT enabled,since_ms,last_success,checked,error FROM notification_refund_poll WHERE mall_id=?').get(id)||{enabled:0,checked:0,last_success:0,error:''};
 const client=async mall=>{
  if(!['crmeb-pro','crmeb-store'].includes(mall.system))throw Error('不支持的退款通知商城系统');
  const c=getCredentials(mall),origin=mallOrigin(c?.url||(mall.system==='crmeb-store'?'https://www.xlyp.cc':'https://xlupw.com')),token=await fetchCrmebToken(mall.system,c,fetcher);
  const get=async path=>{let r;try{r=await fetcher(origin+path,{method:'GET',headers:{Authorization:'Bearer '+token,'Authori-zation':'Bearer '+token,Accept:'application/json'},redirect:'error',dispatcher:mallDispatcher,signal:AbortSignal.timeout(15000)});}catch{throw Error('售后读取请求未完成，请检查商城网络');}if(!r.ok)throw Error('售后读取接口返回HTTP '+r.status+'，请核对接口及权限');const raw=await r.text();if(raw.length>2e6)throw Error('售后接口响应过大');let data;try{data=JSON.parse(raw);}catch{throw Error('售后接口响应格式异常');}if(Number(data.status)!==200)throw Error('售后读取接口拒绝请求，请为OPS所保存的商城应用开启售后订单列表和详情的只读权限');return data.data;};
  const list=async page=>{const d=await get('/outapi/refund/list?page='+page+'&limit=50');if(!Array.isArray(d?.list)||!Number.isSafeInteger(Number(d.count))||Number(d.count)<0)throw Error('售后列表格式不匹配');return d;};
  const detail=async row=>{if(typeof row.order_id!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(row.order_id))throw Error('售后单编号格式异常');const d=await get('/outapi/refund/'+encodeURIComponent(row.order_id));if(!d||String(d.id)!==String(row.id)||d.order_id!==row.order_id||String(d.store_order_id)!==String(row.store_order_id)||typeof d.store_order_sn!=='string'||!d.store_order_sn)throw Error('售后详情与列表或关联订单不一致');return {...d,order:{order_id:d.store_order_sn}};};
  return {origin,list,detail};
 };
 const run=async(id,manual=false)=>{
  if(stopped||running.has(id))return;const saved=db.prepare('SELECT * FROM notification_refund_poll WHERE mall_id=?').get(id),c=getNotificationConfig(id),mall=findMall(id);
  if(!saved?.enabled||!c?.enabled||!c.refund||!mall||mall.system==='crmeb-store')return;
  running.add(id);const started=clock(),floor=manual?started-86400000:Math.max(saved.since_ms,(saved.last_success||saved.since_ms)-300000);
  db.prepare("UPDATE notification_refund_poll SET checked=?,error='' WHERE mall_id=?").run(started,id);
  try{
   const api=await client(mall);if(api.origin!==saved.origin)throw Error('商城地址已变化，请重新检查并启用退款补拉');
   const seen=new Set();let complete=false,previousTime=Infinity;
   for(let page=1;page<=20;page++){
    const data=await api.list(page);let older=false;
    for(const row of data.list){
     if(!/^[1-9][0-9]{0,14}$/.test(String(row.id)))throw Error('售后列表ID格式异常');if(seen.has(String(row.id)))continue;seen.add(String(row.id));
     const time=Number(row.add_time)*1000;if(!Number.isFinite(time)||time<=0||time>started+300000)throw Error('售后申请时间格式异常');if(time>previousTime)throw Error('售后列表未按申请时间倒序，未推进检查进度');previousTime=time;
     if(time<floor){older=true;continue;}if(!pending(row))continue;
     const detail=await api.detail(row);if(!pending(detail))continue;enqueue(id,detail);
    }
    if(older||data.list.length===0||seen.size>=Number(data.count)){complete=true;break;}
    if(page===20)throw Error('本次售后扫描达到20页上限，检查进度未推进，请核对积压量');
   }
   if(!complete)throw Error('售后列表未完整扫描，检查进度未推进');
   db.prepare("UPDATE notification_refund_poll SET last_success=?,error='' WHERE mall_id=?").run(started,id);
  }catch(e){db.prepare('UPDATE notification_refund_poll SET error=? WHERE mall_id=?').run(String(e.message).slice(0,250),id);}
  finally{running.delete(id);}
 };
 const enable=async mall=>{
  if(mall.system==='crmeb-store')throw Error('多门店已改为原生企业微信通知转接，请配置专用地址和模板');
  const c=getNotificationConfig(mall.id);if(!c?.enabled||!c.refund)throw Error('请先保存并启用通知与申请退款开关');
  if(running.has(mall.id))throw Error('正在检查，请稍后刷新');
  const api=await client(mall),data=await api.list(1);if(data.list.length)await api.detail(data.list[0]);
  db.prepare('INSERT INTO notification_refund_poll(mall_id,enabled,origin,since_ms) VALUES(?,1,?,?) ON CONFLICT(mall_id) DO UPDATE SET enabled=1,origin=excluded.origin').run(mall.id,api.origin,clock()-86400000);
  return {ok:true};
 };
 const tick=async()=>{for(const row of db.prepare('SELECT mall_id,checked FROM notification_refund_poll WHERE enabled=1').all()){if(stopped)return;if(clock()-row.checked>=60000)await run(row.mall_id);}};
 return {state,enable,run,tick,stop(){stopped=true;}};
}
