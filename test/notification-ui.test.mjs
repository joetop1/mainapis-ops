import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
test('两个商城通知表单及复制按钮独立，保存多门店不改会员表单',async()=>{
 const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8'),source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
 const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);assert.equal(ids.length,new Set(ids).size);
 const copies=[...html.matchAll(/data-notification-copy="([^"]+)"/g)].map(m=>({dataset:{notificationCopy:m[1]}}));assert.equal(copies.filter(b=>b.dataset.notificationCopy.startsWith('storeNotification')).length,4);
 const nodes=new Map(ids.map(id=>[id,{id,value:'',checked:false,disabled:false,textContent:'',innerHTML:'',querySelectorAll:()=>copies.filter(b=>id==='notificationDetails'?!b.dataset.notificationCopy.startsWith('store'):id==='storeNotificationDetails'?b.dataset.notificationCopy.startsWith('store'):false)}]));
 const config=(name)=>({enabled:true,paid:true,refund:true,hasWebhook:true,relayPaidUrl:'https://ops.example/native-'+name,relayPaidTemplate:'OPS_PAID|{order_id}',pushAccount:name,pushPassword:'fake-'+name,tokenUrl:'https://ops.example/'+name,records:[],refundPoll:{enabled:1},currency:name==='tig'?'EUR':'',timeZone:name==='tig'?'Asia/Shanghai':''}),calls=[];let clipboard='';
 const context=vm.createContext({$:s=>nodes.get(s.slice(1)),esc:String,date:()=>'',api:async(path,method,body)=>{calls.push({path,method,body});return config(path.includes('tigshop')?'tig':path.includes('crmeb-store')?'store':'member');},navigator:{clipboard:{writeText:async v=>clipboard=v}},confirm:()=>true});
 vm.runInContext(source.slice(source.indexOf('function notificationElement(')),context);
 context.renderNotifications(config('member'),'crmeb-pro');context.renderNotifications(config('store'),'crmeb-store');assert.equal(nodes.get('notificationPushAccount').value,'member');assert.equal(nodes.get('storeNotificationRelayPaidUrl').value,'https://ops.example/native-store');
 nodes.get('storeNotificationWebhook').value='fake-webhook';await nodes.get('storeNotificationForm').onsubmit({preventDefault(){},submitter:{disabled:false}});assert.equal(calls[0].path,'/api/connections/crmeb-store/notifications');assert.equal(calls[0].body.webhook,'fake-webhook');assert.equal(nodes.get('notificationPushAccount').value,'member');assert.equal(nodes.get('storeNotificationWebhook').value,'');
 await copies.find(b=>b.dataset.notificationCopy==='storeNotificationRelayPaidUrl').onclick();assert.equal(clipboard,'https://ops.example/native-store');
 context.renderNotifications(config('tig'),'tigshop');nodes.get('tigshopNotificationWebhook').value='tig-webhook';await nodes.get('tigshopNotificationForm').onsubmit({preventDefault(){},submitter:{disabled:false}});assert.equal(calls.at(-1).path,'/api/connections/tigshop/notifications');assert.equal(calls.at(-1).body.currency,'EUR');assert.equal(nodes.get('notificationPushAccount').value,'member');await nodes.get('tigshopNotificationRefundCheck').onclick();assert.equal(calls.at(-1).path,'/api/connections/tigshop/notifications/source-check');
});
