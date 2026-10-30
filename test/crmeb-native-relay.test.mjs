import test from 'node:test';
import assert from 'node:assert/strict';
import {openStore} from '../core.mjs';
import {mallNotifications} from '../mall-notifications.mjs';
import {crmebNativeRelay} from '../crmeb-native-relay.mjs';
function setup(){
 const db=openStore(':memory:'),mall={id:'mall-12345678',system:'crmeb-store',name:'多门店'},other={id:'mall-87654321',system:'crmeb-store'},configs=new Map(),calls=[];
 let time=1793300000000,origin='https://shop.example.com',deny=false,badOrder=false,badAmount=false,empty=false,endless=false;
 const order={id:10,order_id:'wx123',paid:1,pay_price:'88.00',pay_time:Math.floor(time/1000),items:[{store_name:'商品A',suk:'白色 / L',cart_num:2}],user_phone:'13812345678',user_address:'PRIVATE_ADDRESS'};
 const refunds=[{id:71,order_id:'RE71',store_order_id:10,refund_type:0,is_cancel:0,is_del:0,add_time:Math.floor(time/1000)-1,pay_price:'12.00',refund_reason:'不需要了',items:[{store_name:'商品A',suk:'白色 / L',cart_num:1}]}];
 const notifications=mallNotifications({db,store:{get:k=>configs.get(k),set:(k,v)=>configs.set(k,v)},findMall:id=>id===mall.id?mall:other,clock:()=>time});
 for(const m of [mall,other])notifications.save(m,{enabled:true,paid:true,refund:true,webhook:'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=test1234567890test'});
 const config=()=>configs.get('notification:'+mall.id);
 const fetcher=async(url,o)=>{calls.push({url,o});let data;
  if(url.endsWith('/outapi/get_token'))return {ok:true,text:async()=>JSON.stringify({status:200,data:{access_token:'fake-token'}})};
  assert.equal(o.method,'GET');assert.equal(o.headers.Authorization,'Bearer fake-token');
  if(deny)return {ok:false,status:500,text:async()=>'SECRET_RESPONSE'};
  if(url.includes('/refund/list?'))data={list:endless?[{...refunds[0],id:100+Number(new URL(url).searchParams.get('page')),store_order_id:99}]:empty?[]:refunds.map(r=>({...r,pay_price:badAmount?undefined:r.pay_price})),count:endless?10000:empty?0:refunds.length};
  else if(url.includes('/order/list?'))data={list:[order],count:1};
  else if(url.endsWith('/order/wx123'))data={...order,id:badOrder?999:order.id};
  else throw Error('Unexpected URL');
  return {ok:true,text:async()=>JSON.stringify({status:200,data})};
 };
 const relay=crmebNativeRelay({db,findMall:id=>id===mall.id?mall:other,getConfig:id=>configs.get('notification:'+id),getCredentials:()=>({url:origin,appid:'app',appsecret:'secret'}),enqueue:notifications.enqueueCrmeb,fetcher,clock:()=>time});
 const receive=(kind='paid',sn='wx123',secret)=>relay.receive(mall.id,kind,secret??new URL(relay.meta(mall,'https://ops.example.com')[kind==='paid'?'relayPaidUrl':'relayRefundUrl']).searchParams.get('key'),{msgtype:'markdown',markdown:{content:'OPS_'+kind.toUpperCase()+'|'+sn}});
 return {db,mall,other,notifications,relay,receive,fetcher,calls,order,refunds,config,advance:n=>time+=n,deny:()=>deny=true,badOrder:()=>badOrder=true,badAmount:()=>badAmount=true,empty:()=>empty=true,endless:()=>endless=true,origin:v=>origin=v};
}
test('原生任务格式持久接收，按商城/事件鉴权，拒绝模板注入及跨商城密钥',()=>{
 const t=setup();try{assert.deepEqual(t.receive(),{errcode:0,errmsg:'ok'});t.receive();assert.equal(t.db.prepare('SELECT COUNT(*) n FROM notification_native_inbox').get().n,1);
 const foreign=new URL(t.relay.meta(t.other,'https://ops.example.com').relayPaidUrl).searchParams.get('key');assert.throws(()=>t.receive('paid','wx123',foreign),/鉴权/);assert.throws(()=>t.receive('refund','wx123',new URL(t.relay.meta(t.mall,'https://ops.example.com').relayPaidUrl).searchParams.get('key')),/鉴权/);assert.throws(()=>t.receive('paid','wx123\nhttps://evil.example'),/模板/);assert.equal(t.calls.length,0);
 }finally{t.db.close();}
});
test('付款补齐商品规格金额，只读且重复事件按业务ID去重，不保存联系方式',async()=>{
 const t=setup();try{await t.relay.check(t.mall);t.receive();t.advance(4000);await t.relay.tick();t.receive();t.advance(4000);await t.relay.tick();const rows=t.db.prepare('SELECT * FROM notification_outbox').all();assert.equal(rows.length,1);const fact=JSON.parse(rows[0].fact);assert.equal(fact.amount,'88.00');assert.equal(fact.items[0].spec,'白色 / L');assert.equal(fact.items[0].quantity,'2');assert.ok(!JSON.stringify(rows).includes('PRIVATE_ADDRESS'));assert.equal(t.relay.meta(t.mall,'https://ops.example.com').relayRecords[0].status,'done');assert.ok(!t.calls.some(c=>c.url.includes('/outapi/refund/wx123')));}finally{t.db.close();}
});
test('退款只取匹配原订单的未处理售后申请金额，同一订单后续新申请仍可接收',async()=>{
 const t=setup();try{t.refunds.push({...t.refunds[0],id:72,order_id:'RE72',store_order_id:99});t.refunds.push({...t.refunds[0],id:73,order_id:'RE73',refund_type:6});t.receive('refund');t.advance(4000);await t.relay.tick();let rows=t.db.prepare('SELECT * FROM notification_outbox').all();assert.equal(rows.length,1);assert.equal(JSON.parse(rows[0].fact).amount,'12.00');assert.equal(JSON.parse(rows[0].fact).orderNumber,'wx123');t.refunds.push({...t.refunds[0],id:74,order_id:'RE74'});t.receive('refund');t.advance(4000);await t.relay.tick();rows=t.db.prepare('SELECT * FROM notification_outbox').all();assert.equal(rows.length,2);assert.ok(!t.calls.some(c=>/\/refund\/(?!list)/.test(c.url)));}finally{t.db.close();}
});
test('HTTP500自动重试至可见失败，权限错误不泄漏响应且可人工恢复读取',async()=>{
 const t=setup();try{t.receive();t.deny();for(let i=0;i<8;i++){t.advance(3600001);await t.relay.tick();}const row=t.relay.meta(t.mall,'https://ops.example.com').relayRecords[0];assert.equal(row.status,'failed');assert.equal(row.attempts,8);assert.match(row.error,/HTTP 500/);assert.ok(!row.error.includes('SECRET_RESPONSE'));t.relay.retry(t.mall,row.id);assert.equal(t.relay.meta(t.mall,'https://ops.example.com').relayRecords[0].status,'pending');assert.equal(t.db.prepare('SELECT COUNT(*) n FROM notification_outbox').get().n,0);}finally{t.db.close();}
});
test('订单ID错配、退款金额缺失、已处理无申请、地址变更均不发送',async()=>{
 for(const mode of ['badOrder','badAmount','empty','origin']){const t=setup();try{t.receive('refund');if(mode==='origin')t.origin('https://other.example.com');else t[mode]();t.advance(4000);await t.relay.tick();assert.equal(t.db.prepare('SELECT COUNT(*) n FROM notification_outbox').get().n,0);assert.ok(t.relay.meta(t.mall,'https://ops.example.com').relayRecords[0].error);if(mode==='origin')assert.equal(t.calls.length,0);}finally{t.db.close();}}
});
test('关闭通知不读取，恢复后继续处理已持久化收件',async()=>{
 const t=setup();try{t.receive();t.config().enabled=false;t.advance(4000);await t.relay.tick();assert.equal(t.calls.length,0);t.config().enabled=true;await t.relay.tick();assert.equal(t.db.prepare('SELECT COUNT(*) n FROM notification_outbox').get().n,1);assert.equal(t.db.prepare("SELECT COUNT(*) n FROM notification_native_inbox WHERE status='done'").get().n,1);}finally{t.db.close();}
});

test('收件后重启恢复working记录，入队事务失败不留下部分消息',async()=>{
 const t=setup();try{t.receive();t.db.prepare("UPDATE notification_native_inbox SET status='working'").run();t.relay.stop();
 const fresh=crmebNativeRelay({db:t.db,findMall:()=>t.mall,getConfig:t.config,getCredentials:()=>({url:'https://shop.example.com',appid:'app',appsecret:'secret'}),enqueue:t.notifications.enqueueCrmeb,fetcher:t.fetcher,clock:()=>1793300004000});
 assert.equal(fresh.meta(t.mall,'https://ops.example.com').relayRecords[0].status,'pending');
 t.db.exec("CREATE TRIGGER fail_enqueue BEFORE INSERT ON notification_outbox BEGIN SELECT RAISE(ABORT,'queue_write_failed'); END");await fresh.tick();assert.equal(t.db.prepare('SELECT COUNT(*) n FROM notification_outbox').get().n,0);assert.notEqual(fresh.meta(t.mall,'https://ops.example.com').relayRecords[0].status,'done');
 t.db.exec('DROP TRIGGER fail_enqueue');t.db.prepare('UPDATE notification_native_inbox SET next_at=0').run();await fresh.tick();assert.equal(t.db.prepare('SELECT COUNT(*) n FROM notification_outbox').get().n,1);
 }finally{t.db.close();}
});
test('售后扫描达到20页不发部分结果，未处理收件禁止换群',async()=>{
 const t=setup();try{t.receive('refund');assert.throws(()=>t.notifications.save(t.mall,{enabled:true,paid:true,refund:true,webhook:'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=other1234567890test'}),/原生通知未处理/);t.endless();t.advance(4000);await t.relay.tick();assert.match(t.relay.meta(t.mall,'https://ops.example.com').relayRecords[0].error,/20页/);assert.equal(t.calls.filter(c=>c.url.includes('/refund/list?')).length,20);assert.equal(t.db.prepare('SELECT COUNT(*) n FROM notification_outbox').get().n,0);}finally{t.db.close();}
});
