import test from 'node:test';
import assert from 'node:assert/strict';
import {onboardingStatus} from '../onboarding.mjs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {openStore} from '../core.mjs';
const base={team:null,malls:[],productCount:0,publishedCount:0,billing:{enabled:false,account:{exempt:false,available:0}},storage:{active:false,exempt:false,limitBytes:0,storedBytes:0,reservedBytes:0}};
test('首次开通四步与可选存储分离，未配置商城不算完成，不返回凭据',()=>{const result=onboardingStatus({...base,malls:[{configured:false,appsecret:'secret'}]});assert.equal(result.completed,0);assert.equal(result.total,4);assert.equal(result.approvalRequired,true);assert.equal(result.billing.enabled,false);assert.equal(JSON.stringify(result).includes('secret'),false);assert.equal(result.steps.find(s=>s.id==='mall').done,false);});
test('团队编辑看见实际共享进度并被引导联系管理员，套餐不影响完成数',()=>{const result=onboardingStatus({...base,team:{name:'团队',role:'editor'},malls:[{configured:true}],productCount:4,publishedCount:1});assert.equal(result.completed,4);assert.equal(result.admin,false);assert.equal(result.storage.active,false);assert.equal(result.workspace,'团队');assert.match(result.steps[0].detail,/团队/);});
test('开通进度API只读且隔离当前空间，未登录拒绝，团队共用进度',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ops-onboarding-'));Object.assign(process.env,{DATA_DIR:dir,APP_ORIGIN:'https://ops.mainapis.com',DEMO_MODE:'false',ALLOWED_SUBJECTS:'root,alice,bob',SYSTEM_ADMIN_SUBJECTS:'root'});const {handler,closeStore}=await import('../server.mjs'),db=openStore(join(dir,'ops.sqlite'));
 for(const sub of ['root','alice','bob'])db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(sub,JSON.stringify({user:{sub},csrf:'csrf'}),Date.now()+60000);
 const call=async(sub,path='/api/onboarding')=>{const req=Readable.from([]);Object.assign(req,{url:path,method:'GET',headers:{cookie:'ops_session='+sub}});const res={setHeader(){},writeHead(status){this.status=status;},end(data){this.data=JSON.parse(data);}};await handler(req,res);return res;};
 try{assert.equal((await call('unknown')).status,401);db.prepare('INSERT INTO products VALUES(?,?,?,?,?,?,?,?)').run('p','alice','source','{}','draft',1,'now','now');assert.equal((await call('alice','/api/onboarding?owner=bob')).data.steps[2].done,true);assert.equal((await call('bob','/api/onboarding?owner=alice')).data.steps[2].done,false);db.prepare("INSERT INTO teams VALUES('team:test','运营团队','alice','now')").run();db.prepare("INSERT INTO team_members VALUES('alice','team:test','admin',1)").run();db.prepare("INSERT INTO team_members VALUES('bob','team:test','editor',1)").run();db.prepare("UPDATE products SET owner='team:test'").run();const result=await call('bob');assert.equal(result.status,200);assert.equal(result.data.steps[2].done,true);assert.equal(result.data.admin,false);assert.equal(result.data.workspace,'运营团队');assert.equal(db.prepare('SELECT enabled FROM billing_settings').get().enabled,0);}finally{db.close();closeStore();await rm(dir,{recursive:true,force:true});}
});
