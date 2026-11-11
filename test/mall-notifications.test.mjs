import test from 'node:test';
import assert from 'node:assert/strict';
import {openStore} from '../core.mjs';
import {mallNotifications,notificationFact,wecomWebhook} from '../mall-notifications.mjs';
const webhook='https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abcde12345-abcde12345';
const order={id:12,order_id:'WX123',paid:1,pay_price:'10.50',pay_time:1720000000,real_name:'私人姓名',user_phone:'13812345678',user_address:'完整私人地址',items:[{store_name:'商品A',suk:'蓝色',cart_num:2}]};
function setup(fetcher=async()=>({ok:true,text:async()=>'{"errcode":0}'})){
 const db=openStore(':memory:'),values=new Map(),mall={id:'mall1',system:'crmeb-pro',name:'小蓝会员'},other={id:'mall2',system:'crmeb-pro',name:'其他会员'};let time=1720000000000;
 const service=mallNotifications({db,store:{get:k=>values.get(k),set:(k,v)=>values.set(k,v)},findMall:id=>id==='mall1'?mall:id==='mall2'?other:null,fetcher,clock:()=>time});
 const c=service.save(mall,{enabled:true,paid:true,refund:true,webhook});const token=service.issueToken(mall.id,{push_account:c.pushAccount,push_password:c.pushPassword}).token;
 return {db,service,mall,other,c,token,advance:n=>time+=n};
}
test('推送按商城鉴权、Token过期拒绝，事件去重且只保留通知必要字段',async()=>{
 const sent=[],t=setup(async(url,options)=>{sent.push({url,options});return {ok:true,text:async()=>'{"errcode":0}'};});try{
 assert.throws(()=>t.service.receive('mall2','paid',t.token,order));assert.throws(()=>t.service.issueToken('mall1',{push_account:t.c.pushAccount,push_password:'bad'}));assert.throws(()=>t.service.receive('mall1','paid','bad',order));
 assert.equal(t.service.receive('mall1','paid',t.token,order).code,0);t.service.receive('mall1','paid',t.token,{...order,pay_price:'100.00'});assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM notification_outbox').get().n,1);
 const stored=t.db.prepare('SELECT fact FROM notification_outbox').get().fact;for(const secret of ['私人姓名','13812345678','完整私人地址'])assert.ok(!stored.includes(secret));await t.service.tick();assert.equal(sent.length,1);assert.ok(sent[0].options.body.includes('蓝色'));assert.ok(sent[0].options.body.includes('10.50'));assert.equal(t.db.prepare('SELECT status FROM notification_outbox').get().status,'sent');t.advance(3600001);assert.throws(()=>t.service.receive('mall1','paid',t.token,order));
 }finally{t.db.close();}
});
test('申请退款与付款独立去重，不把申请标成退款到账，支持忽略非订阅事件',async()=>{
 const sent=[],t=setup(async(url,options)=>{sent.push(options.body);return {ok:true,text:async()=>'{"errcode":0}'};});try{
 t.service.receive('mall1','paid',t.token,order);const refund={...order,refund_price:'5.00',store_order_id:12,order:{order_id:'WX123'},refund_reason:'买错规格'};assert.equal(t.service.receive('mall1','refund',t.token,refund).code,0);assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM notification_outbox').get().n,1);t.service.enqueueRefund('mall1',refund);assert.equal(t.service.receive('mall1','ignore',t.token,{}).code,0);await t.service.tick();assert.ok(sent[0].includes('申请退款'));assert.ok(!sent[0].includes('已退款'));assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM notification_outbox').get().n,2);
 }finally{t.db.close();}
});
test('明确拒绝按退避重试，超时保留不确定，人工核对后可重新排队',async()=>{
 let mode='reject',calls=0;const t=setup(async()=>{calls++;if(mode==='timeout')throw Error('secret-url');return {ok:true,text:async()=>mode==='reject'?'{"errcode":93000}':'{"errcode":0}'};});try{
 t.service.receive('mall1','paid',t.token,order);await t.service.tick();assert.equal(t.db.prepare('SELECT status FROM notification_outbox').get().status,'pending');await t.service.tick();assert.equal(calls,1);t.advance(70000);mode='timeout';await t.service.tick();const row=t.db.prepare('SELECT * FROM notification_outbox').get();assert.equal(row.status,'uncertain');assert.ok(!row.error.includes('secret-url'));t.advance(70000);await t.service.tick();assert.equal(calls,2);t.service.retry(t.mall,row.id);mode='ok';await t.service.tick();assert.equal(t.db.prepare('SELECT status FROM notification_outbox').get().status,'sent');
 }finally{t.db.close();}
});
test('配置暂停保留队列，恢复后发送；消息长度受限且Webhook不能指定任意域名',async()=>{
 let body;const t=setup(async(url,o)=>{body=o.body;return {ok:true,text:async()=>'{"errcode":0}'};});try{
 for(const url of ['https://evil.example/cgi-bin/webhook/send?key=abcde12345-abcde12345','http://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abcde12345-abcde12345',webhook+'&other=1'])assert.throws(()=>wecomWebhook(url));
 t.service.receive('mall1','paid',t.token,{...order,items:Array.from({length:20},()=>({store_name:'长'.repeat(100),suk:'规格'.repeat(40),cart_num:2}))});t.service.save(t.mall,{enabled:false,paid:true,refund:true});await t.service.tick();assert.equal(body,undefined);assert.equal(t.db.prepare('SELECT status FROM notification_outbox').get().status,'paused');t.service.save(t.mall,{enabled:true,paid:true,refund:true});await t.service.tick();assert.ok(Buffer.byteLength(JSON.parse(body).text.content)<=2048);assert.ok(!t.service.publicConfig(t.mall).webhook);
 }finally{t.db.close();}
});
test('重启恢复发送中记录为需核对，不能把无效付款或无关联退款入队',()=>{
 const t=setup();try{assert.throws(()=>notificationFact('paid',{...order,paid:0}));assert.throws(()=>notificationFact('refund',{...order,refund_price:'1'}));t.service.receive('mall1','paid',t.token,order);t.db.exec("UPDATE notification_outbox SET status='sending'");mallNotifications({db:t.db,store:{get:()=>null},findMall:()=>null});assert.equal(t.db.prepare('SELECT status FROM notification_outbox').get().status,'uncertain');}finally{t.db.close();}
});
test('发送端明确拒绝最多尝试5次，记录失败；业务未完成时禁止更换群',async()=>{
 const t=setup(async()=>({ok:true,text:async()=>'{"errcode":40058}'}));try{t.service.receive('mall1','paid',t.token,order);assert.throws(()=>t.service.save(t.mall,{enabled:true,paid:true,refund:true,webhook:webhook.replace('abcde12345-abcde12345','other12345-other12345')}),/未完成通知/);for(let n=0;n<5;n++){await t.service.tick();t.advance(3600000);}const row=t.db.prepare('SELECT * FROM notification_outbox').get();assert.equal(row.status,'failed');assert.equal(row.attempts,5);assert.match(row.error,/40058/);}finally{t.db.close();}
});

test('会员与多门店可使用同一群但鉴权和记录隔离，不继承会员Webhook',()=>{const t=setup();try{t.other.system='crmeb-store';assert.equal(t.service.publicConfig(t.other).configured,false);const c=t.service.save(t.other,{webhook,enabled:true,paid:true,refund:true});assert.notEqual(c.pushPassword,t.c.pushPassword);const token=t.service.issueToken(t.other.id,{push_account:c.pushAccount,push_password:c.pushPassword}).token;assert.throws(()=>t.service.receive('mall2','paid',t.token,order));t.service.receive('mall1','paid',t.token,order);t.service.receive('mall2','paid',token,order);assert.equal(t.service.publicConfig(t.mall).records.length,1);assert.equal(t.service.publicConfig(t.other).records.length,1);}finally{t.db.close();}});

test('Tigshop 钉钉渠道发送加签订单摘要，不返回密钥',async()=>{
 const db=openStore(':memory:'),values=new Map(),mall={id:'tig1',system:'tigshop',name:'椰购'};
 const sent=[],clock=()=>1720000000000;
 const service=mallNotifications({db,store:{get:k=>values.get(k),set:(k,v)=>values.set(k,v)},findMall:()=>mall,clock,fetcher:async(url,options)=>{sent.push([new URL(url),JSON.parse(options.body)]);return {ok:true,text:async()=>'{"errcode":0}'};}});
 try{
  const dingSecret='SECabcdefghijklmnopqrst',saved=service.save(mall,{enabled:true,paid:true,refund:false,channel:'ding',currency:'EUR',timeZone:'Asia/Shanghai',webhook:'https://oapi.dingtalk.com/robot/send?access_token=abcdefghijklmnop',dingSecret});
  assert.equal(saved.hasDingSecret,true);assert.ok(!JSON.stringify(saved).includes(dingSecret));
  service.enqueueTigshop(mall.id,'paid',order,'EUR');await service.tick();
  assert.equal(sent.length,1);
  const [[url,payload]]=sent;
  assert.equal(url.origin,'https://oapi.dingtalk.com');assert.equal(url.searchParams.get('timestamp'),String(clock()));assert.ok(url.searchParams.get('sign'));
  assert.match(payload.text.content,/蓝色/);assert.match(payload.text.content,/EUR/);assert.doesNotMatch(payload.text.content,/13812345678|完整私人地址/);
 }finally{db.close();}
});
