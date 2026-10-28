import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {openStore} from '../core.mjs';
import {setTimeout as delay} from 'node:timers/promises';
test('新增CRMEB连接使用自己的域名、凭据和运费直接入库，原工作流不被调用，写入后仅核对',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ops-multi-crmeb-'));Object.assign(process.env,{DATA_DIR:dir,APP_ORIGIN:'https://ops.mainapis.com',DEMO_MODE:'false'});
 const original=globalThis.fetch,calls=[],payloads=new Map();
 globalThis.fetch=async(url,options)=>{
  const u=new URL(url);assert.ok(['https://store-a.example.com','https://store-b.example.com'].includes(u.origin));calls.push({url,options});let data;
  if(u.pathname==='/outapi/get_token'){const body=JSON.parse(options.body);assert.equal(body.appid,u.origin.includes('store-a')?'a':'b');data={status:200,data:{token:'token-'+body.appid}};}
  else if(u.pathname==='/api/category')data={status:200,data:[{id:1,cate_name:'分类'}]};
  else if(u.pathname==='/api/brand'||u.pathname==='/outapi/brand/list')data={status:200,data:[]};
  else if(u.pathname==='/outapi/category/1')data={status:200,data:{id:1}};
  else if(u.pathname==='/outapi/product'&&options.method==='POST'){payloads.set(u.origin,JSON.parse(options.body));data={status:200};}
  else if(u.pathname==='/outapi/product/18')data={status:200,data:{...payloads.get(u.origin),id:18}};
  else throw Error('unexpected '+url);
  return {ok:true,status:200,text:async()=>JSON.stringify(data)};
 };
 const {handler,closeStore}=await import('../server.mjs'),db=openStore(join(dir,'ops.sqlite'));
 db.prepare('INSERT INTO sessions VALUES(?,?,?)').run('alice',JSON.stringify({user:{sub:'alice'},csrf:'csrf'}),Date.now()+60000);
 const call=async(path,method='GET',data={})=>{const req=Readable.from([Buffer.from(JSON.stringify(data))]);Object.assign(req,{url:path,method,headers:{cookie:'ops_session=alice',origin:'https://ops.mainapis.com','x-csrf-token':'csrf','content-type':'application/json'}});const res={status:200,setHeader(){},writeHead(s){this.status=s;},end(b){this.body=b;}};await handler(req,res);return {status:res.status,data:JSON.parse(res.body)};};
 const wait=async id=>{for(let i=0;i<100;i++){const j=db.prepare('SELECT * FROM jobs WHERE id=?').get(id);if(['awaiting_review','succeeded','unknown'].includes(j.status))return j;await delay(5);}throw Error('timeout');};
 try{
  const a=(await call('/api/malls','POST',{system:'crmeb-store',name:'A店'})).data.connection,b=(await call('/api/malls','POST',{system:'crmeb-store',name:'B店'})).data.connection;
  for(const [mall,suffix] of [[a,'a'],[b,'b']])assert.equal((await call('/api/connections/crmeb-store/auth?connection_id='+mall.id,'POST',{url:'https://store-'+suffix+'.example.com',appid:suffix,appsecret:'private-'+suffix,shippingTemplateId:9})).status,200);
  const product={source_url:'https://detail.1688.com/offer/234.html',catalog_target:'crmeb-store',catalog_connection_id:a.id,category_id:1,title:'T',images:['https://example.com/a.jpg'],skus:[{sku:'A',spec:'红',cost:2,price:5,stock:10}]};
  const created=await call('/api/products','POST',product);assert.equal(created.status,201,JSON.stringify(created));const id=created.data.id;
  await call('/api/products/'+id+'/approve','POST',{revision:1});
  const sent=await call('/api/products/'+id+'/publish','POST',{revision:1,target:'crmeb-store',connection_id:a.id});assert.equal(sent.status,202,JSON.stringify(sent));const job=await wait(sent.data.id);assert.equal(job.status,'awaiting_review');assert.equal(db.prepare('SELECT claimed FROM job_snapshots WHERE job_id=?').get(job.id).claimed,1);
  assert.equal(payloads.get('https://store-a.example.com').temp_id,9);assert.equal(payloads.size,1);
  assert.equal((await call('/api/callback/'+job.id+'/merchant-token','POST',{})).status,403);
  assert.equal((await call('/api/products/'+id+'/publish','POST',{revision:1,target:'crmeb-store',connection_id:a.id})).status,409);
  assert.equal((await call('/api/jobs/'+job.id+'/verify','POST',{remote_id:'18'})).status,202);
  assert.equal((await wait(job.id)).status,'succeeded');
  assert.equal(calls.filter(c=>new URL(c.url).pathname==='/outapi/product'&&c.options.method==='POST').length,1);
  assert.equal(calls.some(c=>new URL(c.url).origin==='https://store-b.example.com'&&new URL(c.url).pathname==='/outapi/product'),false);
 }finally{globalThis.fetch=original;db.close();closeStore();await rm(dir,{recursive:true,force:true});}
});
