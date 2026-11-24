import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Readable} from 'node:stream';
import {openStore} from '../core.mjs';
test('商城整理路由要求会话、CSRF、审核权限；所有者隔离，静态模块可加载',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ops-classification-routes-'));
 Object.assign(process.env,{DATA_DIR:dir,APP_ORIGIN:'https://ops.mainapis.com',DEMO_MODE:'false'});
 const {handler,closeStore}=await import('../server.mjs'),db=openStore(join(dir,'ops.sqlite'));
 const call=async(path,method='GET',data={},user='alice',csrf='csrf')=>{const req=Readable.from([Buffer.from(JSON.stringify(data))]);Object.assign(req,{url:path,method,headers:{cookie:user?'ops_session='+user:'',origin:'https://ops.mainapis.com','x-csrf-token':csrf,'content-type':'application/json'}});const res={status:200,setHeader(){},writeHead(s){this.status=s;},end(b){this.body=b;}};await handler(req,res);return {status:res.status,raw:String(res.body)};};
 for(const name of ['alice','bob'])db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(name,JSON.stringify({user:{sub:name,name},csrf:'csrf'}),Date.now()+60000);
 try{
  assert.equal((await call('/api/mall-classification/history','GET',{},'')).status,401);
  assert.equal((await call('/api/mall-classification/preview','POST',{},'alice','bad')).status,403);
  const team=await call('/api/team','POST',{name:'分类整理团队'});assert.equal(team.status,201);
  assert.equal((await call('/api/team/members','POST',{sub:'bob',role:'editor'})).status,200);
  assert.equal((await call('/api/mall-classification/preview','POST',{},'bob')).status,403);
  assert.equal((await call('/api/mall-classification/history','GET',{},'bob')).status,200);
  for(const action of ['submit','verify','rollback']){const r=await call('/api/mall-classification/plans/00000000-0000-4000-8000-000000000001/'+action,'POST',{});assert.equal(r.status,409);assert.match(r.raw,/只读/);}
  assert.equal((await call('/api/mall-classification/plans/00000000-0000-4000-8000-000000000001')).status,400);
  const asset=await call('/mall-classification.js');assert.equal(asset.status,200);assert.match(asset.raw,/setupMallClassification/);
  const html=await readFile('public/index.html','utf8'),app=await readFile('public/app.js','utf8');assert.match(html,/data-page="classification"/);assert.match(html,/id="classificationPlan"/);assert.match(app,/classificationPanel.open/);
 }finally{db.close();closeStore();await rm(dir,{recursive:true,force:true});}
});
