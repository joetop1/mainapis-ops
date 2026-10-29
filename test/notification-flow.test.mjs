import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {openStore} from '../core.mjs';
const webhook='https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abcde12345-abcde12345';
test('会员通知配置加密且受CSRF和管理员保护，原生GET测试和POST推送协议兼容，不依赖登录Cookie',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ops-notification-flow-'));Object.assign(process.env,{DATA_DIR:dir,APP_ORIGIN:'https://ops.mainapis.com',DEMO_MODE:'false'});
 const {handler,closeStore}=await import('../server.mjs'),db=openStore(join(dir,'ops.sqlite'));
 const call=async(path,method='GET',body={},actor='alice',csrf='csrf')=>{const req=Readable.from(method==='GET'?[]:[Buffer.from(JSON.stringify(body))]);Object.assign(req,{url:path,method,headers:{...(actor?{cookie:'ops_session='+actor}:{}),'content-type':'application/json',origin:'https://ops.mainapis.com','x-csrf-token':csrf}});const res={status:200,setHeader(){},writeHead(s){this.status=s;},end(b){this.body=b;}};await handler(req,res);return {status:res.status,data:JSON.parse(res.body)};};
 try{
  for(const sub of ['alice','bob','eve'])db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(sub,JSON.stringify({user:{sub,name:sub},csrf:'csrf'}),Date.now()+60000);
  await call('/api/team','POST',{name:'通知团队'});await call('/api/team/members','POST',{sub:'bob',role:'reviewer',active:1});
  const path='/api/connections/crmeb-pro/notifications';assert.equal((await call(path,'GET',{},'bob')).status,403);assert.equal((await call(path,'POST',{webhook},'alice','wrong')).status,403);
  const saved=await call(path,'POST',{webhook,enabled:true,paid:true,refund:true});assert.equal(saved.status,200);assert.ok(saved.data.pushPassword);assert.equal(saved.data.webhook,undefined);assert.ok(!db.prepare('SELECT encrypted FROM connections_notifications').get().encrypted.includes('abcde12345'));
  const tokenPath=new URL(saved.data.tokenUrl).pathname,credentials={push_account:saved.data.pushAccount,push_password:saved.data.pushPassword};
  const getToken=await call(tokenPath+'?'+new URLSearchParams(credentials),'GET',{},'');assert.equal(getToken.data.status,200);assert.equal(getToken.data.code,0);assert.equal(getToken.data.data.token,getToken.data.token);
  const postToken=await call(tokenPath,'POST',credentials,'');assert.equal(postToken.data.code,0);const paidPath=new URL(saved.data.paidUrl).pathname+'?pushToken='+postToken.data.token;
  const order={id:3,order_id:'WX3',paid:1,pay_price:'10.00',items:[{store_name:'商品',suk:'型号',cart_num:1}],user_phone:'13812345678'};
  assert.equal((await call(paidPath,'POST',order,'')).data.code,0);await call(paidPath,'POST',order,'');assert.equal(db.prepare('SELECT COUNT(*) AS n FROM notification_outbox').get().n,1);
  assert.equal((await call(new URL(saved.data.paidUrl).pathname+'?pushToken=bad','POST',order,'')).status,400);
  const stranger=await call(path,'GET',{},'eve');assert.equal(stranger.data.configured,false);assert.equal(stranger.data.records.length,0);assert.notEqual(stranger.data.paidUrl,saved.data.paidUrl);
  const read=await call(path);assert.equal(read.data.records.length,1);assert.ok(!JSON.stringify(read.data.records).includes('13812345678'));
  assert.equal((await call(path+'/test','POST')).status,200);assert.equal((await call(path+'/test','POST')).status,400);
 }finally{closeStore();db.close();await rm(dir,{recursive:true,force:true});}
});
