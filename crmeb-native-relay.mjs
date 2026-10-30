import {randomBytes,createHmac,timingSafeEqual} from 'node:crypto';
import {fetchCrmebToken} from './crmeb-auth.mjs';
import {mallOrigin,mallDispatcher} from './mall-address.mjs';
import {notificationFact} from './mall-notifications.mjs';
const validId=v=>/^[1-9][0-9]{0,14}$/.test(String(v||''));
const validSn=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(v);
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const pending=r=>[0,1,2,4,5].includes(Number(r.refund_type))&&Number(r.is_cancel)===0&&Number(r.is_del)===0;
function items(data){if(!Array.isArray(data.items)||!data.items.length||data.items.length>200||data.items.some(r=>typeof r.store_name!=='string'||!r.store_name.trim()||!Number.isSafeInteger(Number(r.cart_num))||Number(r.cart_num)<1))throw Error('商城商品明细缺失或格式异常');}
export function crmebNativeRelay({db,findMall,getConfig,getCredentials,enqueue,fetcher=fetch,clock=Date.now}){
 db.exec(`CREATE TABLE IF NOT EXISTS notification_native_inbox(id TEXT PRIMARY KEY,mall_id TEXT NOT NULL,kind TEXT NOT NULL,order_sn TEXT NOT NULL,origin TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,next_at INTEGER NOT NULL,created INTEGER NOT NULL,error TEXT NOT NULL DEFAULT '');
 CREATE INDEX IF NOT EXISTS native_notice_due ON notification_native_inbox(status,next_at);`);
 // Reads/enqueue are repeatable: business outbox deduplicates using native order/refund ID.
 db.exec("UPDATE notification_native_inbox SET status='pending' WHERE status='working'");
 let busy=false,stopped=false;
 const key=(mall,kind)=>{const c=getConfig(mall.id);return mall.system==='crmeb-store'&&c?.signingKey?createHmac('sha256',c.signingKey).update('native-relay:'+mall.id+':'+kind).digest('hex'):'';};
 const meta=(mall,origin)=>{if(mall.system!=='crmeb-store')return {};const url=kind=>{const k=key(mall,kind);return k?origin+'/api/notification-relay/'+mall.id+'/'+kind+'?key='+k:'';};return {relayPaidUrl:url('paid'),relayRefundUrl:url('refund'),relayPaidTemplate:'OPS_PAID|{order_id}',relayRefundTemplate:'OPS_REFUND|{order_id}',relayRecords:db.prepare('SELECT id,kind,order_sn,status,attempts,created,error FROM notification_native_inbox WHERE mall_id=? ORDER BY created DESC,id LIMIT 30').all(mall.id)};};
 const receive=(id,kind,secret,input)=>{
  const mall=findMall(id),c=getConfig(id);
  if(!mall||mall.system!=='crmeb-store'||!['paid','refund'].includes(kind)||!c?.enabled||!c[kind]||!key(mall,kind)||!equal(key(mall,kind),secret))throw Error('原生通知鉴权或开关不匹配');
  const content=input?.markdown?.content;
  if(input?.msgtype!=='markdown'||typeof content!=='string'||content.length>200)throw Error('原生通知格式不匹配');
  const match=content.match(/^OPS_(PAID|REFUND)\|([A-Za-z0-9_-]{1,80})$/);
  if(!match||match[1]!==kind.toUpperCase())throw Error('请使用OPS提供的原生通知模板');
  const source=getCredentials(mall),origin=mallOrigin(source?.url||'https://www.xlyp.cc');
  // A receipt is durable before acknowledgement. Duplicates waiting for a read share one receipt.
  if(!db.prepare("SELECT 1 FROM notification_native_inbox WHERE mall_id=? AND kind=? AND order_sn=? AND origin=? AND status='pending'").get(id,kind,match[2],origin)){
   if(db.prepare("SELECT COUNT(*) AS n FROM notification_native_inbox WHERE mall_id=? AND status IN ('pending','working')").get(id).n>=1000)throw Error('通知接收积压已达上限');
   db.prepare('INSERT INTO notification_native_inbox(id,mall_id,kind,order_sn,origin,next_at,created) VALUES(?,?,?,?,?,?,?)').run(randomBytes(12).toString('hex'),id,kind,match[2],origin,clock()+3000,clock());
  }
  return {errcode:0,errmsg:'ok'};
 };
 const client=async(mall,expectedOrigin)=>{
  const credentials=getCredentials(mall),origin=mallOrigin(credentials?.url||'https://www.xlyp.cc');if(expectedOrigin&&origin!==expectedOrigin)throw Error('商城地址已变化，未读取旧通知；请核对后重试');
  const token=await fetchCrmebToken('crmeb-store',credentials,fetcher);
  const get=async path=>{
   let response;try{response=await fetcher(origin+path,{method:'GET',headers:{Authorization:'Bearer '+token,'Authori-zation':'Bearer '+token,Accept:'application/json'},redirect:'error',dispatcher:mallDispatcher,signal:AbortSignal.timeout(15000)});}catch{throw Error('商城通知资料读取未完成');}
   if(!response.ok)throw Error('商城通知资料读取HTTP '+response.status+'，请检查订单详情及售后列表只读权限');
   let raw;try{raw=await response.text();}catch{throw Error('商城通知资料响应读取失败');}if(raw.length>2000000)throw Error('商城通知资料响应过大');let value;try{value=JSON.parse(raw);}catch{throw Error('商城通知资料响应格式异常');}if(Number(value.status)!==200)throw Error('商城拒绝读取，请检查订单详情及售后列表只读权限');return value.data;
  };
  return get;
 };
 const check=async mall=>{
  const c=getConfig(mall.id);if(mall.system!=='crmeb-store'||!c?.enabled)throw Error('请先保存并启用多门店通知');
  const get=await client(mall);
  if(c.refund){const d=await get('/outapi/refund/list?page=1&limit=1');if(!Array.isArray(d?.list)||!Number.isSafeInteger(Number(d.count)))throw Error('售后列表格式不匹配');}
  const d=await get('/outapi/order/list?page=1&limit=1');if(!Array.isArray(d?.list)||!Number.isSafeInteger(Number(d.count)))throw Error('订单列表格式不匹配');
  if(d.list.length){const sample=d.list[0];if(!validSn(sample.order_id)||!validId(sample.id))throw Error('订单标识格式异常');const detail=await get('/outapi/order/'+encodeURIComponent(sample.order_id));if(String(detail?.id)!==String(sample.id)||detail.order_id!==sample.order_id)throw Error('订单详情核对不一致');}
  return {ok:true};
 };
 const read=async(mall,row)=>{
  const get=await client(mall,row.origin);
  const order=await get('/outapi/order/'+encodeURIComponent(row.order_sn));
  if(!order||!validId(order.id)||order.order_id!==row.order_sn)throw Error('商城订单号或内部ID核对不一致');
  if(row.kind==='paid'){items(order);notificationFact('paid',order);return [order];}
  // Only application records supply refund amount/quantity/reason; never use original paid amount.
  const results=[],seen=new Set();let previous=Infinity,complete=false;
  for(let page=1;page<=20;page++){
   const d=await get('/outapi/refund/list?page='+page+'&limit=50');if(!Array.isArray(d?.list)||!Number.isSafeInteger(Number(d.count))||Number(d.count)<0)throw Error('售后列表格式不匹配');let older=false,added=0;
   for(const r of d.list){
    if(!validId(r.id)||!validId(r.store_order_id)||!validSn(r.order_id))throw Error('售后列表标识格式异常');
    if(seen.has(String(r.id)))continue;seen.add(String(r.id));added++;
    const time=Number(r.add_time)*1000;if(!Number.isFinite(time)||time<=0||time>clock()+300000||time>previous)throw Error('售后列表申请时间或排序异常');previous=time;
    if(time<row.created-86400000){older=true;continue;}
    if(String(r.store_order_id)!==String(order.id)||!pending(r))continue;
    if(r.is_cancel===undefined||r.is_del===undefined)throw Error('售后申请状态不完整');
    const data={...r,refund_price:r.pay_price,order:{order_id:order.order_id}};items(data);notificationFact('refund',data);results.push(data);
   }
   if(older||!d.list.length||seen.size>=Number(d.count)){complete=true;break;}
   if(!added)throw Error('售后列表分页重复，未完成核对');
  }
  if(!complete)throw Error('售后核对达到20页上限，未完成读取');
  if(!results.length)throw Error('未找到该订单近24小时内待处理申请，稍后重试；已处理申请不会当作新申请发送');
  return results;
 };
 const retry=(mall,id)=>{if(mall.system!=='crmeb-store'||!db.prepare("UPDATE notification_native_inbox SET status='pending',attempts=0,next_at=?,error='' WHERE id=? AND mall_id=? AND status='failed'").run(clock(),id,mall.id).changes)throw Error('原生接收记录不可重试');};
 const tick=async()=>{
  if(stopped||busy)return;busy=true;
  try{for(const row of db.prepare("SELECT * FROM notification_native_inbox WHERE status='pending' AND next_at<=? ORDER BY created,id LIMIT 100").all(clock())){
   const mall=findMall(row.mall_id),c=getConfig(row.mall_id);if(!mall||mall.system!=='crmeb-store'||!c?.enabled||!c[row.kind])continue;
   if(!db.prepare("UPDATE notification_native_inbox SET status='working',attempts=attempts+1 WHERE id=? AND status='pending'").run(row.id).changes)continue;
   try{const facts=await read(mall,row);const current=getConfig(row.mall_id);if(stopped||!current?.enabled||!current[row.kind]){db.prepare("UPDATE notification_native_inbox SET status='pending' WHERE id=?").run(row.id);break;}
    if(mallOrigin(getCredentials(mall)?.url||'https://www.xlyp.cc')!==row.origin)throw Error('商城地址已变化，请核对接收记录');
    db.exec('BEGIN IMMEDIATE');try{for(const fact of facts)enqueue(row.mall_id,row.kind,fact);db.prepare("UPDATE notification_native_inbox SET status='done',error='' WHERE id=?").run(row.id);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
   }catch(e){db.prepare('UPDATE notification_native_inbox SET status=?,next_at=?,error=? WHERE id=?').run(row.attempts+1>=8?'failed':'pending',clock()+Math.min(3600000,30000*2**row.attempts),String(e.message).slice(0,250),row.id);}
   break;
  }}finally{busy=false;}
 };
 return {meta,receive,retry,check,tick,stop(){stopped=true;}};
}
