import http from 'node:http';
import {parseOfficialExport} from './official-export.mjs';
import {createCatalogLoader,applyCatalog} from './catalog.mjs';
import {readFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {openStore,uid,secret,equal,sourceURL,validateProduct,assertPublishable,verifyIdToken,now,decodeProduct} from './core.mjs';

const root=dirname(fileURLToPath(import.meta.url));
const demo=process.env.DEMO_MODE==='true';
const origin=process.env.APP_ORIGIN||'http://127.0.0.1:3080';
const issuer=(process.env.CASDOOR_ISSUER||'https://auth.mainapis.com').replace(/\/$/,'');
const client=process.env.CASDOOR_CLIENT_ID||'', clientSecret=process.env.CASDOOR_CLIENT_SECRET||'';
const allowed=(process.env.ALLOWED_SUBJECTS||'').split(',').map(s=>s.trim()).filter(Boolean);
const webhook=process.env.N8N_WEBHOOK_URL||'', hookToken=process.env.N8N_WEBHOOK_TOKEN||'';
const host=demo?'127.0.0.1':(process.env.HOST||'0.0.0.0');
if(!demo && new URL(origin).protocol!=='https:') throw Error('生产 APP_ORIGIN 必须是 HTTPS');
if(!demo && new URL(issuer).protocol!=='https:') throw Error('Casdoor 必须是 HTTPS');
if(webhook && new URL(webhook).protocol!=='https:') throw Error('n8n Webhook 必须是 HTTPS');
const dataDir=process.env.DATA_DIR||join(root,'data'); await mkdir(dataDir,{recursive:true});
const db=openStore(join(dataDir,'ops.sqlite'));
const targets=[{id:'crmeb-pro',name:'CRMEB 会员商城',version:'4.3',url:'https://www.xlupw.com/admin'},{id:'crmeb-store',name:'CRMEB 多门店',version:'4.2',url:'https://www.xlyp.cc/admin'},{id:'tigshop',name:'Tigshop 跨境 Java',version:'5.8.60',url:''}];
function sessionGet(req) {
  const sid=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('ops_session='))?.slice(12);
  if(!sid) return null;
  const r=db.prepare('SELECT * FROM sessions WHERE id=? AND expires>?').get(sid,Date.now());
  return r?{id:sid,...JSON.parse(r.data)}:null;
}
function sessionSet(res,data,ttl=8*3600000) {
  const id=secret(); db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(id,JSON.stringify(data),Date.now()+ttl);
  res.setHeader('Set-Cookie',`ops_session=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(ttl/1000)}${demo?'':'; Secure'}`);
  return id;
}
function expire(res,id) {if(id)db.prepare('DELETE FROM sessions WHERE id=?').run(id);res.setHeader('Set-Cookie',`ops_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${demo?'':'; Secure'}`);}
const audit=(owner,action,id)=>db.prepare('INSERT INTO audit VALUES(?,?,?,?,?)').run(uid(),owner,action,id,now());
function json(res,status,data) {res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));}
function redirect(res,url) {res.writeHead(302,{Location:url});res.end();}
async function body(req) {
  if(!(req.headers['content-type']||'').startsWith('application/json'))throw Error('请使用 application/json');
  let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>2*1024*1024)throw Error('请求超过 2 MB');chunks.push(chunk);}return JSON.parse(Buffer.concat(chunks).toString()||'{}');
}
async function remoteJSON(url,options={}) {
  const u=new URL(url);if(u.protocol!=='https:')throw Error('远程接口必须使用 HTTPS');
  const r=await fetch(u,{...options,redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!r.ok)throw Error(`远程服务返回 HTTP ${r.status}`);
  const text=await r.text();if(text.length>2e6)throw Error('远程响应过大');return JSON.parse(text);
}
const loadCatalog=createCatalogLoader(remoteJSON);
async function validateCatalog(p){if(p.category_id||p.brand_ids?.length)applyCatalog(p,await loadCatalog());return p;}
async function discovery() {
  const meta=await remoteJSON(issuer+'/.well-known/openid-configuration');
  if(meta.issuer!==issuer)throw Error('Casdoor discovery issuer 与配置不一致');
  for(const key of ['authorization_endpoint','token_endpoint','jwks_uri'])if(new URL(meta[key]).origin!==new URL(issuer).origin)throw Error('Casdoor 端点必须位于配置的认证站点');
  return meta;
}
function productFor(owner,id) {const r=db.prepare('SELECT * FROM products WHERE owner=? AND id=?').get(owner,id);if(!r)throw Error('商品不存在');return r;}
function putProduct(owner,input) {
  const p=validateProduct(input), t=now(); const id=uid();
  try{db.prepare('INSERT INTO products(id,owner,source,data,created,updated) VALUES(?,?,?,?,?,?)').run(id,owner,p.source_url,JSON.stringify(p),t,t);}catch(e){if(String(e).includes('UNIQUE'))throw Error('该来源商品已在采集箱中，请编辑原商品');throw e;}
  audit(owner,'product.create',id);return id;
}
// Only configured server endpoints are called. Product URLs are stored, never fetched here.
async function dispatch(job,p,action='publish_draft',verification={}) {
  const payload={job_id:job.id,idempotency_key:job.id,action,target:job.target,product_revision:job.revision,product:p,...verification,callback:{url:origin+'/api/callback/'+job.id,token:job.token}};
  try {
    const r=await fetch(webhook,{method:'POST',headers:{'Content-Type':'application/json','X-Ops-Token':hookToken,'Idempotency-Key':job.id},body:JSON.stringify(payload),redirect:'error',signal:AbortSignal.timeout(15000)});
    if(r.ok)db.prepare("UPDATE jobs SET status='accepted',message='n8n 已接收，等待执行结果',updated=? WHERE id=? AND status='dispatching'").run(now(),job.id);
    else db.prepare("UPDATE jobs SET status='unknown',message='n8n 返回非成功状态；请核对执行记录后再处理，避免重复创建商品',updated=? WHERE id=? AND status='dispatching'").run(now(),job.id);
  } catch {db.prepare("UPDATE jobs SET status='unknown',message='未确认 n8n 是否接收，请核对执行记录；不会自动重发',updated=? WHERE id=? AND status='dispatching'").run(now(),job.id);}
}
db.prepare("UPDATE jobs SET status='unknown',message='服务重启，需核对 n8n 执行记录',updated=? WHERE status='dispatching'").run(now());
setInterval(()=>db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now()),60000).unref();
export const handler=async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  try {
    const path=new URL(req.url,'http://localhost').pathname;
    if(path==='/healthz')return json(res,200,{ok:true});
    if(req.method==='GET' && ['/','/app.js','/pricing.js','/style.css'].includes(path)) {const file=path==='/'?'index.html':path.slice(1);const data=await readFile(join(root,'public',file));res.writeHead(200,{'Content-Type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html; charset=utf-8'});return res.end(data);}
    let s=sessionGet(req);
    if(path==='/auth/login' && req.method==='GET') {
      if(demo){if(s)expire(res,s.id);sessionSet(res,{user:{sub:'demo',name:'本地演示'},csrf:secret()});return redirect(res,'/');}
      if(!client||!clientSecret||!allowed.length) return json(res,503,{error:'请先配置 Casdoor Client ID、Secret 和 ALLOWED_SUBJECTS'});
      const meta=await discovery(),state=secret(),nonce=secret(),verifier=secret();
      if(s)expire(res,s.id);sessionSet(res,{state,nonce,verifier},600000);
      const u=new URL(meta.authorization_endpoint);u.search=new URLSearchParams({client_id:client,response_type:'code',redirect_uri:origin+'/auth/callback',scope:'openid profile email',state,nonce,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'}).toString();return redirect(res,u.href);
    }
    if(path==='/auth/callback' && req.method==='GET') {
      const q=new URL(req.url,'http://localhost').searchParams;
      if(!s?.state||!equal(s.state,q.get('state'))||!q.get('code'))return json(res,400,{error:'登录状态已失效，请重新登录'});
      const pending=s;expire(res,s.id); // consume state before any network work
      const meta=await discovery();
      const tokens=await remoteJSON(meta.token_endpoint,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id:client,client_secret:clientSecret,code:q.get('code'),redirect_uri:origin+'/auth/callback',code_verifier:pending.verifier})});
      const claims=verifyIdToken(tokens.id_token,await remoteJSON(meta.jwks_uri),{issuer,audience:client,nonce:pending.nonce});
      if(!allowed.includes(claims.sub))return json(res,403,{error:'账号未获运营后台访问权限，请由管理员将 Casdoor 的 sub 加入 ALLOWED_SUBJECTS'});
      sessionSet(res,{user:{sub:claims.sub,name:claims.name||claims.preferred_username||claims.sub},csrf:secret()});audit(claims.sub,'login','');return redirect(res,'/');
    }
    if(path.startsWith('/api/callback/') && req.method==='POST') {
      if(demo)return json(res,403,{error:'演示模式禁止外部回调'});
      const route=path.match(/^\/api\/callback\/([^/]+)(\/claim)?$/);if(!route)return json(res,404,{error:'接口不存在'});
      const id=route[1]; let job=db.prepare('SELECT * FROM jobs WHERE id=?').get(id);
      if(!job || !equal(req.headers.authorization,'Bearer '+job.token))return json(res,403,{error:'回调认证失败'});
      const b=await body(req);
      job=db.prepare('SELECT * FROM jobs WHERE id=?').get(id);
      const snapshot=db.prepare('SELECT * FROM job_snapshots WHERE job_id=?').get(id);
      if(route[2]){
        if(job.target!=='crmeb-pro'||!snapshot)return json(res,409,{error:'此任务没有官方发布快照'});
        if(b.action==='inspect_publish'){
          if(snapshot.claimed || !['dispatching','accepted','unknown'].includes(job.status))return json(res,409,{error:'此任务不可重新创建，请先核对商城记录'});
        }else if(b.action==='publish_draft'){
          if(!['dispatching','accepted','unknown'].includes(job.status))return json(res,409,{error:'当前任务不可领取创建操作'});
          const claimed=db.prepare('UPDATE job_snapshots SET claimed=1 WHERE job_id=? AND claimed=0').run(id);
          if(!claimed.changes)return json(res,409,{error:'此任务已领取，禁止重复创建；请到商城核对'});
          audit(job.owner,'job.claim_create',id);
        }else if(b.action==='verify_draft'){
          if(job.status!=='verifying'||!equal(b.verification_nonce,snapshot.verification_nonce))return json(res,409,{error:'核对请求已失效'});
        }else throw Error('不支持的任务动作');
        return json(res,200,{job_id:id,action:b.action==='inspect_publish'?'publish_draft':b.action,product:JSON.parse(snapshot.product),marker:'OPS-'+id.replaceAll('-',''),candidate_id:snapshot.candidate_id,verification_nonce:snapshot.verification_nonce});
      }
      if(!['succeeded','failed','awaiting_review','unknown'].includes(b.status))throw Error('无效任务状态');
      if(snapshot?.claimed){
        if(b.status==='failed')return json(res,409,{error:'已领取创建操作，不能将未知副作用标记为可重试失败'});
        if(b.status==='succeeded' || b.verification_nonce || job.status==='verifying'){
          if(!equal(b.verification_nonce,snapshot.verification_nonce))return json(res,409,{error:'核对结果已失效'});
          if(b.status==='succeeded' && (String(b.remote_id)!==snapshot.candidate_id || !snapshot.candidate_id))return json(res,409,{error:'返回商品 ID 与本次核对不符'});
        }else if(snapshot.verification_nonce)return json(res,409,{error:'过期的创建回调'});
        if(['awaiting_review','succeeded'].includes(job.status)&&!b.verification_nonce)return json(res,409,{error:'创建结果已处理，禁止重复回传覆盖'});
      }
      const remoteId=String(b.remote_id||'').slice(0,100);if(b.status==='succeeded'&&!remoteId)throw Error('成功回调必须返回商城商品 remote_id');
      if(['succeeded','failed'].includes(job.status)){if(job.status!==b.status||job.remote_id!==remoteId)return json(res,409,{error:'终态结果冲突'});return json(res,200,{ok:true,duplicate:true});}
      db.prepare('UPDATE jobs SET status=?,message=?,remote_id=?,updated=? WHERE id=?').run(b.status,String(b.message||'').slice(0,500),remoteId,now(),id);audit(job.owner,'job.'+b.status,id);return json(res,200,{ok:true});
    }
    if(path==='/api/me')return json(res,200,{user:s?.user||null,csrf:s?.csrf||'',demo,authReady:demo||!!(client&&clientSecret&&allowed.length)});
    if(!s?.user)return json(res,401,{error:'请先登录'});
    if(!['GET','HEAD'].includes(req.method)) {
      if(req.headers.origin!==origin || !equal(req.headers['x-csrf-token'],s.csrf))return json(res,403,{error:'请求来源或 CSRF 校验失败'});
    }
    const owner=s.user.sub;
    if(path==='/api/catalog/crmeb-pro'&&req.method==='GET')return json(res,200,await loadCatalog(new URL(req.url,origin).searchParams.get('refresh')==='1'));
    const retryRoute=path.match(/^\/api\/jobs\/([^/]+)\/retry$/);
    if(retryRoute && req.method==='POST'){
      if(demo||!webhook||!hookToken)return json(res,503,{error:'尚未配置 n8n'});
      const job=db.prepare('SELECT * FROM jobs WHERE id=? AND owner=?').get(retryRoute[1],owner),snap=db.prepare('SELECT * FROM job_snapshots WHERE job_id=?').get(retryRoute[1]);
      if(!job||job.target!=='crmeb-pro'||!snap||snap.claimed||!['accepted','unknown'].includes(job.status))return json(res,409,{error:'任务可能已开始创建，禁止重新发送'});
      audit(owner,'job.retry_unclaimed',job.id);await dispatch(job,JSON.parse(snap.product));return json(res,202,{id:job.id});
    }
    const verificationRoute=path.match(/^\/api\/jobs\/([^/]+)\/verify$/);
    if(verificationRoute && req.method==='POST'){
      if(demo||!webhook||!hookToken)return json(res,503,{error:'尚未配置 n8n'});
      const id=verificationRoute[1],b=await body(req),job=db.prepare('SELECT * FROM jobs WHERE id=? AND owner=?').get(id,owner),snapshot=db.prepare('SELECT * FROM job_snapshots WHERE job_id=?').get(id);
      if(!job||job.target!=='crmeb-pro'||!snapshot?.claimed||!['awaiting_review','verifying','unknown','accepted'].includes(job.status))return json(res,409,{error:'该任务暂不可核对'});
      const candidate=String(b.remote_id||'');if(!/^[1-9][0-9]{0,14}$/.test(candidate))throw Error('请填写商城中的数字商品 ID');
      const nonce=secret();db.prepare('UPDATE job_snapshots SET candidate_id=?,verification_nonce=? WHERE job_id=?').run(candidate,nonce,id);
      db.prepare("UPDATE jobs SET status='verifying',message='正在读取官方商品详情核对',updated=? WHERE id=?").run(now(),id);
      audit(owner,'job.verify_requested',id);
      await dispatch(job,JSON.parse(snapshot.product),'verify_draft',{remote_id:candidate,verification_nonce:nonce});return json(res,202,{id});
    }
    if(path==='/auth/logout' && req.method==='POST'){expire(res,s.id);return json(res,200,{ok:true});}
    if(path==='/api/state' && req.method==='GET')return json(res,200,{products:db.prepare('SELECT * FROM products WHERE owner=? ORDER BY updated DESC LIMIT 1000').all(owner).map(decodeProduct),jobs:db.prepare('SELECT id,product_id,revision,target,status,message,remote_id,created,updated FROM jobs WHERE owner=? ORDER BY created DESC LIMIT 300').all(owner).map(j=>({...j,claimed:!!db.prepare('SELECT claimed FROM job_snapshots WHERE job_id=?').get(j.id)?.claimed,marker:'OPS-'+j.id.replaceAll('-','')})),targets,connections:{casdoor:demo?'demo':'connected',n8n:!demo&&webhook&&hookToken?'configured':'unconfigured'},audit:db.prepare('SELECT action,object_id,created FROM audit WHERE owner=? ORDER BY created DESC LIMIT 30').all(owner)});
    if(path==='/api/products' && req.method==='POST') {const b=await body(req);const p=await validateCatalog(validateProduct(b));return json(res,201,{id:putProduct(owner,p)});}
    if(path==='/api/import' && req.method==='POST') {
      const b=await body(req);if(b.table!==undefined)b.products=parseOfficialExport(b.table);if(!Array.isArray(b.products)||b.products.length>100)throw Error('每次最多导入 100 件商品');
      const results=[];for(const [i,input]of b.products.entries()){try{const p=await validateCatalog(validateProduct(input));results.push({index:i,id:putProduct(owner,p),ok:true});}catch(e){results.push({index:i,ok:false,error:e.message});}}return json(res,200,{results});
    }
    const match=path.match(/^\/api\/products\/([^/]+)(?:\/(approve|publish))?$/);
    if(match){const r=productFor(owner,match[1]),p=decodeProduct(r);
      if(!match[2] && req.method==='PUT') {
        const b=await body(req);if(b.revision!==r.revision)return json(res,409,{error:'商品已被更新，请刷新后重试'});
        const v=await validateCatalog(validateProduct(b));if(v.source_url!==r.source)throw Error('来源链接不能修改');
        const result=db.prepare("UPDATE products SET data=?,status='draft',revision=revision+1,updated=? WHERE id=? AND owner=? AND revision=?").run(JSON.stringify(v),now(),r.id,owner,b.revision);
        if(!result.changes)return json(res,409,{error:'商品已被更新，请刷新后重试'});
        audit(owner,'product.edit',r.id);return json(res,200,{ok:true});
      }
      if(match[2]==='approve'&&req.method==='POST'){const b=await body(req);if(b.revision!==r.revision)return json(res,409,{error:'版本已变化，请重新检查'});await validateCatalog(p);assertPublishable(p);const result=db.prepare("UPDATE products SET status='approved',updated=? WHERE id=? AND revision=?").run(now(),r.id,b.revision);if(!result.changes)return json(res,409,{error:'版本已变化，请重新检查'});audit(owner,'product.approve',r.id);return json(res,200,{ok:true});}
      if(match[2]==='publish'&&req.method==='POST') {
        if(demo||!webhook||!hookToken)return json(res,503,{error:'尚未配置 n8n 发布连接，未发送任务'});
        const b=await body(req);const current=productFor(owner,r.id);if(current.status!=='approved'||b.revision!==current.revision)throw Error('请先审核当前版本商品');const publishingProduct=decodeProduct(current);assertPublishable(publishingProduct);
        if(!targets.some(t=>t.id===b.target))throw Error('目标商城无效');
        if(publishingProduct.category_id&&b.target!=='crmeb-pro')throw Error('此分类属于 CRMEB 会员商城，请选择对应目标商城');
        await validateCatalog(publishingProduct);
        if(db.prepare('SELECT j.id FROM jobs j JOIN job_snapshots s ON s.job_id=j.id WHERE j.product_id=? AND j.target=? AND s.claimed=1 LIMIT 1').get(r.id,b.target))return json(res,409,{error:'此商品已有官方创建任务，不能再次创建；请到发布任务核对商品 ID'});
        const id=uid(),t=now();db.exec('BEGIN IMMEDIATE');try{db.prepare('INSERT INTO jobs(id,owner,product_id,revision,target,status,token,created,updated) VALUES(?,?,?,?,?,?,?,?,?)').run(id,owner,r.id,current.revision,b.target,'dispatching',secret(),t,t);db.prepare('INSERT INTO job_snapshots(job_id,product) VALUES(?,?)').run(id,JSON.stringify(publishingProduct));db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');if(String(e).includes('UNIQUE'))return json(res,409,{error:'该版本已有发布任务，请在任务列表查看结果'});throw e;}
        audit(owner,'job.create',id);const job=db.prepare('SELECT * FROM jobs WHERE id=?').get(id);await dispatch(job,publishingProduct);return json(res,202,{id});
      }
    }
    return json(res,404,{error:'接口不存在'});
  } catch(e){console.error('request_failed',e.name);return json(res,400,{error:e instanceof SyntaxError?'数据格式错误':e.message||'请求失败'});}
};
export const closeStore=()=>db.close();
const server=http.createServer(handler);
server.requestTimeout=30000;server.headersTimeout=10000;
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url))server.listen(Number(process.env.PORT||3080),host,()=>console.log(`Goods Ops listening on ${host}:${process.env.PORT||3080}${demo?' [LOCAL DEMO]':''}`));
