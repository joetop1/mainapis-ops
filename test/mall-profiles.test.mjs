import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {openStore} from '../core.mjs';
test('商城名称独立于固定系统、按团队隔离、管理员修改且迁移保留',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ops-mall-profiles-'));Object.assign(process.env,{DATA_DIR:dir,APP_ORIGIN:'https://ops.mainapis.com',DEMO_MODE:'false'});
 const {handler,closeStore}=await import('../server.mjs'),db=openStore(join(dir,'ops.sqlite'));
 for(const sub of ['alice','bob','outsider'])db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(sub,JSON.stringify({user:{sub},csrf:'csrf'}),Date.now()+60000);
 const call=async(path,method='GET',data={},sub='alice')=>{
  const req=Readable.from([Buffer.from(JSON.stringify(data))]);Object.assign(req,{url:path,method,headers:{cookie:'ops_session='+sub,origin:'https://ops.mainapis.com','x-csrf-token':'csrf','content-type':'application/json'}});
  const res={status:200,setHeader(){},writeHead(status){this.status=status;},end(body){this.body=body;}};await handler(req,res);return {status:res.status,data:JSON.parse(res.body)};
 };
 const target=async(sub='alice')=>(await call('/api/state','GET',{},sub)).data.targets.find(t=>t.id==='crmeb-store');
 try{
  const before=await target();assert.equal(before.system,'CRMEB 多门店');
  assert.equal((await call('/api/connections/crmeb-store/profile','POST',{name:'小蓝有品',system:'other'})).status,200);
  const after=await target();assert.equal(after.name,'小蓝有品');assert.equal(after.system,before.system);assert.equal(after.id,before.id);assert.equal(after.configured,before.configured);
  assert.equal((await target('outsider')).name,'CRMEB 多门店');
  for(const name of ['', 'x'.repeat(51),'bad\nname'])assert.equal((await call('/api/connections/crmeb-store/profile','POST',{name})).status,400);
  await call('/api/team','POST',{name:'团队'});await call('/api/team/members','POST',{sub:'bob',role:'editor'});
  assert.equal((await target('bob')).name,'小蓝有品');
  assert.equal((await call('/api/connections/crmeb-store/profile','POST',{name:'非法改名'},'bob')).status,403);
  assert.equal((await target()).name,'小蓝有品');
 }finally{db.close();closeStore();await rm(dir,{recursive:true,force:true});}
});
