import test from 'node:test';
import assert from 'node:assert/strict';
import {openStore} from '../core.mjs';
import {crmebRefundPoll} from '../crmeb-refund-poll.mjs';
import {mallNotifications} from '../mall-notifications.mjs';
function setup(system='crmeb-pro'){
 const db=openStore(':memory:'),mall={id:'mall1',system},sent=new Map(),calls=[];let time=1720000000000,deny=false,broken=false,complete=false;
 const config={enabled:true,refund:true},refund={id:7,order_id:'RE7',store_order_id:10,store_order_sn:'WX10',refund_type:0,is_cancel:0,is_del:0,add_time:Math.floor(time/1000)-10,refund_price:'10.00',items:[{store_name:'商品',suk:'蓝色',cart_num:1}]};
 const fetcher=async(url,o)=>{calls.push({url,o});if(url.endsWith('access_token')||url.endsWith('get_token'))return {ok:true,text:async()=>JSON.stringify({status:200,data:{access_token:'fake-token'}})};assert.equal(o.method,'GET');assert.ok(url.includes('/outapi/refund/'));assert.equal(o.headers.Authorization,'Bearer fake-token');let data;if(deny)data={status:403,msg:'SECRET'};else if(url.includes('/refund/list?'))data={status:200,data:{list:[{...refund,refund_type:complete?6:0,refund_price:undefined,pay_price:'10.00'}],count:1}};else data={status:200,data:{...refund,store_order_sn:broken?'':refund.store_order_sn,refund_type:complete?6:0}};return {ok:true,text:async()=>JSON.stringify(data)};};
 const outbox=mallNotifications({db,store:{get:()=>config},findMall:()=>mall,clock:()=>time});
 const poll=crmebRefundPoll({db,getCredentials:()=>({appid:'app',appsecret:'secret',url:'https://shop.example.com'}),getNotificationConfig:()=>config,findMall:()=>mall,enqueue:outbox.enqueueRefund,fetcher,clock:()=>time});
 return {db,poll,calls,mall,config,refund,advance:n=>time+=n,deny:()=>deny=true,break:()=>broken=true,complete:()=>complete=true};
}
test('官方售后列表和详情只读补拉，恢复原订单号、读取申请金额并持久去重',async()=>{
 const t=setup();try{await t.poll.enable(t.mall);await t.poll.run('mall1',true);assert.ok(t.poll.state('mall1').last_success);const rows=t.db.prepare('SELECT * FROM notification_outbox').all();assert.equal(rows.length,1);const fact=JSON.parse(rows[0].fact);assert.equal(fact.orderNumber,'WX10');assert.equal(fact.amount,'10.00');t.advance(61000);await t.poll.tick();assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM notification_outbox').get().n,1);assert.ok(t.calls.filter(c=>!c.url.endsWith('access_token')).every(c=>c.o.method==='GET'));}finally{t.db.close();}
});
test('只通知尚未处理且最近24小时申请，退款完成不误报为新申请',async()=>{
 const t=setup();try{await t.poll.enable(t.mall);t.complete();await t.poll.run('mall1',true);assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM notification_outbox').get().n,0);}finally{t.db.close();}
 const old=setup();try{old.refund.add_time-=90000;await old.poll.enable(old.mall);await old.poll.run('mall1',true);assert.equal(old.db.prepare('SELECT COUNT(*) AS n FROM notification_outbox').get().n,0);}finally{old.db.close();}
});
test('接口权限不足可见且不推进检查进度，不泄漏商城原始响应',async()=>{
 const t=setup();try{await t.poll.enable(t.mall);t.deny();await t.poll.run('mall1');assert.equal(t.poll.state('mall1').last_success,0);assert.match(t.poll.state('mall1').error,/只读权限/);assert.ok(!t.poll.state('mall1').error.includes('SECRET'));}finally{t.db.close();}
});
test('缺少关联订单或关闭通知时不会错误入队',async()=>{
 const t=setup();try{t.break();await assert.rejects(t.poll.enable(t.mall),/关联订单/);assert.equal(t.poll.state('mall1').enabled,0);}finally{t.db.close();}
 const paused=setup();try{await paused.poll.enable(paused.mall);paused.config.enabled=false;await paused.poll.run('mall1');assert.equal(paused.db.prepare('SELECT COUNT(*) AS n FROM notification_outbox').get().n,0);}finally{paused.db.close();}
});
test('周期检查复用已保存进度，已入队申请不会重复通知',async()=>{
 const t=setup();try{await t.poll.enable(t.mall);await t.poll.run('mall1',true);const before=t.poll.state('mall1').last_success;t.advance(61000);await t.poll.tick();assert.ok(t.poll.state('mall1').last_success>before);assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM notification_outbox').get().n,1);}finally{t.db.close();}
});

test('多门店停用旧退款详情补拉，改用原生通知转接',async()=>{const t=setup('crmeb-store');try{await assert.rejects(t.poll.enable(t.mall),/原生企业微信通知转接/);assert.equal(t.calls.length,0);}finally{t.db.close();}});
