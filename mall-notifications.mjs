import {tigshopNotificationSettings} from './tigshop-notification-poll.mjs';
import {randomBytes,createHmac,timingSafeEqual} from 'node:crypto';
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const boundedText=value=>{let result='';for(const char of value){if(Buffer.byteLength(result+char)>1950)break;result+=char;}return result;};
const clean=(v,n=160)=>String(v??'').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/https?:\/\/\S+/gi,'[链接已隐藏]').replace(/\b1[3-9]\d{9}\b/g,'[手机号已隐藏]').slice(0,n);
const eventTime=value=>{if(!/^\d{10,13}$/.test(value||''))return '';const time=Number(value)*(String(value).length<=10?1000:1);return Number.isFinite(time)?new Date(time).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}):'';};
const numberId=v=>/^[1-9][0-9]{0,14}$/.test(String(v||''));
export function wecomWebhook(value){
 const u=new URL(value);if(u.protocol!=='https:'||u.hostname!=='qyapi.weixin.qq.com'||u.port||u.username||u.password||u.hash||u.pathname!=='/cgi-bin/webhook/send'||u.searchParams.size!==1||!/^[-a-zA-Z0-9_]{16,160}$/.test(u.searchParams.get('key')||''))throw Error('请填写企业微信自定义消息推送的完整HTTPS Webhook地址');return u.href;
}
export function notificationFact(kind,data){
 if(!['paid','refund'].includes(kind)||!data||typeof data!=='object'||Array.isArray(data)||!numberId(data.id)||typeof data.order_id!=='string'||!data.order_id||data.order_id.length>80)throw Error('商城通知缺少有效订单或售后编号');
 if(kind==='paid'&&Number(data.paid)!==1)throw Error('付款通知未标记已付款');
 if(kind==='refund'&&(!numberId(data.store_order_id)||!data.order?.order_id))throw Error('退款通知缺少关联订单');
 const amount=kind==='paid'?data.pay_price:data.refund_price;
 if(!/^(?:0|[1-9][0-9]{0,10})(?:\.[0-9]{1,2})?$/.test(String(amount)))throw Error('通知金额格式无效');
 if(!Array.isArray(data.items)||data.items.length>200)throw Error('通知商品明细格式无效');
 return {id:String(data.id),number:clean(data.order_id,80),orderNumber:kind==='refund'?clean(data.order.order_id,80):clean(data.order_id,80),amount:String(amount),reason:kind==='refund'?clean(data.refund_reason||data.refund_explain,200):'',time:clean(kind==='paid'?data.pay_time:data.add_time,30),items:data.items.slice(0,5).map(row=>({name:clean(row.store_name,100),spec:clean(row.suk,80),quantity:clean(row.cart_num,10)})),itemCount:data.items.length};
}
export function notificationText(mall,kind,fact,eventId){
 if(kind==='test')return '【'+clean(mall.name,50)+' · 通知测试】\n企业微信群连接正常。此消息不是订单或退款通知。\n事件：'+eventId;
 const title=kind==='paid'?'付款成功':'申请退款（待商城处理）';
 return ['【'+clean(mall.name,50)+' · '+title+'】','事件：'+eventId,eventTime(fact.time)?'时间（北京时间）：'+eventTime(fact.time):'',kind==='refund'?'售后单：'+fact.number:'订单号：'+fact.number,kind==='refund'?'原订单：'+fact.orderNumber:'',kind==='refund'?'申请金额：'+(fact.currency||'CNY')+' '+fact.amount:'实付金额：'+(fact.currency||'CNY')+' '+fact.amount,fact.items.length?'':'商品明细未提供，请到商城后台查看',...fact.items.map(row=>'商品：'+row.name+' / '+row.spec+' × '+row.quantity),fact.itemCount>5?'另有 '+(fact.itemCount-5)+' 项，请到商城后台查看':'',fact.reason?'申请原因：'+fact.reason:'','请登录该商城后台核对处理。'].filter(Boolean).join('\n');
}
export function mallNotifications({db,store,findMall,fetcher=fetch,clock=Date.now}){
 db.exec(`CREATE TABLE IF NOT EXISTS notification_outbox(id TEXT PRIMARY KEY,mall_id TEXT NOT NULL,kind TEXT NOT NULL,event_key TEXT NOT NULL,fact TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,next_at INTEGER NOT NULL,created INTEGER NOT NULL,sent_at INTEGER,error TEXT NOT NULL DEFAULT '',UNIQUE(mall_id,kind,event_key));
 CREATE INDEX IF NOT EXISTS notification_due ON notification_outbox(status,next_at);`);
 // A crashed send may have been accepted remotely. Keep its uncertainty visible; do not silently resend.
 db.exec("UPDATE notification_outbox SET status='uncertain',error='服务在发送过程中重启，可能已送达，请核对群消息' WHERE status='sending'");
 let busy=false,stopped=false,lastAttempt=-Infinity;
 const config=id=>store.get('notification:'+id);
 const publicConfig=mall=>{const c=config(mall.id);return {configured:!!c,enabled:!!c?.enabled,hasWebhook:!!c?.webhook,paid:c?.paid??true,refund:c?.refund??true,currency:c?.currency||'',timeZone:c?.timeZone||'',pushAccount:c?.pushAccount||'',pushPassword:c?.pushPassword||'',records:db.prepare('SELECT id,kind,status,attempts,created,sent_at,error FROM notification_outbox WHERE mall_id=? ORDER BY created DESC LIMIT 30').all(mall.id)};};
 const save=(mall,input)=>{
  if(!['crmeb-pro','crmeb-store','tigshop'].includes(mall.system))throw Error('不支持的商城通知系统');
  for(const key of ['enabled','paid','refund'])if(typeof input[key]!=='boolean')throw Error('通知开关格式无效');
  const old=config(mall.id),webhook=input.webhook?wecomWebhook(input.webhook):old?.webhook;if(!webhook)throw Error('请填写企业微信群Webhook地址');
  if(old?.webhook&&webhook!==old.webhook&&db.prepare("SELECT 1 FROM notification_outbox WHERE mall_id=? AND status IN ('pending','paused','sending','uncertain') LIMIT 1").get(mall.id))throw Error('仍有未完成通知，请先处理通知记录后再更换接收群');
  if(old?.webhook&&webhook!==old.webhook&&db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='notification_native_inbox'").get()&&db.prepare("SELECT 1 FROM notification_native_inbox WHERE mall_id=? AND status IN ('pending','working','failed') LIMIT 1").get(mall.id))throw Error('仍有原生通知未处理，请先核对接收记录后再更换接收群');
  const settings=mall.system==='tigshop'?tigshopNotificationSettings({currency:input.currency??old?.currency,timeZone:input.timeZone??old?.timeZone}):{};
  if(old&&mall.system==='tigshop'&&(old.currency!==settings.currency||old.timeZone!==settings.timeZone)&&db.prepare("SELECT 1 FROM notification_outbox WHERE mall_id=? AND status IN ('pending','paused','sending','uncertain') LIMIT 1").get(mall.id))throw Error('仍有未完成通知，请先核对记录后更改币种或时区');
  store.set('notification:'+mall.id,{...old,...settings,webhook,enabled:input.enabled,paid:input.paid,refund:input.refund,pushAccount:old?.pushAccount||'ops_'+randomBytes(12).toString('hex'),pushPassword:old?.pushPassword||randomBytes(32).toString('hex'),signingKey:old?.signingKey||randomBytes(32).toString('hex')});
  for(const kind of ['paid','refund','test'])db.prepare("UPDATE notification_outbox SET status=? WHERE mall_id=? AND kind=? AND status=?").run(input.enabled&&(kind==='test'||input[kind])?'pending':'paused',mall.id,kind,input.enabled&&(kind==='test'||input[kind])?'paused':'pending');
  return publicConfig(mall);
 };
 const issueToken=(id,input)=>{const c=config(id);if(!c?.enabled||!['crmeb-pro','crmeb-store'].includes(findMall(id)?.system)||!equal(c.pushAccount,input.push_account)||!equal(c.pushPassword,input.push_password))throw Error('推送鉴权失败');const expiry=clock()+3600000,payload=String(expiry),sig=createHmac('sha256',c.signingKey).update(id+':'+payload).digest('hex');return {code:0,status:200,token:payload+'.'+sig,time:3500,data:{token:payload+'.'+sig,time:3500}};};
 const receive=(id,kind,token,data)=>{
  const c=config(id),mall=findMall(id),parts=String(token||'').split('.');
  if(!c?.enabled||!mall||!['crmeb-pro','crmeb-store'].includes(mall.system)||parts.length!==2||!/^\d{13}$/.test(parts[0])||Number(parts[0])<clock()||Number(parts[0])>clock()+3600000||!equal(parts[1],createHmac('sha256',c.signingKey).update(id+':'+parts[0]).digest('hex')))throw Error('推送鉴权失败');
  if(kind==='ignore')return {code:0};
  if(!['paid','refund'].includes(kind))throw Error('不支持的推送事件');
  if(!c[kind])return {code:0};
  // This release's refund_create_push fires from refund completion, not application.
  if(kind==='refund')return {code:0};
  const fact=notificationFact(kind,data),key=fact.id;
  db.prepare('INSERT OR IGNORE INTO notification_outbox(id,mall_id,kind,event_key,fact,next_at,created) VALUES(?,?,?,?,?,?,?)').run(randomBytes(12).toString('hex'),id,kind,key,JSON.stringify(fact),clock(),clock());return {code:0};
 };
 const enqueueCrmeb=(id,kind,data)=>{const c=config(id);if(!c?.enabled||!['paid','refund'].includes(kind)||!c[kind]||findMall(id)?.system!=='crmeb-store')throw Error('原生通知配置已变化');const fact=notificationFact(kind,data);db.prepare('INSERT OR IGNORE INTO notification_outbox(id,mall_id,kind,event_key,fact,next_at,created) VALUES(?,?,?,?,?,?,?)').run(randomBytes(12).toString('hex'),id,kind,fact.id,JSON.stringify(fact),clock(),clock());};
 const enqueueRefund=(id,data)=>{const c=config(id);if(!c?.enabled||!c.refund||!['crmeb-pro','crmeb-store'].includes(findMall(id)?.system))return;const fact=notificationFact('refund',data);db.prepare("INSERT OR IGNORE INTO notification_outbox(id,mall_id,kind,event_key,fact,next_at,created) VALUES(?,?,'refund',?,?,?,?)").run(randomBytes(12).toString('hex'),id,fact.id,JSON.stringify(fact),clock(),clock());};
 const enqueueTigshop=(id,kind,data,currency)=>{const c=config(id);if(!c?.enabled||!['paid','refund'].includes(kind)||!c[kind]||findMall(id)?.system!=='tigshop')return;if(currency!==c.currency)throw Error('通知基准币种已变化，请重新检查接口');const fact={...notificationFact(kind,data),currency};db.prepare('INSERT OR IGNORE INTO notification_outbox(id,mall_id,kind,event_key,fact,next_at,created) VALUES(?,?,?,?,?,?,?)').run(randomBytes(12).toString('hex'),id,kind,fact.id,JSON.stringify(fact),clock(),clock());};
 const test=mall=>{const c=config(mall.id);if(!c?.enabled)throw Error('请先保存并启用通知');if(db.prepare("SELECT 1 FROM notification_outbox WHERE mall_id=? AND kind='test' AND created>? LIMIT 1").get(mall.id,clock()-60000))throw Error('请等待一分钟后再发测试通知');const id=randomBytes(12).toString('hex');db.prepare("INSERT INTO notification_outbox(id,mall_id,kind,event_key,fact,next_at,created) VALUES(?,?,'test',?,'{}',?,?)").run(id,mall.id,id,clock(),clock());return {ok:true};};
 const retry=(mall,id)=>{const row=db.prepare("SELECT * FROM notification_outbox WHERE id=? AND mall_id=? AND status IN ('failed','uncertain')").get(id,mall.id);if(!row)throw Error('通知不可重试');db.prepare("UPDATE notification_outbox SET status='pending',attempts=0,next_at=?,error='' WHERE id=?").run(clock(),id);};
 const tick=async()=>{
  if(stopped||busy||clock()-lastAttempt<4000)return;busy=true;
  try{
   const rows=db.prepare("SELECT * FROM notification_outbox WHERE status='pending' AND next_at<=? ORDER BY CASE kind WHEN 'refund' THEN 0 ELSE 1 END,created,id LIMIT 100").all(clock());
   for(const row of rows){const c=config(row.mall_id),mall=findMall(row.mall_id);if(!c?.enabled||!mall||row.kind!=='test'&&!c[row.kind])continue;
    if(!db.prepare("UPDATE notification_outbox SET status='sending',attempts=attempts+1 WHERE id=? AND status='pending'").run(row.id).changes)continue;
    lastAttempt=clock();
    try{
     const response=await fetcher(wecomWebhook(c.webhook),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({msgtype:'text',text:{content:boundedText(notificationText(mall,row.kind,JSON.parse(row.fact),row.id))}}),redirect:'error',signal:AbortSignal.timeout(10000)});
     const raw=await response.text();if(raw.length>10000)throw Error('invalid_response');let data;try{data=JSON.parse(raw);}catch{throw Error('invalid_response');}
     if(!response.ok||typeof data.errcode!=='number')throw Error('invalid_response');
     if(data.errcode!==0){const attempts=row.attempts+1;db.prepare("UPDATE notification_outbox SET status=?,next_at=?,error=? WHERE id=?").run(attempts>=5?'failed':'pending',clock()+Math.min(3600000,30000*2**attempts),'企业微信拒绝发送，错误码 '+data.errcode,row.id);}
     else db.prepare("UPDATE notification_outbox SET status='sent',sent_at=?,error='' WHERE id=?").run(clock(),row.id);
    }catch{db.prepare("UPDATE notification_outbox SET status='uncertain',error='未收到明确发送回执，可能已送达；请核对群消息后手动重试' WHERE id=?").run(row.id);}
    break;
   }
  }finally{busy=false;}
 };
 return {publicConfig,save,issueToken,receive,enqueueCrmeb,enqueueRefund,enqueueTigshop,test,retry,tick,stop(){stopped=true;}};
}
