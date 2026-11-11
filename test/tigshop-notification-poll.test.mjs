import test from 'node:test';
import assert from 'node:assert/strict';
import {openStore} from '../core.mjs';
import {tigshopNotificationPoll,tigshopEventTime,tigshopNotificationSettings} from '../tigshop-notification-poll.mjs';
import {mallNotifications,notificationText} from '../mall-notifications.mjs';
const webhook='https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=tigshop-test-notify-12345678';
function setup(){
 const db=openStore(':memory:'),mall={id:'tigmall',system:'tigshop',name:'椰购YEGO'},config=new Map(),calls=[];let time=Date.UTC(2026,9,29,4,0,0),deny=false,repeat=false;
 const order={orderId:11,orderSn:'ORD11',shopId:0,payStatus:2,orderStatus:1,isValid:1,addTime:'2026-01-01 12:00:00',payTime:'2026-10-29 11:59:00',paidAmount:'29.90',userPhone:'13812345678',address:'私人完整地址',items:[{productName:'商品A',quantity:2,skuData:[{name:'型号',value:'A1'}]}]};
 const refund={aftersaleId:21,aftersalesSn:'REF21',orderId:11,orderSn:'ORD11',shopId:0,status:1,aftersaleType:2,addTime:'2026-10-29 11:58:00',refundAmount:'14.95',aftersaleReason:'买错型号',aftersalesItems:[{orderId:11,productName:'商品A',number:1,quantity:2,skuData:[{name:'型号',value:'A1'}]}]};
 const rows={paid:[order],refund:[refund]},credentials={url:'https://tigshop.example.com',token:'a'.repeat(32)};
 const fetcher=async(url,options)=>{calls.push({url,options});assert.equal(options.method,'GET');assert.equal(options.redirect,'error');assert.equal(options.headers['X-Api-Token'],'a'.repeat(32));assert.equal(options.headers['X-ADMIN-TYPE'],'admin');const path=new URL(url).pathname;let data;
  if(path==='/adminapi/order/order/list'){assert.equal(new URL(url).searchParams.get('sortField'),'payTime');data={records:rows.paid,total:repeat?2000:rows.paid.length};}
  else if(path==='/adminapi/order/aftersales/list')data={records:rows.refund,total:rows.refund.length};
  else if(path==='/adminapi/order/order/detail')data=order;
  else if(path==='/adminapi/order/aftersales/detail')data=refund;
  else throw Error('unapproved endpoint');return {ok:!deny,status:deny?403:200,text:async()=>JSON.stringify(deny?{code:401,message:'private-token'}:{code:0,data})};
 };
 const settings={webhook,enabled:true,paid:true,refund:true,currency:'EUR',timeZone:'Asia/Shanghai'},store={get:key=>config.get(key),set:(key,value)=>config.set(key,value)};
 const notify=mallNotifications({db,store,findMall:id=>id===mall.id?mall:null,clock:()=>time});notify.save(mall,settings);
 const poll=tigshopNotificationPoll({db,getCredentials:()=>credentials,getNotificationConfig:id=>config.get('notification:'+id),findMall:id=>id===mall.id?mall:null,enqueue:notify.enqueueTigshop,fetcher,clock:()=>time});
 return {db,mall,notify,poll,order,refund,rows,calls,credentials,config,advance:n=>time+=n,deny:()=>deny=true,repeat:()=>repeat=true};
}
test('Tigshop日期按显式时区转换，币种时区不能猜，拒绝夏令时歧义',()=>{
 assert.equal(tigshopEventTime('2026-10-29 12:00:00','Asia/Shanghai'),Date.UTC(2026,9,29,4));assert.equal(tigshopEventTime('2026-10-29 12:00:00','UTC'),Date.UTC(2026,9,29,12));assert.throws(()=>tigshopNotificationSettings({}),/币种/);assert.throws(()=>tigshopNotificationSettings({currency:'EUR'}),/时区/);assert.throws(()=>tigshopEventTime('2026-10-25 02:30:00','Europe/Berlin'),/夏令时/);assert.throws(()=>tigshopEventTime('2026-03-29 02:30:00','Europe/Berlin'),/时区/);assert.throws(()=>tigshopEventTime('2026-02-30 12:00:00','UTC'),/时区/);
});
test('自营付款和客户售后只读检查，使用实付及申请金额、正确退款数量、基准币种，不保留个人地址',async()=>{
 const t=setup();try{await t.poll.enable(t.mall);await t.poll.checkNow(t.mall.id);const records=t.db.prepare('SELECT * FROM notification_outbox ORDER BY kind').all();assert.equal(records.length,2);const paid=JSON.parse(records.find(r=>r.kind==='paid').fact),refund=JSON.parse(records.find(r=>r.kind==='refund').fact);assert.equal(paid.amount,'29.90');assert.equal(paid.currency,'EUR');assert.equal(paid.items[0].spec,'型号：A1');assert.equal(refund.items[0].quantity,'1');assert.equal(refund.orderNumber,'ORD11');assert.equal(refund.amount,'14.95');assert.ok(notificationText(t.mall,'paid',paid).includes('EUR 29.90'));assert.ok(!JSON.stringify(records).includes('私人完整地址'));assert.ok(!JSON.stringify(records).includes('13812345678'));assert.ok(t.poll.state(t.mall.id).paid.last_success);assert.ok(t.poll.state(t.mall.id).refund.last_success);t.advance(61000);await t.poll.tick();assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM notification_outbox').get().n,2);assert.ok(t.calls.every(c=>c.options.method==='GET'));}finally{t.db.close();}
});
test('列表即使返回其他商户也不通知，不信任shopId=0查询过滤',async()=>{
 const t=setup();try{t.order.shopId=8;t.refund.shopId=8;await t.poll.enable(t.mall);await t.poll.checkNow(t.mall.id);assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM notification_outbox').get().n,0);assert.ok(!t.calls.some(c=>c.url.includes('/detail?')));}finally{t.db.close();}
});
test('支付中与已处理售后不当成付款或退款申请，退款走客户售后而非财务退款接口',async()=>{
 const t=setup();try{t.order.payStatus=1;t.refund.status=6;await t.poll.enable(t.mall);await t.poll.checkNow(t.mall.id);assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM notification_outbox').get().n,0);assert.ok(!t.calls.some(c=>c.url.includes('/finance/')));}finally{t.db.close();}
});
test('详情自营归属或关联订单不匹配时预检拒绝启用',async()=>{
 const t=setup();try{t.rows.paid=[{...t.order}];t.order.shopId=5;await assert.rejects(t.poll.enable(t.mall),/自营/);assert.equal(t.poll.state(t.mall.id).paid.enabled,0);}finally{t.db.close();}
 const r=setup();try{r.rows.refund=[{...r.refund,orderSn:'WRONG'}];await assert.rejects(r.poll.enable(r.mall),/关联订单/);}finally{r.db.close();}
});
test('缺权限和时区错误可见且不推进成功进度，地址改变不发送Token到新域名',async()=>{
 const t=setup();try{await t.poll.enable(t.mall);t.deny();await t.poll.run(t.mall.id,'paid');assert.match(t.poll.state(t.mall.id).paid.error,/权限/);assert.equal(t.poll.state(t.mall.id).paid.last_success,0);assert.ok(!t.poll.state(t.mall.id).paid.error.includes('private-token'));}finally{t.db.close();}
 const z=setup();try{z.notify.save(z.mall,{enabled:true,paid:true,refund:true,currency:'EUR',timeZone:'UTC'});await assert.rejects(z.poll.enable(z.mall),/时区/);assert.equal(z.poll.state(z.mall.id).paid.enabled,0);assert.equal(z.db.prepare('SELECT COUNT(*) AS n FROM notification_outbox').get().n,0);}finally{z.db.close();}
 const changed=setup();try{await changed.poll.enable(changed.mall);const n=changed.calls.length;changed.credentials.url='https://new.example.com';await changed.poll.run(changed.mall.id,'paid');assert.equal(changed.calls.length,n);assert.match(changed.poll.state(changed.mall.id).paid.error,/地址/);}finally{changed.db.close();}
});
test('重复分页和扫描上限不推进检查时间，已入队不会重复',async()=>{
 const t=setup();try{await t.poll.enable(t.mall);t.repeat();await t.poll.run(t.mall.id,'paid');assert.match(t.poll.state(t.mall.id).paid.error,/20页/);assert.equal(t.poll.state(t.mall.id).paid.last_success,0);assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM notification_outbox').get().n,1);}finally{t.db.close();}
});
test('跨日旧订单新付款按付款时间捕获；失效拆单父订单不重复提醒',async()=>{
 const t=setup();try{await t.poll.enable(t.mall);await t.poll.run(t.mall.id,'paid',true);assert.equal(t.db.prepare("SELECT COUNT(*) AS n FROM notification_outbox WHERE kind='paid'").get().n,1);assert.ok(t.order.addTime.startsWith('2026-01'));}finally{t.db.close();}
 const invalid=setup();try{invalid.order.isValid=0;await invalid.poll.enable(invalid.mall);await invalid.poll.run(invalid.mall.id,'paid',true);assert.equal(invalid.db.prepare('SELECT COUNT(*) AS n FROM notification_outbox').get().n,0);assert.ok(invalid.poll.state(invalid.mall.id).paid.last_success);}finally{invalid.db.close();}
});
test('暂停后不读取也不入队，退款已拒绝或取消不作为新申请',async()=>{
 const t=setup();try{await t.poll.enable(t.mall);t.notify.save(t.mall,{enabled:false,paid:true,refund:true});const before=t.calls.length;await t.poll.checkNow(t.mall.id);assert.equal(t.calls.length,before);assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM notification_outbox').get().n,0);}finally{t.db.close();}
 for(const status of [3,7]){const r=setup();try{r.refund.status=status;await r.poll.enable(r.mall);await r.poll.run(r.mall.id,'refund',true);assert.equal(r.db.prepare('SELECT COUNT(*) AS n FROM notification_outbox').get().n,0);}finally{r.db.close();}}
});
test('币种改变必须重新预检，Tigshop不能误用CRMEB推送令牌入口',async()=>{
 const t=setup();try{await t.poll.enable(t.mall);const c=t.notify.publicConfig(t.mall);assert.throws(()=>t.notify.issueToken(t.mall.id,{push_account:c.pushAccount,push_password:c.pushPassword}),/鉴权/);t.notify.save(t.mall,{enabled:true,paid:true,refund:true,currency:'USD',timeZone:'Asia/Shanghai'});const before=t.calls.length;await t.poll.run(t.mall.id,'paid');assert.equal(t.calls.length,before);assert.match(t.poll.state(t.mall.id).paid.error,/币种/);assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM notification_outbox').get().n,0);}finally{t.db.close();}
});
