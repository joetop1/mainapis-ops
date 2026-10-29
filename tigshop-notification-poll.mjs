import {mallOrigin,mallDispatcher} from './mall-address.mjs';
import {requireTigshopToken} from './tigshop-client.mjs';
const id=value=>/^[1-9][0-9]{0,14}$/.test(String(value||''));
const validShop=row=>{if(!Number.isSafeInteger(row?.shopId)||row.shopId<0)throw Error('订单或售后未返回有效shopId，无法确认自营归属');return row.shopId===0;};
export function tigshopNotificationSettings(input){
 const currency=String(input.currency||'').trim().toUpperCase(),timeZone=String(input.timeZone||'').trim();
 if(!/^[A-Z]{3}$/.test(currency)||!Intl.supportedValuesOf('currency').includes(currency))throw Error('请确认并填写Tigshop接口金额的基准币种，例如EUR或CNY');
 if(!timeZone||timeZone.length>80)throw Error('请确认并选择Tigshop接口时间所在时区');
 try{new Intl.DateTimeFormat('en',{timeZone}).format(0);}catch{throw Error('接口时间所在时区无效');}
 return {currency,timeZone};
}
export function tigshopEventTime(value,timeZone){
 const raw=String(value??'');if(/^\d{10}$/.test(raw))return Number(raw)*1000;if(/^\d{13}$/.test(raw))return Number(raw);
 const match=raw.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);if(!match)throw Error('Tigshop事件时间格式不匹配');
 const parts=match.slice(1).map(Number),utc=Date.UTC(parts[0],parts[1]-1,...parts.slice(2)),formatter=new Intl.DateTimeFormat('en-US',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
 const fields=t=>{const map=Object.fromEntries(formatter.formatToParts(t).map(p=>[p.type,p.value]));return ['year','month','day','hour','minute','second'].map(k=>Number(map[k]));};
 const offset=t=>{const f=fields(t);return Date.UTC(f[0],f[1]-1,...f.slice(2))-t;};
 let result=utc-offset(utc);result=utc-offset(result);
 const matches=t=>JSON.stringify(fields(t))===JSON.stringify(parts);
 if(!matches(result))throw Error('接口时间与所选时区不匹配');
 if(matches(result-3600000)||matches(result+3600000))throw Error('接口时间处于夏令时重叠区间，无法可靠确定事件时间');
 return result;
}
const amount=value=>{if(!/^(?:0|[1-9][0-9]{0,10})(?:\.[0-9]{1,2})?$/.test(String(value)))throw Error('通知金额格式不匹配，请核对商城接口金额');return String(value);};
const specs=row=>Array.isArray(row.skuData)?row.skuData.map(s=>{if(typeof s?.name!=='string'||typeof s?.value!=='string')throw Error('商品规格格式不匹配');return s.name+'：'+s.value;}).join(' / '):typeof row.skuValue==='string'?row.skuValue:'';
const item=(row,quantity)=>{if(typeof row?.productName!=='string'||!row.productName||!Number.isSafeInteger(quantity)||quantity<1)throw Error('通知商品名称或数量格式不匹配');return {store_name:row.productName,suk:specs(row),cart_num:quantity};};
function paidFact(order,time){
 if(typeof order.orderSn!=='string'||!order.orderSn||order.orderSn.length>80)throw Error('订单编号格式不匹配');
 if(!Array.isArray(order.items)||!order.items.length||order.items.length>200)throw Error('订单商品明细格式不匹配');
 return {id:order.orderId,order_id:order.orderSn,paid:1,pay_price:amount(order.paidAmount),pay_time:Math.floor(time/1000),items:order.items.map(row=>item(row,row.quantity))};
}
function refundFact(refund,order,time){
 if(typeof refund.aftersalesSn!=='string'||!refund.aftersalesSn||refund.aftersalesSn.length>80)throw Error('售后编号格式不匹配');
 if(!Array.isArray(refund.aftersalesItems)||!refund.aftersalesItems.length||refund.aftersalesItems.length>200)throw Error('售后商品明细格式不匹配');
 return {id:refund.aftersaleId,order_id:refund.aftersalesSn,store_order_id:order.orderId,order:{order_id:order.orderSn},refund_price:amount(refund.refundAmount),refund_reason:refund.aftersaleReason||refund.description||'',add_time:Math.floor(time/1000),items:refund.aftersalesItems.map(row=>{if(Number(row.orderId)!==Number(order.orderId))throw Error('售后商品不属于当前订单');return item(row,row.number);})};
}
export function tigshopNotificationPoll({db,getCredentials,getNotificationConfig,findMall,enqueue,fetcher=fetch,clock=Date.now}){
 db.exec(`CREATE TABLE IF NOT EXISTS notification_tigshop_poll(mall_id TEXT NOT NULL,kind TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1,origin TEXT NOT NULL,currency TEXT NOT NULL,time_zone TEXT NOT NULL,since_ms INTEGER NOT NULL,last_success INTEGER NOT NULL DEFAULT 0,checked INTEGER NOT NULL DEFAULT 0,error TEXT NOT NULL DEFAULT '',PRIMARY KEY(mall_id,kind));`);
 const running=new Set();let stopped=false;
 const state=id=>Object.fromEntries(['paid','refund'].map(kind=>[kind,db.prepare('SELECT enabled,last_success,checked,error FROM notification_tigshop_poll WHERE mall_id=? AND kind=?').get(id,kind)||{enabled:0,last_success:0,checked:0,error:''}]));
 const client=mall=>{
  if(mall?.system!=='tigshop')throw Error('通知商城系统不匹配');
  const c=getCredentials(mall),origin=mallOrigin(c?.url||'https://xiaolango.com'),token=requireTigshopToken(c?.token);
  const get=async path=>{
   if(!/^\/adminapi\/order\/(?:order|aftersales)\/(?:list\?|detail\?id=[1-9][0-9]{0,14}$)/.test(path))throw Error('不支持的通知读取接口');
   let r;try{r=await fetcher(origin+path,{method:'GET',headers:{'X-Api-Token':token,'X-ADMIN-TYPE':'admin',Accept:'application/json'},redirect:'error',dispatcher:mallDispatcher,signal:AbortSignal.timeout(15000)});}catch{throw Error('Tigshop通知读取请求未完成，请检查商城网络');}
   if(!r.ok)throw Error('Tigshop通知读取返回HTTP '+r.status+'，请检查订单和售后只读权限');
   const raw=await r.text();if(raw.length>4e6)throw Error('Tigshop通知响应过大');let result;try{result=JSON.parse(raw);}catch{throw Error('Tigshop通知接口JSON格式异常');}
   if(result.code!==0||!result.data)throw Error('Tigshop通知读取失败，请检查Token及订单和售后只读权限');return result.data;
  };
  const list=async(kind,page)=>{const path=kind==='paid'?'order':'aftersales',sort=kind==='paid'?'payTime':'addTime',filter=kind==='paid'?'payStatus=2':'status=1';const data=await get('/adminapi/order/'+path+'/list?page='+page+'&size=50&sortField='+sort+'&sortOrder=desc&shopId=0&'+filter);if(!Array.isArray(data.records)||!Number.isSafeInteger(Number(data.total))||Number(data.total)<0)throw Error('Tigshop通知分页格式不匹配');return data;};
  const order=async number=>{if(!id(number))throw Error('订单ID无效');const data=await get('/adminapi/order/order/detail?id='+number);if(String(data.orderId)!==String(number)||typeof data.orderSn!=='string'||!data.orderSn||!validShop(data))throw Error('订单详情ID或自营归属不匹配');return data;};
  const detail=async(kind,row)=>{
   if(kind==='paid'){const data=await order(row.orderId);if(data.orderSn!==row.orderSn)throw Error('订单详情货号与列表不匹配');return {data,order:data};}
   const data=await get('/adminapi/order/aftersales/detail?id='+row.aftersaleId);
   if(String(data.aftersaleId)!==String(row.aftersaleId)||data.aftersalesSn!==row.aftersalesSn||String(data.orderId)!==String(row.orderId)||!validShop(data))throw Error('售后详情编号或自营归属不匹配');
   const associated=await order(data.orderId);if(typeof row.orderSn!=='string'||associated.orderSn!==row.orderSn)throw Error('售后关联订单号与列表不匹配');return {data,order:associated};
  };
  return {origin,list,detail};
 };
 const run=async(mallId,kind,manual=false)=>{
  const key=mallId+':'+kind;if(stopped||running.has(key))return;const saved=db.prepare('SELECT * FROM notification_tigshop_poll WHERE mall_id=? AND kind=?').get(mallId,kind),c=getNotificationConfig(mallId),mall=findMall(mallId);
  if(!saved?.enabled||!c?.enabled||!c[kind]||!mall)return;
  running.add(key);const started=clock(),floor=manual?started-86400000:Math.max(saved.since_ms,(saved.last_success||saved.since_ms)-300000);
  db.prepare("UPDATE notification_tigshop_poll SET checked=?,error='' WHERE mall_id=? AND kind=?").run(started,mallId,kind);
  try{
   const settings=tigshopNotificationSettings(c),api=client(mall);
   if(api.origin!==saved.origin||settings.currency!==saved.currency||settings.timeZone!==saved.time_zone)throw Error('商城地址、基准币种或时区已变化，请重新检查并启用通知');
   const seen=new Set();let complete=false,previous=Infinity;
   for(let page=1;page<=20;page++){
    const data=await api.list(kind,page);let older=false;
    for(const row of data.records){
     const number=kind==='paid'?row.orderId:row.aftersaleId;if(!id(number))throw Error('通知列表ID格式不匹配');if(seen.has(String(number)))continue;seen.add(String(number));
     const time=tigshopEventTime(kind==='paid'?row.payTime:row.addTime,settings.timeZone);if(time>started+300000||time<=0)throw Error('事件时间不合理，请核对接口时区');if(time>previous)throw Error('通知列表未按事件时间倒序，未推进检查进度');previous=time;
     if(time<floor){older=true;continue;}if(!validShop(row))continue;
     if(kind==='paid'&&!Number.isInteger(row.payStatus)||kind==='refund'&&!Number.isInteger(row.status))throw Error('订单付款或售后状态字段缺失');
     if(kind==='paid'&&row.payStatus!==2||kind==='refund'&&row.status!==1)continue;
     const detail=await api.detail(kind,row);
     if(kind==='paid'){
      if(Number(detail.data.payStatus)!==2||![1,2,5].includes(Number(detail.data.orderStatus)))continue;
      if(!Number.isInteger(detail.data.isValid)||![0,1].includes(detail.data.isValid))throw Error('订单有效性字段缺失，未生成付款通知');if(detail.data.isValid===0)continue;
      const paidTime=tigshopEventTime(detail.data.payTime,settings.timeZone);if(paidTime<floor||paidTime>started+300000)continue;
      enqueue(mallId,kind,paidFact(detail.data,paidTime),settings.currency);
     }else{
      if(Number(detail.data.status)!==1||![1,2].includes(Number(detail.data.aftersaleType)))continue;
      if(tigshopEventTime(detail.data.addTime,settings.timeZone)!==time)throw Error('售后申请时间与列表不一致');
      enqueue(mallId,kind,refundFact(detail.data,detail.order,time),settings.currency);
     }
    }
    if(older||data.records.length===0||seen.size>=Number(data.total)){complete=true;break;}
    if(page===20)throw Error('Tigshop通知扫描达到20页上限，未推进检查进度，请核对积压量');
   }
   if(!complete)throw Error('Tigshop通知未完整扫描，未推进检查进度');
   db.prepare("UPDATE notification_tigshop_poll SET last_success=?,error='' WHERE mall_id=? AND kind=?").run(started,mallId,kind);
  }catch(e){db.prepare('UPDATE notification_tigshop_poll SET error=? WHERE mall_id=? AND kind=?').run(String(e.message).slice(0,250),mallId,kind);}
  finally{running.delete(key);}
 };
 const enable=async mall=>{
  const c=getNotificationConfig(mall.id);if(!c?.enabled||!c.paid&&!c.refund)throw Error('请先保存并启用通知与订阅事件');const settings=tigshopNotificationSettings(c),api=client(mall),kinds=['paid','refund'].filter(k=>c[k]);
  for(const kind of kinds){if(running.has(mall.id+':'+kind))throw Error('正在检查，请稍后刷新');const data=await api.list(kind,1);const row=data.records.find(row=>validShop(row));if(row){const detail=await api.detail(kind,row),time=tigshopEventTime(kind==='paid'?detail.data.payTime:detail.data.addTime,settings.timeZone);if(time<=0||time>clock()+300000)throw Error('事件时间不合理，请核对接口时区');if(kind==='paid')paidFact(detail.data,time);else refundFact(detail.data,detail.order,time);}}
  db.exec('BEGIN IMMEDIATE');try{for(const kind of kinds)db.prepare('INSERT INTO notification_tigshop_poll(mall_id,kind,origin,currency,time_zone,since_ms) VALUES(?,?,?,?,?,?) ON CONFLICT(mall_id,kind) DO UPDATE SET enabled=1,origin=excluded.origin,currency=excluded.currency,time_zone=excluded.time_zone').run(mall.id,kind,api.origin,settings.currency,settings.timeZone,clock()-86400000);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
  return {ok:true};
 };
 const tick=async()=>{for(const row of db.prepare('SELECT mall_id,kind,checked FROM notification_tigshop_poll WHERE enabled=1').all()){if(stopped)return;if(clock()-row.checked>=60000)await run(row.mall_id,row.kind);}};
 const checkNow=async id=>{for(const kind of ['paid','refund'])await run(id,kind,true);};
 return {state,enable,run,checkNow,tick,stop(){stopped=true;}};
}
