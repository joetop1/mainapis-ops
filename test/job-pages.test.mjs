import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {openStore} from '../core.mjs';
import {connectionStore} from '../connection-store.mjs';
test('发布记录按工作空间服务端分页超过300条，草稿连接不继承配置且测试不保存',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ops-job-pages-'));Object.assign(process.env,{DATA_DIR:dir,APP_ORIGIN:'https://ops.mainapis.com',DEMO_MODE:'false'});
 const original=globalThis.fetch;globalThis.fetch=async()=>({ok:true,text:async()=>JSON.stringify({result:1,data:{data:[],last_page:1}})});
 const {handler,closeStore}=await import('../server.mjs'),db=openStore(join(dir,'ops.sqlite'));
 for(const sub of ['alice','outsider'])db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(sub,JSON.stringify({user:{sub},csrf:'csrf'}),Date.now()+60000);
 const call=async(path,method='GET',data={},sub='alice')=>{const req=Readable.from([Buffer.from(JSON.stringify(data))]);Object.assign(req,{url:path,method,headers:{cookie:'ops_session='+sub,origin:'https://ops.mainapis.com','x-csrf-token':'csrf','content-type':'application/json'}});const res={status:200,setHeader(){},writeHead(s){this.status=s;},end(b){this.body=b;}};await handler(req,res);return {status:res.status,data:JSON.parse(res.body)};};
 try{
  const store=await connectionStore(db,dir,'yunzhong');store.set('alice',{appid:'old',appsecret:'old-secret',mode:'bridge',publishingReady:true});
  const draft=(await call('/api/malls','POST',{system:'yunzhong',name:'未配置'})).data.connection;
  assert.equal((await call('/api/state')).data.malls.find(m=>m.id===draft.id).configured,false);
  await call('/api/connections/yunzhong/test?connection_id='+draft.id,'POST',{url:'https://draft.example.com',appid:'123',appsecret:'test-secret',mode:'official',categoryLevel:2,dispatchPrice:'0'});
  assert.equal((await call('/api/state')).data.malls.find(m=>m.id===draft.id).configured,false);
  db.prepare('INSERT INTO products VALUES(?,?,?,?,?,?,?,?)').run('p','alice','s',JSON.stringify({title:'历史商品',images:[],skus:[]}),'approved',1,'then','then');
  const insert=db.prepare('INSERT INTO jobs(id,owner,product_id,revision,target,status,token,created,updated) VALUES(?,?,?,?,?,?,?,?,?)');
  for(let n=0;n<345;n++)insert.run(String(n).padStart(4,'0'),'alice','p',n,'yunzhong','failed','token',String(n).padStart(4,'0'),'then');
  const first=await call('/api/jobs?page=1&page_size=20');assert.equal(first.data.total,345);assert.equal(first.data.rows.length,20);assert.equal(first.data.rows[0].id,'0344');assert.equal(first.data.rows[0].product_title,'历史商品');assert.equal(JSON.stringify(first.data).includes('token'),false);
  const last=await call('/api/jobs?page=999&page_size=20');assert.equal(last.data.page,18);assert.equal(last.data.rows.length,5);assert.equal(last.data.rows.at(-1).id,'0000');
  assert.equal((await call('/api/jobs?page=1&page_size=100')).data.rows.length,100);
  assert.equal((await call('/api/jobs','GET',{},'outsider')).data.total,0);
  assert.equal((await call('/api/jobs','GET',{},'not-logged-in')).status,401);
 }finally{globalThis.fetch=original;db.close();closeStore();await rm(dir,{recursive:true,force:true});}
});
