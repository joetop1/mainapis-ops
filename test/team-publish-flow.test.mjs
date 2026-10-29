import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import vm from 'node:vm';
import {openStore} from '../core.mjs';
import {verifyStoreProduct} from '../crmeb-store.mjs';

test('个人及团队完整发布模拟：相同入口凭证、领取、准备代码、创建回执及核验；502中断可在两种模式复现',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ops-team-flow-'));
 Object.assign(process.env,{DATA_DIR:dir,APP_ORIGIN:'https://ops.mainapis.com',DEMO_MODE:'false',N8N_STORE_WEBHOOK_URL:'https://n8n.mainapis.com/webhook/env-fallback',N8N_STORE_WEBHOOK_TOKEN:'wrong-fallback'});
 const originalFetch=globalThis.fetch,outbound=[];
 globalThis.fetch=async(url,options={})=>{
  if(String(url).startsWith('https://n8n.mainapis.com/')){outbound.push({url,options,body:JSON.parse(options.body)});return {ok:true,status:200};}
  if(String(url)==='https://www.xlyp.cc/outapi/get_token')return {ok:true,text:async()=>JSON.stringify({status:200,data:{token:'merchant-token'}})};
  if(String(url)==='https://www.xlyp.cc/api/category')return {ok:true,text:async()=>JSON.stringify({status:200,data:[{id:154,cate_name:'润滑液'}]})};
  if(String(url)==='https://www.xlyp.cc/api/brand')return {ok:true,text:async()=>JSON.stringify({status:200,data:[]})};
  throw Error('Unexpected network call: '+url);
 };
 const {handler,closeStore}=await import('../server.mjs'),db=openStore(join(dir,'ops.sqlite'));
 const source=await readFile(new URL('../workflows/crmeb-store-prepare-template1.js',import.meta.url),'utf8');
 const workflow=JSON.parse(await readFile(new URL('../workflows/publish-crmeb-store.json',import.meta.url),'utf8'));
 const receipt=workflow.nodes.find(n=>n.id==='receipt').parameters.jsCode;
 const product={catalog_target:'crmeb-store',category_id:154,category:'润滑液',title:'TENGA LOTION测试',source_url:'https://detail.1688.com/offer/1084174064750.html',images:['https://example.com/main.jpg'],detail_images:['https://example.com/detail.jpg'],applicable_type:0,skus:[{sku:'ALI-1',spec:'红',price:74.9,cost:45,stock:90}]};
 for(const sub of ['alice','bob','outsider'])db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(sub,JSON.stringify({user:{sub},csrf:'csrf'}),Date.now()+60000);
 const call=async(path,method='POST',body={},sub='alice',token='')=>{
  const req=Readable.from([Buffer.from(JSON.stringify(body))]);Object.assign(req,{url:path,method,headers:{cookie:'ops_session='+sub,origin:'https://ops.mainapis.com','x-csrf-token':'csrf','content-type':'application/json',authorization:'Bearer '+token}});
  const res={status:200,setHeader(){},writeHead(status){this.status=status;},end(body){this.body=body;}};await handler(req,res);return {status:res.status,data:JSON.parse(res.body)};
 };
 try{
  const hookToken='team-safe-'+ 'a'.repeat(40),hookUrl='https://n8n.mainapis.com/webhook/ops-crmeb-store';
  assert.equal((await call('/api/connections/crmeb-store/publishing','POST',{url:hookUrl,token:hookToken})).status,200);
  assert.equal((await call('/api/connections/crmeb-store/auth','POST',{appid:'store-app',appsecret:'store-private'})).status,200);
  for(const mode of ['personal','team']){
   if(mode==='team'){
    assert.equal((await call('/api/team','POST',{name:'测试团队'})).status,201);
    assert.equal((await call('/api/team/members','POST',{sub:'bob',role:'reviewer'})).status,200);
   }
   const actor=mode==='team'?'bob':'alice';
   const owner=mode==='team'?db.prepare('SELECT team_id FROM team_members WHERE sub=?').get('alice').team_id:'alice';
   for(const result of ['success','502']){
    const pid=mode+'-'+result,p={...product,attributes:[{name:'容量',value:'30ml'},{name:'下游平台',value:'ebay'}],source_url:product.source_url+'?case='+pid};
    db.prepare('INSERT INTO products VALUES(?,?,?,?,?,?,?,?)').run(pid,owner,p.source_url,JSON.stringify(p),'approved',2,'now','now');
    const published=await call('/api/products/'+pid+'/publish','POST',{revision:2,target:'crmeb-store'},actor);assert.equal(published.status,202,JSON.stringify(published.data));
    const id=published.data.id,request=outbound.at(-1),token=request.body.callback.token;
    assert.equal(request.url,hookUrl);assert.equal(request.options.headers['X-Ops-Token'],hookToken);assert.equal(request.body.product.skus[0].stock,90);
    const claimPath='/api/callback/'+id+'/claim';
    const inspected=await call(claimPath,'POST',{action:'inspect_publish'},'',token);assert.equal(inspected.status,200);
    const auth=await call('/api/callback/'+id+'/merchant-token','POST',{},'',token);assert.equal(auth.status,200);
    const prepared=vm.runInNewContext(`(function(){${source}})()`,{$:()=>({first:()=>({json:inspected.data})}),$json:auth.data})[0].json;
    assert.equal(prepared.payload.description,'<p><img src="https://example.com/detail.jpg" alt=""></p>');assert.equal(JSON.stringify(prepared.payload.specs),JSON.stringify([{id:0,temp_id:0,name:'容量',value:'30ml',sort:1}]));assert.equal(JSON.parse(db.prepare('SELECT data FROM products WHERE id=?').get(pid).data).description,product.description);assert.equal(prepared.payload.applicable_type,0);
    assert.equal((await call(claimPath,'POST',{action:'publish_draft'},'',token)).status,200);
    assert.equal((await call(claimPath,'POST',{action:'publish_draft'},'',token)).status,409);
    if(result==='502'){
     // Current live workflow stops at the HTTP node and never invokes callback.
     assert.equal((await call('/api/state','GET',{},actor)).data.jobs.find(j=>j.id===id).status,'accepted');
     assert.equal((await call('/api/jobs/'+id+'/retry','POST',{},actor)).status,409);
     // A correctly wired error receipt is accepted without releasing the create lock.
     const failure=vm.runInNewContext(`(function(){${receipt}})()`,{$json:{error:'502 - gateway error'}})[0].json;
     assert.equal(failure.status,'unknown');
     assert.equal((await call('/api/callback/'+id,'POST',failure,'',token)).status,200);
     assert.equal((await call('/api/state','GET',{},actor)).data.jobs.find(j=>j.id===id).status,'unknown');
     assert.equal(db.prepare('SELECT claimed FROM job_snapshots WHERE job_id=?').get(id).claimed,1);
    }else{
     assert.equal((await call('/api/callback/'+id,'POST',{status:'awaiting_review',message:'等待商品ID'},'',token)).status,200);
     assert.equal((await call('/api/jobs/'+id+'/verify','POST',{remote_id:'2178'},'outsider')).status,409);
     assert.equal((await call('/api/jobs/'+id+'/verify','POST',{remote_id:'2178'},actor)).status,202);
     const verification=outbound.at(-1).body;
     const context=await call(claimPath,'POST',{action:'verify_draft',verification_nonce:verification.verification_nonce},'',token);assert.equal(context.status,200);
     const verdict=verifyStoreProduct({status:200,data:{productInfo:{...prepared.payload,id:2178}}},context.data,prepared.config);assert.equal(verdict.status,'succeeded');
     assert.equal((await call('/api/callback/'+id,'POST',{...verdict,verification_nonce:verification.verification_nonce},'',token)).status,200);
     assert.equal(db.prepare('SELECT status FROM jobs WHERE id=?').get(id).status,'succeeded');
    }
   }
  }
 }finally{globalThis.fetch=originalFetch;db.close();closeStore();await rm(dir,{recursive:true,force:true});}
});
