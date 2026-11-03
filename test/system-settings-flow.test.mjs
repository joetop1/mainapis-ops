import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {openStore} from '../core.mjs';
const pixel='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhWQAAAAASUVORK5CYII=';
test('全站设置鉴权、CSRF、团队管理员隔离及匿名首屏/图标响应',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ops-system-settings-'));Object.assign(process.env,{DATA_DIR:dir,APP_ORIGIN:'https://ops.mainapis.com',DEMO_MODE:'false',ALLOWED_SUBJECTS:'root,ordinary',SYSTEM_ADMIN_SUBJECTS:'root'});
 const {handler,closeStore}=await import('../server.mjs'),db=openStore(join(dir,'ops.sqlite'));
 for(const sub of ['root','ordinary'])db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(sub,JSON.stringify({user:{sub},csrf:'csrf'}),Date.now()+60000);
 const call=async(path,method='GET',body={},user='root',csrf='csrf')=>{const req=Readable.from(method==='GET'?[]:[Buffer.from(JSON.stringify(body))]);Object.assign(req,{url:path,method,headers:{...(user?{cookie:'ops_session='+user}:{}),origin:'https://ops.mainapis.com','x-csrf-token':csrf,'content-type':'application/json'}});const headers={},res={status:200,setHeader(k,v){headers[k]=v;},writeHead(s,h={}){this.status=s;Object.assign(headers,h);},end(b){this.body=b;}};await handler(req,res);const raw=res.body;return {status:res.status,data:String(headers['Content-Type']).startsWith('application/json')?JSON.parse(raw):raw,headers};};
 try{
  assert.equal((await call('/api/system-settings','GET',{},'')).status,401);assert.equal((await call('/api/me')).data.systemAdmin,true);assert.equal((await call('/api/me','GET',{},'ordinary')).data.systemAdmin,false);
  await call('/api/team','POST',{name:'普通管理员团队'},'ordinary');assert.equal((await call('/api/system-settings','GET',{},'ordinary')).status,403);
  const initial=(await call('/api/system-settings')).data;assert.equal((await call('/api/system-settings','POST',initial,'root','bad')).status,403);assert.equal((await call('/api/system-settings','POST',initial,'ordinary')).status,403);
  const saved=await call('/api/system-settings','POST',{...initial,name:'小蓝商品系统',title:'小蓝 · 运营',icon:{data:pixel},logo:{data:pixel}});assert.equal(saved.status,200);assert.equal(saved.data.revision,1);assert.equal((await call('/api/system-settings','POST',initial)).status,409);
  const publicInfo=(await call('/api/system-info','GET',{},'')).data;assert.equal(publicInfo.name,'小蓝商品系统');assert.equal(publicInfo.actor,undefined);
  const page=await call('/','GET',{},'');assert.equal(page.status,200);assert.match(String(page.data),/<title>小蓝 · 运营<\/title>/);assert.match(String(page.data),/id="brandSystemName">小蓝商品系统/);assert.match(String(page.data),/id="brandLogo" class="brand-logo"/);
  const icon=await call(publicInfo.icon_url,'GET',{},'');assert.equal(icon.status,200);assert.equal(icon.headers['Content-Type'],'image/png');assert.ok(Buffer.from(icon.data).equals(Buffer.from(pixel,'base64')));assert.equal(icon.headers['X-Content-Type-Options'],'nosniff');assert.equal((await call('/favicon.ico','GET',{},'')).headers['Content-Type'],'image/png');
  const reset=await call('/api/system-settings','POST',{...saved.data,icon:null,logo:null});assert.equal(reset.status,200);assert.equal((await call('/favicon.ico','GET',{},'')).headers['Content-Type'],'image/svg+xml');assert.equal((await call('/api/system-assets/logo','GET',{},'')).status,404);
 }finally{db.close();closeStore();await rm(dir,{recursive:true,force:true});}
});
