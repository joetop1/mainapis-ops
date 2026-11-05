import {localImageUploader,repairSavedImageUrls} from './local-image-upload.mjs';
import {bulkProductSettings} from './bulk-settings.mjs';
import {supplierImports} from './supplier-import.mjs';
import {imageStorage} from './image-storage.mjs';
import {systemSettings,systemAdministrator,renderSystemBranding,DEFAULT_ICON} from './system-settings.mjs';
import {productMerge} from './product-merge.mjs';
import {productForMall} from './public/mall-mappings.js';
import {buildOfficialProduct,assertCrmebImageLengths} from './crmeb-official.mjs';
import {buildStoreProduct,storeLease} from './crmeb-store.mjs';
import {crmebNativeRelay} from './crmeb-native-relay.mjs';
import {tigshopNotificationPoll} from './tigshop-notification-poll.mjs';
import {crmebRefundPoll} from './crmeb-refund-poll.mjs';
import {mallNotifications} from './mall-notifications.mjs';
import {jobInitiators} from './job-initiators.mjs';
import {productCollectors} from './product-collectors.mjs';
import {createShopxoClient,requireShopxoConnection,shopxoCatalog} from './shopxo-client.mjs';
import {buildShopxoProduct} from './shopxo-product.mjs';
import {createShopxoRunner} from './shopxo-direct.mjs';
import {createShopxoPackage} from './shopxo-package.mjs';
import {jobPage} from './job-pages.mjs';
import {mallConnections,MALL_SYSTEMS} from './mall-connections.mjs';
import {createCrmebRunner} from './crmeb-direct.mjs';
import {mallOrigin,mallDispatcher,LEGACY_YUNZHONG_ORIGIN} from './mall-address.mjs';
import {createYunzhongPackage} from './yunzhong-package.mjs';
import {recoverYunzhongUncreated} from './yunzhong-recovery.mjs';
import {createYunzhongBridge,yunzhongCatalog,YUNZHONG_BRIDGE} from './yunzhong-bridge.mjs';
import {createYunzhongRunner} from './yunzhong-direct.mjs';
import {buildYunzhongProduct} from './yunzhong-product.mjs';
import {createYunzhongClient,requireYunzhongCredentials,testYunzhongConnection,loadYunzhongCategories,YUNZHONG_BASE} from './yunzhong-client.mjs';
import {normalizeProductAttributes} from './public/product-attributes.js';
import {systemVersion} from './system-version.mjs';
import {productPublications} from './product-publications.mjs';
import {createCollectorPackage} from './collector-package.mjs';
import {fetchCrmebToken} from './crmeb-auth.mjs';
import {teamStore,teamPermission} from './teams.mjs';
import {AsyncLocalStorage} from 'node:async_hooks';
import {validateCrmebWebhook,testCrmebWebhook} from './crmeb-webhook.mjs';
import {crmebBrandReader} from './crmeb-brands.mjs';
import {recoverTigshopZeroStock} from './tigshop-recovery.mjs';
import {connectionStore} from './connection-store.mjs';
import {createTigshopClient,requireTigshopToken,tigshopShipping} from './tigshop-client.mjs';
import {createTigshopRunner} from './tigshop-direct.mjs';
import {buildTigshopProduct} from './tigshop.mjs';
import {createTigshopCatalog} from './tigshop-catalog.mjs';
import {fetchTigshopFX} from './tigshop-pricing.mjs';
import http from 'node:http';
import {parseOfficialExport} from './official-export.mjs';
import {createCatalogLoader,applyCatalog,parseCatalogOptions} from './catalog.mjs';
import {readFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {openStore,uid,secret,equal,sourceURL,validateProduct,assertPublishable,verifyIdToken,now,decodeProduct} from './core.mjs';

const root=dirname(fileURLToPath(import.meta.url));
const systemRelease=await systemVersion(root);
let collectorPackage;
async function collectorRelease(){return collectorPackage||=await createCollectorPackage(join(root,'extensions','1688-collector'));}
const demo=process.env.DEMO_MODE==='true';
const origin=process.env.APP_ORIGIN||'http://127.0.0.1:3080';
const issuer=(process.env.CASDOOR_ISSUER||'https://auth.mainapis.com').replace(/\/$/,'');
const client=process.env.CASDOOR_CLIENT_ID||'', clientSecret=process.env.CASDOOR_CLIENT_SECRET||'';
const allowed=(process.env.ALLOWED_SUBJECTS||'').split(',').map(s=>s.trim()).filter(Boolean);
const isSystemAdmin=sub=>systemAdministrator(sub,allowed,process.env.SYSTEM_ADMIN_SUBJECTS);
const webhook=process.env.N8N_WEBHOOK_URL||'', hookToken=process.env.N8N_WEBHOOK_TOKEN||'';
const storeWebhook=process.env.N8N_STORE_WEBHOOK_URL||'',storeHookToken=process.env.N8N_STORE_WEBHOOK_TOKEN||'';
const officialTargets=['crmeb-pro','crmeb-store','tigshop','yunzhong','shopxo'];
const connectionFor=(target,owner,connectionId)=>{
 const row=malls.get(owner,connectionId,target),scope=malls.scope(row);
 const saved=brandConnectionStores[target]?.get(scope);
 if(saved?.webhookUrl&&saved?.webhookToken)return {url:saved.webhookUrl,token:saved.webhookToken};
 if(!row.legacy)return {url:'',token:''};
 return target==='crmeb-pro'?{url:webhook,token:hookToken}:target==='crmeb-store'?{url:storeWebhook,token:storeHookToken}:{url:'',token:''};
};
const credentialsFor=(target,owner,connectionId)=>{const row=malls.get(owner,connectionId,target),scope=malls.scope(row);return (target==='shopxo'?shopxoConnections:target==='yunzhong'?yunzhongConnections:target==='tigshop'?savedConnections:brandConnectionStores[target]).get(scope);};
const connected=(target,owner,connectionId)=>{
 const row=malls.get(owner,connectionId,target),c=credentialsFor(target,owner,row.id);
 if(target==='yunzhong')return ['official','bridge'].includes(c?.mode)&&!!c?.publishingReady;
 if(target==='tigshop')return !!c?.token;
 if(target==='shopxo')return !!(c?.appsecret&&c?.testedAt&&c?.warehouseId);
 return row.legacy?!!(connectionFor(target,owner,row.id).url&&connectionFor(target,owner,row.id).token):!!(c?.appid&&c?.appsecret&&c?.url&&c?.shippingTemplateId&&c?.authTestedAt);
};
const host=demo?'127.0.0.1':(process.env.HOST||'0.0.0.0');
if(!demo && new URL(origin).protocol!=='https:') throw Error('生产 APP_ORIGIN 必须是 HTTPS');
if(!demo && new URL(issuer).protocol!=='https:') throw Error('Casdoor 必须是 HTTPS');
if((webhook && new URL(webhook).protocol!=='https:')||(storeWebhook&&new URL(storeWebhook).protocol!=='https:')) throw Error('n8n Webhook 必须是 HTTPS');
const dataDir=process.env.DATA_DIR||join(root,'data'); await mkdir(dataDir,{recursive:true});
const db=openStore(join(dataDir,'ops.sqlite'));
const teams=teamStore(db),actorContext=new AsyncLocalStorage();
const branding=systemSettings(db);
const collectors=productCollectors(db);
const mergeProducts=productMerge({db,collectors,audit:(...args)=>audit(...args),actor:()=>({sub:actorContext.getStore()?.actor||'',name:actorContext.getStore()?.name||''})});
const initiators=jobInitiators(db);
const savedConnections=await connectionStore(db,dataDir);
const yunzhongConnections=await connectionStore(db,dataDir,'yunzhong');
const shopxoConnections=await connectionStore(db,dataDir,'shopxo');
const mallProfiles=await connectionStore(db,dataDir,'profiles');
const imageSecrets=await connectionStore(db,dataDir,'images');
const images=imageStorage({db,store:imageSecrets});
const mallImageOrigin=mall=>credentialsFor(mall.system,mall.owner,mall.id)?.url||(mall.legacy?MALL_SYSTEMS[mall.system].origin:'');
const notificationSecrets=await connectionStore(db,dataDir,'notifications');
const findNotificationMall=id=>db.prepare('SELECT * FROM mall_connections WHERE id=?').get(id);
const notifications=mallNotifications({db,store:notificationSecrets,findMall:findNotificationMall});
let notificationTimer;
const brandConnectionStores=Object.fromEntries(await Promise.all(['crmeb-pro','crmeb-store'].map(async target=>[target,await connectionStore(db,dataDir,target)])));
const malls=mallConnections(db,mallProfiles);
const uploadLocalImage=localImageUploader({getStorage:()=>images.get(),allowedStorage:(owner,c)=>malls.list(owner).some(m=>{try{return c.allowedOrigins.includes(mallOrigin(mallImageOrigin(m)));}catch{return false;}})});
const supplierImport=supplierImports({db,dataDir,root,getStorage:()=>images.get(),allowedStorage:(owner,c)=>malls.list(owner).some(m=>{try{return c.allowedOrigins.includes(mallOrigin(mallImageOrigin(m)));}catch{return false;}}),recordCollector:id=>collectors.record(id,actorContext.getStore()?.actor||'',actorContext.getStore()?.name||''),audit:(...args)=>audit(...args)});
const supplierPruneTimer=setInterval(()=>supplierImport.prune().catch(()=>{}),3600000);supplierPruneTimer.unref();
// Idempotent migration of persisted owners before any task can resume.
for(const row of db.prepare("SELECT owner FROM products UNION SELECT owner FROM jobs UNION SELECT owner FROM connections UNION SELECT owner FROM connections_yunzhong UNION SELECT owner FROM connections_crmeb_pro UNION SELECT owner FROM connections_crmeb_store UNION SELECT owner FROM connections_shopxo UNION SELECT owner FROM connection_profiles").all())malls.ensure(row.owner);
const refundPoll=crmebRefundPoll({db,getCredentials:mall=>credentialsFor(mall.system,mall.owner,mall.id),getNotificationConfig:id=>notificationSecrets.get('notification:'+id),findMall:findNotificationMall,enqueue:notifications.enqueueRefund});
const tigshopNoticePoll=tigshopNotificationPoll({db,getCredentials:mall=>credentialsFor('tigshop',mall.owner,mall.id),getNotificationConfig:id=>notificationSecrets.get('notification:'+id),findMall:findNotificationMall,enqueue:notifications.enqueueTigshop});
const nativeRelay=crmebNativeRelay({db,findMall:findNotificationMall,getConfig:id=>notificationSecrets.get('notification:'+id),getCredentials:mall=>credentialsFor('crmeb-store',mall.owner,mall.id),enqueue:notifications.enqueueCrmeb});
const privateBrandCatalogs=new Map();
db.exec("CREATE TABLE IF NOT EXISTS job_transports(job_id TEXT PRIMARY KEY REFERENCES jobs(id), mode TEXT NOT NULL)");
function requireDistinctMall(owner,row,url){
 for(const other of malls.list(owner)){
  if(other.id===row.id||other.system!==row.system)continue;
  const c=credentialsFor(other.system,owner,other.id);if(!c?.appid&&!c?.token)continue;
  if(mallOrigin(c.url||MALL_SYSTEMS[other.system].origin)===url)throw Error('该系统的商城地址已配置，请使用已有连接，避免重复发布');
 }
}
function getTigshopConnection(owner,job){return owner?credentialsFor('tigshop',owner,job?.mall_connection_id):null;}
const yunzhongRunner=createYunzhongRunner({db,getConnection:(owner,job)=>credentialsFor('yunzhong',owner,job?.mall_connection_id),audit:(...args)=>audit(...args)});
const directRunner=createTigshopRunner({db,getConnection:getTigshopConnection,audit:(...args)=>audit(...args)});
const crmebRunner=createCrmebRunner({db,getConnection:job=>credentialsFor(job.target,job.owner,job.mall_connection_id),audit:(...args)=>audit(...args)});
const shopxoRunner=createShopxoRunner({db,getConnection:job=>credentialsFor('shopxo',job.owner,job.mall_connection_id),audit:(...args)=>audit(...args)});
const targets=[{id:'shopxo',name:'ShopXO',version:'6.9.2',url:'https://xiaolanyoupin.wang'},{id:'yunzhong',name:'芸众商城',version:'2.3.700',url:'https://asns.cc/admin/shop'},{id:'crmeb-pro',name:'CRMEB 会员商城',version:'4.3',url:'https://www.xlupw.com/admin'},{id:'crmeb-store',name:'CRMEB 多门店',version:'4.2',url:'https://www.xlyp.cc/admin'},{id:'tigshop',name:'Tigshop 跨境 Java',version:'5.8.60',url:'https://xiaolango.com/admin'}];
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
const audit=(owner,action,id)=>{db.prepare('INSERT INTO audit VALUES(?,?,?,?,?)').run(uid(),owner,action,id,now());if(owner.startsWith('team:'))db.prepare('INSERT INTO team_events VALUES(?,?,?,?,?,?)').run(uid(),owner,actorContext.getStore()?.actor||'system',action,id,now());};
function json(res,status,data) {res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));}
function redirect(res,url) {res.writeHead(302,{Location:url});res.end();}
async function body(req,maxBytes=2*1024*1024,rawJson=false) {
  if(!rawJson&&!(req.headers['content-type']||'').startsWith('application/json'))throw Error('请使用 application/json');
  let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>maxBytes)throw Error('请求内容过大');chunks.push(chunk);}return JSON.parse(Buffer.concat(chunks).toString()||'{}');
}
async function remoteJSON(url,options={}) {
  const u=new URL(url);if(u.protocol!=='https:')throw Error('远程接口必须使用 HTTPS');
  const r=await fetch(u,{...options,redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!r.ok)throw Error(`远程服务返回 HTTP ${r.status}`);
  const text=await r.text();if(text.length>2e6)throw Error('远程响应过大');return JSON.parse(text);
}
const catalogLoaders=Object.fromEntries(['crmeb-pro','crmeb-store'].map(target=>[target,createCatalogLoader(remoteJSON,target)]));
const tigshopCatalogs=new Map();
function catalogLoader(target,owner,connectionId){
 const row=malls.get(owner,connectionId,target),c=credentialsFor(target,owner,row.id),key=JSON.stringify([owner,row.id]);
 if(target==='shopxo')return async()=>{if(!c?.testedAt)throw Error('请先安装ShopXO独立扩展并保存连接');return {...shopxoCatalog(await createShopxoClient(c)('capabilities')),connectionId:row.id};};
 if(target==='yunzhong')return async()=>{if(c?.mode==='bridge'&&c?.publishingReady)return {...yunzhongCatalog(await createYunzhongBridge(c)('capabilities')),connectionId:row.id};if(c?.mode!=='official'||!c?.publishingReady)throw Error('请先测试并保存该芸众连接');return {...await loadYunzhongCategories(createYunzhongClient(c)),categoryLevel:c.categoryLevel,connectionId:row.id};};
 if(target!=='tigshop'){
  if(!row.legacy&&!c?.url)throw Error('请先保存该商城连接');
  if(!privateBrandCatalogs.has(key))privateBrandCatalogs.set(key,createCatalogLoader((url)=>remoteJSON(url,{dispatcher:mallDispatcher}),target,c?.appid&&c?.appsecret&&c?.testedAt?crmebBrandReader(target,c):null,c?.url));
  return async(force)=>({...await privateBrandCatalogs.get(key)(force),connectionId:row.id});
 }
 if(!tigshopCatalogs.has(key)){
  if(!c?.token)throw Error('请先保存该 Tigshop 连接');const client=createTigshopClient(c.token,fetch,c.url);
  tigshopCatalogs.set(key,createTigshopCatalog(url=>client(url.replace('https://xiaolango.com/adminapi/product/','')),c.token));
 }
 return async(force)=>({...await tigshopCatalogs.get(key)(force),connectionId:row.id});
}
async function validateCatalog(p,owner){
 const check=async product=>{const target=product.catalog_target||'crmeb-pro',row=malls.get(owner,product.catalog_connection_id,target);product.catalog_connection_id=row.id;if(product.category_id||product.brand_ids?.length)applyCatalog(product,await catalogLoader(target,owner,row.id)());return product;};
 if(p.mall_mappings!==undefined){
  await Promise.all(p.mall_mappings.map(mapping=>check(mapping)));
  const active=p.mall_mappings.find(m=>m.catalog_connection_id===p.catalog_connection_id&&m.catalog_target===(p.catalog_target||'crmeb-pro'));
  if(active)Object.assign(p,active);else if(p.category_id||p.brand_ids?.length)throw Error('当前商城分类品牌不在已保存映射中');
 }
 return check(p);
}
async function checkedBulkMapping(owner,input){
 if(!input||!Number.isSafeInteger(input.category_id??0)||!Array.isArray(input.brand_ids??[]))throw Error('请选择分类或品牌');
 const mall=malls.get(owner,input.catalog_connection_id,input.catalog_target),catalog=await catalogLoader(mall.system,owner,mall.id)();
 const category=input.category_id?(catalog.categories||[]).find(r=>r.id===input.category_id):null,brand=input.brand_ids?.length?(catalog.brands||[]).find(r=>r.id===input.brand_ids.at(-1)):null;
 if(input.category_id&&!category)throw Error('分类不可用，请重新读取商城分类');if(input.brand_ids?.length&&!brand)throw Error('品牌不可用，请重新读取商城品牌');if(!category&&!brand)throw Error('请至少选择分类或品牌之一');
 return {catalog_connection_id:mall.id,catalog_target:mall.system,category_id:category?.id||0,category:category?.label||'',brand_ids:brand?.ids||[],tag_ids:[]};
}
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
  collectors.record(id,actorContext.getStore()?.actor||owner,actorContext.getStore()?.name||'');
  audit(owner,'product.create',id);return id;
}
// Unselected jobs keep external URLs. Opted-in jobs must finish bounded image transfer before any connector sees the snapshot.
async function dispatch(job,p,action='publish_draft',verification={}) {
 try {
  job=db.prepare('SELECT * FROM jobs WHERE id=?').get(job.id)||job;
  const mall=malls.forJob(job);job={...job,mall_connection_id:mall.id};
  if(p.catalog_connection_id&&p.catalog_connection_id!==mall.id)throw Error('任务快照与目标商城连接不匹配');
  if(action==='publish_draft'){try{const plan=db.prepare('SELECT mall_origin FROM image_transfer_jobs WHERE job_id=?').get(job.id);if(plan&&mallOrigin(mallImageOrigin(mall))!==plan.mall_origin)throw Error('商城域名已变化，请恢复原连接后重试');if(plan){p=await images.transfer(job)||p;if(mallOrigin(mallImageOrigin(mall))!==plan.mall_origin)throw Error('商城域名已变化，请恢复原连接后重试');}if(['crmeb-pro','crmeb-store'].includes(job.target))assertCrmebImageLengths(p);}catch(e){db.prepare("UPDATE jobs SET status='unknown',message=?,updated=? WHERE id=? AND status='dispatching'").run('发布前图片处理未完成，未调用商城创建；请核对后重试原未领取任务。'+e.message,now(),job.id);return;}}
  // Repair only unclaimed store snapshots, including legacy n8n retries. Source products remain unchanged.
  if(action==='publish_draft'&&job.target==='crmeb-store'&&p.crmeb_native_specs===true){
   const snapshot=db.prepare('SELECT claimed FROM job_snapshots WHERE job_id=?').get(job.id);
   if(snapshot?.claimed===0){const attributes=storeLease({product:p}).product.attributes;if(JSON.stringify(attributes)!==JSON.stringify(p.attributes)){p={...p,attributes};const result=db.prepare('UPDATE job_snapshots SET product=? WHERE job_id=? AND claimed=0').run(JSON.stringify(p),job.id);if(!result.changes)throw Error('任务已领取，不能修改参数');}}
  }
  if(['crmeb-pro','crmeb-store'].includes(job.target)&&!mall.legacy){db.prepare("INSERT OR IGNORE INTO job_transports VALUES(?,'direct')").run(job.id);await crmebRunner(job,action);return;}
  if(job.target==='shopxo'){db.prepare("INSERT OR IGNORE INTO job_transports VALUES(?,'direct')").run(job.id);await shopxoRunner(job,action);return;}
  if(job.target==='yunzhong'){db.prepare("INSERT OR IGNORE INTO job_transports VALUES(?,'direct')").run(job.id);await yunzhongRunner(job,action);return;}
  if(job.target==='tigshop'){
    db.prepare("INSERT OR IGNORE INTO job_transports VALUES(?,'direct')").run(job.id);
    await directRunner(job,action);return;
  }
  const payload={job_id:job.id,idempotency_key:job.id,action,target:job.target,product_revision:job.revision,product:p,...verification,callback:{url:origin+'/api/callback/'+job.id,token:job.token}};
  try {
    const connection=connectionFor(job.target,job.owner,job.mall_connection_id);if(!connection.url||!connection.token)throw Error('目标商城未配置');
    const r=await fetch(connection.url,{method:'POST',headers:{'Content-Type':'application/json','X-Ops-Token':connection.token,'Idempotency-Key':job.id},body:JSON.stringify(payload),redirect:'error',signal:AbortSignal.timeout(15000)});
    if(r.ok)db.prepare("UPDATE jobs SET status='accepted',message='n8n 已接收，等待执行结果',updated=? WHERE id=? AND status='dispatching'").run(now(),job.id);
    else db.prepare("UPDATE jobs SET status='unknown',message=?,updated=? WHERE id=? AND status='dispatching'").run('发布入口返回 HTTP '+r.status+'；请到连接与配置测试该商城发布入口，核对后重发原未领取任务',now(),job.id);
  } catch {db.prepare("UPDATE jobs SET status='unknown',message='未确认 n8n 是否接收，请核对执行记录；不会自动重发',updated=? WHERE id=? AND status='dispatching'").run(now(),job.id);}
 }catch{db.prepare("UPDATE jobs SET status='unknown',message='商城连接或任务归属发生变化，请核对原商城记录；未自动重发',updated=? WHERE id=? AND status NOT IN ('succeeded','failed')").run(now(),job.id);}
}
db.prepare("UPDATE jobs SET status='unknown',message='服务重启，请先核对商城与执行记录',updated=? WHERE status='dispatching' OR (target IN ('tigshop','yunzhong','crmeb-pro','crmeb-store','shopxo') AND status IN ('accepted','verifying') AND id IN (SELECT job_id FROM job_transports WHERE mode='direct'))").run(now());
setInterval(()=>db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now()),60000).unref();
const handleRequest=async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  try {
    const path=new URL(req.url,'http://localhost').pathname;
    if(req.method==='GET'&&path==='/api/system-info')return json(res,200,branding.read());
    if(req.method==='GET'&&(path==='/favicon.ico'||path==='/default-icon.svg'||/^\/api\/system-assets\/(icon|logo)$/.test(path))){const slot=path.endsWith('logo')?'logo':'icon',saved=path==='/default-icon.svg'?null:branding.asset(slot);if(!saved&&slot==='logo')return json(res,404,{error:'未设置Logo'});res.writeHead(200,{'Content-Type':saved?.mime||'image/svg+xml','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"});return res.end(saved?Buffer.from(saved.bytes):DEFAULT_ICON);}
    if(path==='/healthz')return json(res,200,{ok:true});
    if(req.method==='GET' && ['/','/app.js','/pricing.js','/sku-images.js','/detail-images.js','/connection-status.js','/collector-version.js','/product-attributes.js','/specifications.js','/style.css','/list-view.js','/mall-mappings.js','/merge-products.js','/bulk-settings.js'].includes(path)) {const file=path==='/'?'index.html':path.slice(1);const data=await readFile(join(root,'public',file));res.writeHead(200,{'Content-Type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html; charset=utf-8'});return res.end(file==='index.html'?renderSystemBranding(data.toString(),branding.read()):data);}
    const nativeNotice=path.match(/^\/api\/notification-relay\/([a-zA-Z0-9-]{8,80})\/(paid|refund)$/);
    if(nativeNotice){
      if(demo||req.method!=='POST')return json(res,403,{errcode:1});
      try{return json(res,200,nativeRelay.receive(nativeNotice[1],nativeNotice[2],new URL(req.url,origin).searchParams.get('key'),await body(req,8192,true)));}
      catch{return json(res,400,{errcode:1,errmsg:'通知未接收，请核对专用地址、模板及开关'});}
    }
    const notificationPush=path.match(/^\/api\/notification-push\/([a-zA-Z0-9-]{8,80})\/(token|paid|refund|ignore)$/);
    if(notificationPush){
      const [,id,kind]=notificationPush;
      if(demo||!(req.method==='POST'||kind==='token'&&req.method==='GET'))return json(res,403,{code:1});
      try{
        if(!findNotificationMall(id))throw Error('invalid_mall');
        const input=req.method==='GET'?Object.fromEntries(new URL(req.url,origin).searchParams):await body(req,512*1024);
        return json(res,200,kind==='token'?notifications.issueToken(id,input):notifications.receive(id,kind,new URL(req.url,origin).searchParams.get('pushToken'),input));
      }catch{return json(res,400,{code:1,msg:'推送未接收，请核对配置与事件数据'});}
    }
    let s=sessionGet(req);if(s?.user){actorContext.getStore().actor=s.user.sub;actorContext.getStore().name=s.user.name||'';}
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
      if((teams.member(claims.sub)&&!teams.member(claims.sub).active)||(!allowed.includes(claims.sub)&&!teams.context(claims.sub)))return json(res,403,{error:'账号未获运营后台访问权限，请由管理员将 Casdoor 的 sub 加入 ALLOWED_SUBJECTS'});
      sessionSet(res,{user:{sub:claims.sub,name:claims.name||claims.preferred_username||claims.sub},csrf:secret()});audit(claims.sub,'login','');return redirect(res,'/');
    }
    if(path.startsWith('/api/callback/') && req.method==='POST') {
      if(demo)return json(res,403,{error:'演示模式禁止外部回调'});
      const route=path.match(/^\/api\/callback\/([^/]+)(\/claim|\/merchant-token)?$/);if(!route)return json(res,404,{error:'接口不存在'});
      const id=route[1]; let job=db.prepare('SELECT * FROM jobs WHERE id=?').get(id);
      if(!job || !equal(req.headers.authorization,'Bearer '+job.token))return json(res,403,{error:'回调认证失败'});
      if(db.prepare("SELECT 1 FROM job_transports WHERE job_id=? AND mode='direct'").get(id))return json(res,409,{error:'此任务由 OPS 直接处理，不接受旧工作流回调'});
      const b=await body(req);
      job=db.prepare('SELECT * FROM jobs WHERE id=?').get(id);
      // A direct retry may have taken ownership while the old request body streamed.
      if(db.prepare("SELECT 1 FROM job_transports WHERE job_id=? AND mode='direct'").get(id))return json(res,409,{error:'此任务由 OPS 直接处理，不接受旧工作流回调'});
      const snapshot=db.prepare('SELECT * FROM job_snapshots WHERE job_id=?').get(id);
      if(route[2]==='/merchant-token'){
        if(demo||!['crmeb-pro','crmeb-store'].includes(job.target)||!snapshot||!['dispatching','accepted','unknown','awaiting_review','verifying'].includes(job.status))return json(res,409,{error:'此任务不可获取商城授权'});
        const token=await fetchCrmebToken(job.target,credentialsFor(job.target,job.owner,job.mall_connection_id));
        // The task may have completed while the merchant auth request was in flight.
        const latest=db.prepare('SELECT status,owner FROM jobs WHERE id=?').get(id);
        if(!latest||latest.owner!==job.owner||!['dispatching','accepted','unknown','awaiting_review','verifying'].includes(latest.status))return json(res,409,{error:'任务状态已变化'});
        return json(res,200,{status:200,data:{access_token:token,token}});
      }
      if(route[2]){
        if(!officialTargets.includes(job.target)||!snapshot)return json(res,409,{error:'此任务没有官方发布快照'});
        if(b.action==='inspect_publish'){
          if(db.prepare("SELECT 1 FROM image_transfer_jobs WHERE job_id=? AND state!='done'").get(id))return json(res,409,{error:'图片转存尚未完成，不能领取创建'});
          if(snapshot.claimed || !['dispatching','accepted','unknown'].includes(job.status))return json(res,409,{error:'此任务不可重新创建，请先核对商城记录'});
        }else if(b.action==='publish_draft'){
          if(db.prepare("SELECT 1 FROM image_transfer_jobs WHERE job_id=? AND state!='done'").get(id))return json(res,409,{error:'图片转存尚未完成，不能领取创建'});
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
    if(path!=='/auth/logout'&&s?.user&&teams.member(s.user.sub)&&!teams.member(s.user.sub).active)return json(res,403,{error:'团队成员已停用，请联系管理员'});
    if(path==='/api/me')return json(res,200,{user:s?.user||null,team:s?.user?teams.context(s.user.sub):null,csrf:s?.csrf||'',demo,system:systemRelease,systemAdmin:!demo&&isSystemAdmin(s?.user?.sub),branding:branding.read(),authReady:demo||!!(client&&clientSecret&&allowed.length)});
    if(!s?.user)return json(res,401,{error:'请先登录'});
    if(!['GET','HEAD'].includes(req.method)) {
      if(req.headers.origin!==origin || !equal(req.headers['x-csrf-token'],s.csrf))return json(res,403,{error:'请求来源或 CSRF 校验失败'});
    }
    if(['/api/image-storage','/api/image-storage/test'].includes(path)){
      if(!isSystemAdmin(s.user.sub))return json(res,403,{error:'仅系统管理员可配置共享图片存储'});
      if(req.method==='GET'&&path==='/api/image-storage')return json(res,200,images.view());
      if(req.method==='POST'){if(demo)throw Error('演示模式不操作存储');const input=await body(req);const result=path.endsWith('/test')?await images.test(input):images.save(input);audit(s.user.sub,path.endsWith('/test')?'image_storage.test':'image_storage.save','global');return json(res,200,result);}
    }
    if(path==='/api/system-settings'){
      if(!isSystemAdmin(s.user.sub))return json(res,403,{error:'仅指定的系统管理员可管理全站基本信息'});
      if(req.method==='GET')return json(res,200,branding.read());
      if(req.method==='POST'){if(demo)return json(res,403,{error:'演示模式不修改全站设置'});try{return json(res,200,branding.save(await body(req,3*1024*1024),s.user.sub));}catch(e){return json(res,e.httpStatus||400,{error:e.message});}}
    }
    if(req.method==='GET'&&['/api/extensions/shopxo-bridge','/api/extensions/shopxo-bridge/download','/api/extensions/shopxo-bridge/guide'].includes(path)){
      if(path.endsWith('/guide')){const text=await readFile(join(root,'integrations/shopxo/bridge/INSTALL.md'));res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8','Content-Disposition':'attachment; filename="shopxo-install.md"'});return res.end(text);}
      const release=await createShopxoPackage(join(root,'integrations/shopxo/bridge'));
      if(path.endsWith('/download')){res.writeHead(200,{'Content-Type':'application/gzip','Content-Disposition':'attachment; filename="'+release.filename+'"','Content-Length':release.bytes.length});return res.end(release.bytes);}
      return json(res,200,{version:release.version,filename:release.filename,bytes:release.bytes.length,sha256:release.sha256});
    }
    if(req.method==='GET'&&['/api/extensions/yunzhong-bridge','/api/extensions/yunzhong-bridge/download','/api/extensions/yunzhong-bridge/guide'].includes(path)){
      if(path.endsWith('/guide')){const bytes=await readFile(join(root,'integrations/yunzhong/ops-bridge/INSTALL.md'));res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8','Content-Disposition':'attachment; filename="yunzhong-install.md"','Cache-Control':'private, no-store'});return res.end(bytes);}
      const release=await createYunzhongPackage(join(root,'integrations/yunzhong/ops-bridge'));
      if(path.endsWith('/download')){res.writeHead(200,{'Content-Type':'application/gzip','Content-Disposition':'attachment; filename="'+release.filename+'"','Content-Length':release.bytes.length,'Cache-Control':'private, no-store'});return res.end(release.bytes);}
      return json(res,200,{version:release.version,filename:release.filename,bytes:release.bytes.length,sha256:release.sha256,downloadUrl:'/api/extensions/yunzhong-bridge/download'});
    }
    if(req.method==='GET'&&['/api/extensions/1688-collector','/api/extensions/1688-collector/download'].includes(path)){
      const release=await collectorRelease();
      if(path.endsWith('/download')){
        res.writeHead(200,{'Content-Type':'application/zip','Content-Disposition':'attachment; filename="'+release.filename+'"','Content-Length':release.bytes.length});return res.end(release.bytes);
      }
      return json(res,200,{name:release.name,version:release.version,bytes:release.bytes.length,sha256:release.sha256,downloadUrl:'/api/extensions/1688-collector/download'});
    }
    const actor=s.user.sub,team=teams.context(actor),owner=team?.id||actor;
    malls.ensure(owner);
    if(!teamPermission(team?.role,path,req.method))return json(res,403,{error:'当前团队角色无权执行此操作'});
    if(path==='/api/image-storage/availability'&&req.method==='GET')return json(res,200,{malls:malls.list(owner).map(m=>({id:m.id,available:images.available(mallImageOrigin(m))}))});
    if(path==='/api/team'&&req.method==='GET')return json(res,200,{team,members:team?teams.list(team.id):[],events:team?db.prepare('SELECT actor,action,object_id,created FROM team_events WHERE team_id=? ORDER BY created DESC LIMIT 50').all(team.id):[]});
    if(path==='/api/team'&&req.method==='POST'){
      if(demo)throw Error('演示模式不创建团队');const b=await body(req);
      const created=teams.create(actor,b.name,[savedConnections,yunzhongConnections,shopxoConnections,mallProfiles,...Object.values(brandConnectionStores)],malls.moveOwner);audit(created.id,'team.created',created.id);return json(res,201,{team:created});
    }
    if(path==='/api/team/members'&&req.method==='POST'){
      if(demo)throw Error('演示模式不修改团队');const b=await body(req);const result=teams.setMember(actor,b.sub,b.role,b.active??1);audit(owner,'team.member_updated',b.sub);return json(res,200,result);
    }
    if(path==='/api/malls'&&req.method==='POST'){
      if(demo)throw Error('演示模式不添加商城');const b=await body(req),row=malls.create(owner,b.system,b.name);audit(owner,'connection.mall_created',row.id);return json(res,201,{connection:row});
    }
    const settingsSystem=path.match(/^\/api\/connections\/(crmeb-pro|crmeb-store|tigshop|yunzhong|shopxo)(?:\/|$)/)?.[1];
    const settingsMall=settingsSystem?malls.get(owner,new URL(req.url,origin).searchParams.get('connection_id'),settingsSystem):null;
    const settingsScope=settingsMall?malls.scope(settingsMall):owner;
    const notificationRoute=path.match(/^\/api\/connections\/(?:crmeb-pro|crmeb-store|tigshop)\/notifications(?:\/(test|retry|relay-retry|relay-check|refund-check|source-check))?$/);
    if(notificationRoute){
      const meta=()=>({...notifications.publicConfig(settingsMall),...nativeRelay.meta(settingsMall,origin),tigshopPoll:settingsMall.system==='tigshop'?tigshopNoticePoll.state(settingsMall.id):undefined,refundPoll:refundPoll.state(settingsMall.id),tokenUrl:origin+'/api/notification-push/'+settingsMall.id+'/token',paidUrl:origin+'/api/notification-push/'+settingsMall.id+'/paid',refundUrl:origin+'/api/notification-push/'+settingsMall.id+'/refund',ignoreUrl:origin+'/api/notification-push/'+settingsMall.id+'/ignore'});
      if(req.method==='GET'&&!notificationRoute[1])return json(res,200,meta());
      if(req.method==='POST'){
        if(demo)throw Error('演示模式不发送或保存通知');const input=await body(req);
        if(notificationRoute[1]==='source-check'){if(settingsMall.system!=='tigshop')throw Error('通知系统不匹配');await tigshopNoticePoll.enable(settingsMall);audit(owner,'notification.tigshop_poll_enabled',settingsMall.id);setImmediate(()=>tigshopNoticePoll.checkNow(settingsMall.id).catch(()=>console.error('tigshop_notification_poll_failed')));}
        else if(notificationRoute[1]==='relay-retry'){nativeRelay.retry(settingsMall,String(input.id||''));audit(owner,'notification.relay_retry',settingsMall.id);}
        else if(notificationRoute[1]==='relay-check'){await nativeRelay.check(settingsMall);audit(owner,'notification.relay_checked',settingsMall.id);}
        else if(notificationRoute[1]==='refund-check'){if(settingsMall.system==='tigshop')throw Error('请使用Tigshop通知接口检查');await refundPoll.enable(settingsMall);audit(owner,'notification.refund_poll_enabled',settingsMall.id);setImmediate(()=>refundPoll.run(settingsMall.id,true).catch(()=>console.error('refund_poll_failed')));}
        else if(notificationRoute[1]==='test'){notifications.test(settingsMall);audit(owner,'notification.test_queued',settingsMall.id);}
        else if(notificationRoute[1]==='retry'){notifications.retry(settingsMall,String(input.id||''));audit(owner,'notification.retry',settingsMall.id);}
        else{notifications.save(settingsMall,input);audit(owner,'notification.settings_saved',settingsMall.id);}
        return json(res,200,meta());
      }
    }
    const profileRoute=path.match(/^\/api\/connections\/(crmeb-pro|crmeb-store|tigshop|yunzhong|shopxo)\/profile$/);
    if(profileRoute&&req.method==='POST'){
      if(demo)throw Error('演示模式不保存商城名称');
      const b=await body(req),name=typeof b.name==='string'?b.name.trim():'';
      if(!name||[...name].length>50||/[\u0000-\u001f\u007f]/.test(name))throw Error('商城名称须为1–50字，不能包含控制字符');
      const target=profileRoute[1],profiles=mallProfiles.get(owner)||{};malls.rename(owner,settingsMall.id,name,b.badge);
      if(settingsMall.legacy)mallProfiles.set(owner,{...profiles,[target]:{name}});audit(owner,'connection.mall_renamed',target);
      return json(res,200,{ok:true,name,system:targets.find(t=>t.id===target).name});
    }
    const publishConnectionRoute=path.match(/^\/api\/connections\/(crmeb-pro|crmeb-store)\/publishing(\/test)?$/);
    if(publishConnectionRoute){
      const target=publishConnectionRoute[1],store=brandConnectionStores[target],old=store.get(settingsScope),current=connectionFor(target,owner,settingsMall.id);
      if(req.method==='GET'&&!publishConnectionRoute[2])return json(res,200,{configured:!!(current.url&&current.token),url:current.url||('https://n8n.mainapis.com/webhook/'+(target==='crmeb-pro'?'ops-crmeb-official':'ops-crmeb-store')),hasToken:!!current.token,source:old?.webhookToken?'page':'environment'});
      if(req.method==='POST'){
        if(demo)throw Error('演示模式不保存或测试发布连接');
        const b=await body(req),connection=validateCrmebWebhook(target,b.url||current.url,b.token||current.token);
        if(publishConnectionRoute[2])return json(res,200,await testCrmebWebhook(connection));
        store.set(settingsScope,{...old,webhookUrl:connection.url,webhookToken:connection.token});
        audit(owner,'connection.'+target+'_publishing_saved',target);
        return json(res,200,{ok:true,message:'发布连接已保存，后续发布和未领取任务重发将使用此配置'});
      }
    }
    const merchantAuthRoute=path.match(/^\/api\/connections\/(crmeb-pro|crmeb-store)\/auth(\/test)?$/);
    if(merchantAuthRoute){
      const target=merchantAuthRoute[1],store=brandConnectionStores[target],old=store.get(settingsScope);
      if(req.method==='GET'&&!merchantAuthRoute[2])return json(res,200,{configured:!!(old?.appid&&old?.appsecret),appid:old?.appid||'',url:old?.url||(settingsMall.legacy?MALL_SYSTEMS[target].origin:''),shippingTemplateId:old?.shippingTemplateId||0,testedAt:old?.authTestedAt||old?.testedAt||''});
      if(req.method==='POST'){
        if(demo)throw Error('演示模式不保存或测试商城凭据');
        const b=await body(req),appid=String(b.appid||old?.appid||'').trim();
        if(!b.appsecret&&old&&appid!==old.appid)throw Error('更换 AppID 时请填写对应 AppSecret');
        const url=mallOrigin(b.url||old?.url||(settingsMall.legacy?MALL_SYSTEMS[target].origin:''));
        if(old?.url&&url!==old.url&&!b.appsecret)throw Error('更换商城地址时必须重新填写密钥');
        if(old?.url&&url!==old.url&&db.prepare("SELECT 1 FROM jobs WHERE owner=? AND mall_connection_id=? LIMIT 1").get(owner,settingsMall.id))throw Error('该连接已有发布历史，请添加新商城连接，保留原商城归属');
        if(settingsMall.legacy&&url!==MALL_SYSTEMS[target].origin)throw Error('原工作流绑定历史商城地址，请添加新的商城连接，不要改动旧连接地址');
        requireDistinctMall(owner,settingsMall,url);
        const shippingTemplateId=Number(b.shippingTemplateId??old?.shippingTemplateId??0);if(!settingsMall.legacy&&(!Number.isSafeInteger(shippingTemplateId)||shippingTemplateId<=0))throw Error('请填写该商城真实运费模板 ID');
        const appsecret=b.appsecret||old?.appsecret;
        await fetchCrmebToken(target,{appid,appsecret,url});
        if(merchantAuthRoute[2])return json(res,200,{ok:true,message:'商城鉴权成功，可保存供商品发布使用'});
        const same=old?.appid===appid&&old?.appsecret===appsecret&&(!old?.url||old.url===url);
        store.set(settingsScope,{...old,appid,appsecret,url,shippingTemplateId,authTestedAt:now(),testedAt:same?old?.testedAt||'':''});
        privateBrandCatalogs.delete(JSON.stringify([owner,settingsMall.id]));
        audit(owner,'connection.'+target+'_auth_saved',target);
        return json(res,200,{ok:true,message:'商城凭证已加密保存，商品发布使用此配置'});
      }
    }
    const brandConnectionRoute=path.match(/^\/api\/connections\/(crmeb-pro|crmeb-store)(\/test)?$/);
    if(brandConnectionRoute){
      const target=brandConnectionRoute[1],store=brandConnectionStores[target],old=store.get(settingsScope);
      if(req.method==='GET'&&!brandConnectionRoute[2])return json(res,200,{configured:!!(old?.appid&&old?.appsecret),appid:old?.appid||'',url:old?.url||(settingsMall.legacy?MALL_SYSTEMS[target].origin:''),shippingTemplateId:old?.shippingTemplateId||0,testedAt:old?.testedAt||''});
      if(req.method==='POST'){
        if(demo)throw Error('演示模式不保存商城凭据');
        const b=await body(req),appid=String(b.appid||old?.appid||'').trim();
        if(!b.appsecret&&old&&appid!==old.appid)throw Error('更换 AppID 时请填写对应 AppSecret');
        const url=mallOrigin(b.url||old?.url||(settingsMall.legacy?MALL_SYSTEMS[target].origin:''));
        if(old?.url&&url!==old.url&&!b.appsecret)throw Error('更换商城地址时必须重新填写密钥');
        if(old?.url&&url!==old.url&&db.prepare("SELECT 1 FROM jobs WHERE owner=? AND mall_connection_id=? LIMIT 1").get(owner,settingsMall.id))throw Error('该连接已有发布历史，请添加新商城连接，保留原商城归属');
        if(settingsMall.legacy&&url!==MALL_SYSTEMS[target].origin)throw Error('原工作流绑定历史商城地址，请添加新的商城连接，不要改动旧连接地址');
        requireDistinctMall(owner,settingsMall,url);
        const shippingTemplateId=Number(b.shippingTemplateId??old?.shippingTemplateId??0);if(!settingsMall.legacy&&(!Number.isSafeInteger(shippingTemplateId)||shippingTemplateId<=0))throw Error('请填写该商城真实运费模板 ID');
        const appsecret=b.appsecret||old?.appsecret;
        const reader=crmebBrandReader(target,{appid,appsecret,url});
        const brands=parseCatalogOptions(await reader(),'brand');
        if(brandConnectionRoute[2])return json(res,200,{ok:true,count:brands.length,message:'后台品牌读取成功'});
        store.set(settingsScope,{...old,appid,appsecret,url,shippingTemplateId,testedAt:now()});privateBrandCatalogs.delete(JSON.stringify([owner,settingsMall.id]));
        audit(owner,'connection.'+target+'_brands_saved',target);return json(res,200,{ok:true,count:brands.length});
      }
    }
    if(path==='/api/connections/yunzhong'&&req.method==='GET'){
      const c=yunzhongConnections.get(settingsScope);return json(res,200,{configured:!!c?.appsecret,appid:c?.appid||'',testedAt:c?.testedAt||'',url:c?.url||(settingsMall.legacy?LEGACY_YUNZHONG_ORIGIN:''),version:'2.3.700',bridgeVersion:c?.bridgeVersion||'',mode:c?.mode||'',publishingReady:['official','bridge'].includes(c?.mode)&&!!c?.publishingReady,categoryLevel:c?.categoryLevel||'',dispatchPrice:c?.dispatchPrice||''});
    }
    if(['/api/connections/yunzhong','/api/connections/yunzhong/test'].includes(path)&&req.method==='POST'){
      if(demo)throw Error('演示模式不保存凭据或连接商城');
      const b=await body(req),old=yunzhongConnections.get(settingsScope),credentials=requireYunzhongCredentials(b,old);if(!settingsMall.legacy&&!b.url&&!old?.url)throw Error('请填写商城地址');requireDistinctMall(owner,settingsMall,credentials.url);
      if(old&&credentials.url!==mallOrigin(old.url||LEGACY_YUNZHONG_ORIGIN)&&db.prepare("SELECT 1 FROM jobs WHERE owner=? AND target='yunzhong' AND mall_connection_id=? LIMIT 1").get(owner,settingsMall.id))throw Error('该芸众连接已有发布历史，请添加新商城连接');
      const dispatchPrice=String(b.dispatchPrice??old?.dispatchPrice??'').trim();if(!/^\d{1,7}(\.\d{1,2})?$/.test(dispatchPrice))throw Error('请填写固定运费，单位元，免运费请明确填写0');
      const mode=b.mode??old?.mode??'official';if(!['official','bridge'].includes(mode))throw Error('连接方式无效');
      let catalog,categoryLevel,publishingReady,message,bridgeVersion='';
      if(mode==='bridge'){
        const caps=await createYunzhongBridge(credentials)('capabilities');bridgeVersion=/^\d+\.\d+\.\d+$/.test(caps.bridgeVersion||'')?caps.bridgeVersion:'';catalog=yunzhongCatalog(caps);categoryLevel=catalog.categoryLevel;publishingReady=true;
        message='独立入口 '+(bridgeVersion||'版本未知')+' 连接成功，实际分类模式已读取；支持三级分类、多维规格及文字参数详情，默认创建下架商品。';
      }else{
        categoryLevel=Number(b.categoryLevel??old?.categoryLevel);if(![2,3].includes(categoryLevel))throw Error('请按照商城实际设置选择两级或三级分类模式');
        const client=createYunzhongClient(credentials);await testYunzhongConnection(client);catalog=await loadYunzhongCategories(client);
        if(categoryLevel===2&&catalog.categories.some(row=>row.ids.length>2))throw Error('读取到了三级分类，与所选两级模式不符，请核对商城设置');
        publishingReady=categoryLevel===2;
        message=publishingReady?'官方API连接与分类读取成功，仅支持两级分类、单维规格和图片详情；创建后仍需人工核对。':'官方API连接成功；三级分类暂不支持发布，连接仅供读取。';
      }
      if(path.endsWith('/test'))return json(res,200,{ok:true,categories:catalog.categories,message:message+'测试不会保存，请保存连接。'});
      yunzhongConnections.set(settingsScope,{...credentials,testedAt:now(),dispatchPrice,categoryLevel,mode,publishingReady,bridgeVersion});audit(owner,'connection.yunzhong_saved','yunzhong');
      return json(res,200,{ok:true,categories:catalog.categories,message:'已保存。'+message});
    }
    if(path==='/api/connections/tigshop'&&req.method==='GET'){
      const c=credentialsFor('tigshop',owner,settingsMall.id);return json(res,200,{configured:!!c?.token,templateId:c?.templateId||0,testedAt:c?.testedAt||'',url:c?.url||(settingsMall.legacy?'https://xiaolango.com':''),currency:'EUR'});
    }
    if(path==='/api/connections/tigshop/fx'&&req.method==='GET')return json(res,200,await fetchTigshopFX());
    if(['/api/connections/tigshop/test','/api/connections/tigshop'].includes(path)&&req.method==='POST'){
      if(demo)return json(res,403,{error:'演示模式不保存商城凭据或连接商城'});
      const b=await body(req),old=credentialsFor('tigshop',owner,settingsMall.id);
      const url=mallOrigin(b.url||old?.url||(settingsMall.legacy?'https://xiaolango.com':''));
      if(old&&url!==(old.url||'https://xiaolango.com')&&!b.token)throw Error('更换商城地址时必须重新填写 Token');
      if(old&&url!==(old.url||'https://xiaolango.com')&&db.prepare("SELECT 1 FROM jobs WHERE owner=? AND mall_connection_id=? LIMIT 1").get(owner,settingsMall.id))throw Error('该连接已有发布历史，请添加新商城连接');
      requireDistinctMall(owner,settingsMall,url);
      const token=requireTigshopToken(b.token||old?.token);
      const client=createTigshopClient(token,fetch,url),templates=await tigshopShipping(client);
      // Check the same read capabilities used to create and verify products.
      const catalog=await createTigshopCatalog(url=>client(url.replace('https://xiaolango.com/adminapi/product/','')),token)();
      if(path.endsWith('/test'))return json(res,200,{ok:true,templates,categories:catalog.categories.length,brands:catalog.brands.length,message:'连接成功，请选择运费模板后保存'});
      const templateId=Number(b.templateId);if(!templates.some(t=>t.id===templateId))throw Error('请选择商城返回的有效自营运费模板');
      const testedAt=now();savedConnections.set(settingsScope,{token,url,templateId,testedAt});tigshopCatalogs.delete(JSON.stringify([owner,settingsMall.id]));
      audit(owner,'connection.tigshop_saved','tigshop');return json(res,200,{ok:true,configured:true,templateId,testedAt});
    }
    if(path==='/api/connections/shopxo'&&req.method==='GET'){
      const c=shopxoConnections.get(settingsScope);return json(res,200,{configured:!!c?.appsecret,url:c?.url||'',appid:c?.appid||'',warehouseId:c?.warehouseId||0,testedAt:c?.testedAt||'',bridgeVersion:c?.bridgeVersion||''});
    }
    if(['/api/connections/shopxo','/api/connections/shopxo/test'].includes(path)&&req.method==='POST'){
      if(demo)throw Error('演示模式不保存或测试商城');const b=await body(req),old=shopxoConnections.get(settingsScope),credentials=requireShopxoConnection(b,old);requireDistinctMall(owner,settingsMall,credentials.url);
      if(old&&old.url!==credentials.url&&db.prepare('SELECT 1 FROM jobs WHERE owner=? AND mall_connection_id=? LIMIT 1').get(owner,settingsMall.id))throw Error('已有发布历史，请添加新的商城连接');
      const caps=await createShopxoClient(credentials)('capabilities'),catalog=shopxoCatalog(caps);
      if(path.endsWith('/test'))return json(res,200,{ok:true,warehouses:catalog.warehouses,categories:catalog.categories.length,brands:catalog.brands.length,bridgeVersion:caps.bridgeVersion,message:'ShopXO扩展连接成功，请选择实际仓库后保存'});
      const warehouseId=Number(b.warehouseId);if(!catalog.warehouses.some(w=>w.id===warehouseId))throw Error('请选择商城返回的实际仓库');
      shopxoConnections.set(settingsScope,{...credentials,warehouseId,bridgeVersion:caps.bridgeVersion,testedAt:now()});audit(owner,'connection.shopxo_saved',settingsMall.id);return json(res,200,{ok:true,message:'ShopXO连接及仓库已保存'});
    }
    const catalogRoute=path.match(/^\/api\/catalog\/(crmeb-pro|crmeb-store|tigshop|yunzhong|shopxo)$/);
    if(catalogRoute&&req.method==='GET')return json(res,200,await catalogLoader(catalogRoute[1],owner,new URL(req.url,origin).searchParams.get('connection_id'))(new URL(req.url,origin).searchParams.get('refresh')==='1'));
    if(path==='/api/jobs/650b74d9-6d5e-4174-9245-4d45163e3699/recover-zero-stock'&&req.method==='POST'){if(demo)throw Error('演示模式不执行商城操作');return json(res,200,await recoverTigshopZeroStock(db,owner,getTigshopConnection));}
    const yunzhongRecoveryRoute=path.match(/^\/api\/jobs\/([^/]+)\/recover-uncreated$/);
    if(yunzhongRecoveryRoute&&req.method==='POST'){
      if(demo)throw Error('演示模式不执行恢复');
      const result=await recoverYunzhongUncreated({db,owner,id:yunzhongRecoveryRoute[1],getConnection:(key,job)=>credentialsFor('yunzhong',key,job?.mall_connection_id)});
      audit(owner,'job.recover_yunzhong_uncreated',result.id);return json(res,200,result);
    }
    const retryRoute=path.match(/^\/api\/jobs\/([^/]+)\/retry$/);
    if(retryRoute && req.method==='POST'){
      if(demo)return json(res,503,{error:'演示模式不执行发布'});
      const job=db.prepare('SELECT * FROM jobs WHERE id=? AND owner=?').get(retryRoute[1],owner),snap=db.prepare('SELECT * FROM job_snapshots WHERE job_id=?').get(retryRoute[1]);
      if(!job||!officialTargets.includes(job.target)||!snap||snap.claimed||!['accepted','unknown'].includes(job.status))return json(res,409,{error:'任务可能已开始创建，禁止重新发送'});
      if(!connected(job.target,owner,job.mall_connection_id))return json(res,503,{error:'请先配置该目标商城连接'});
      db.prepare("UPDATE jobs SET status='dispatching',message='正在重新提交原未领取任务',updated=? WHERE id=?").run(now(),job.id);audit(owner,'job.retry_unclaimed',job.id);if(['tigshop','yunzhong','shopxo'].includes(job.target)||!malls.forJob(job).legacy){db.prepare("INSERT OR IGNORE INTO job_transports VALUES(?,'direct')").run(job.id);setImmediate(()=>dispatch(job,JSON.parse(snap.product)));}else if(db.prepare('SELECT 1 FROM image_transfer_jobs WHERE job_id=?').get(job.id))setImmediate(()=>dispatch(job,JSON.parse(snap.product)));else await dispatch(job,JSON.parse(snap.product));return json(res,202,{id:job.id});
    }
    const verificationRoute=path.match(/^\/api\/jobs\/([^/]+)\/verify$/);
    if(verificationRoute && req.method==='POST'){
      if(demo)return json(res,503,{error:'演示模式不执行发布'});
      const id=verificationRoute[1],b=await body(req),job=db.prepare('SELECT * FROM jobs WHERE id=? AND owner=?').get(id,owner),snapshot=db.prepare('SELECT * FROM job_snapshots WHERE job_id=?').get(id);
      if(!job||!officialTargets.includes(job.target)||!snapshot?.claimed||!['awaiting_review','verifying','unknown','accepted'].includes(job.status))return json(res,409,{error:'该任务暂不可核对'});
      if(!connected(job.target,owner,job.mall_connection_id))return json(res,503,{error:'请先配置该目标商城连接'});
      const candidate=String(b.remote_id||'');if(!/^[1-9][0-9]{0,14}$/.test(candidate))throw Error('请填写商城中的数字商品 ID');
      const nonce=secret();db.prepare('UPDATE job_snapshots SET candidate_id=?,verification_nonce=? WHERE job_id=?').run(candidate,nonce,id);
      db.prepare("UPDATE jobs SET status='verifying',message='正在读取官方商品详情核对',updated=? WHERE id=?").run(now(),id);
      audit(owner,'job.verify_requested',id);
      if(['tigshop','yunzhong','shopxo'].includes(job.target)||!malls.forJob(job).legacy){db.prepare("INSERT OR IGNORE INTO job_transports VALUES(?,'direct')").run(id);setImmediate(()=>dispatch(job,JSON.parse(snapshot.product),'verify_draft'));}else await dispatch(job,JSON.parse(snapshot.product),'verify_draft',{remote_id:candidate,verification_nonce:nonce});return json(res,202,{id});
    }
    if(path==='/auth/logout' && req.method==='POST'){expire(res,s.id);return json(res,200,{ok:true});}
    if(path==='/api/jobs'&&req.method==='GET'){const query=new URL(req.url,origin).searchParams;return json(res,200,jobPage(db,owner,query.get('page'),query.get('page_size'),{scope:query.get('task_scope')||'all',actor,mall:query.get('mall')||'',status:query.get('status')||''}));}
    if(path==='/api/state' && req.method==='GET'){const publications=productPublications(db,owner);return json(res,200,{team,products:collectors.rows(owner,actor,new URL(req.url,origin).searchParams.get('collection_scope')||'all').map(row=>({...decodeProduct(row),collected_by:row.collected_by||'',collector_name:row.collector_name||'',publications:publications.get(row.id)||[]})),jobs:db.prepare('SELECT id,product_id,revision,target,mall_connection_id,status,message,remote_id,created,updated FROM jobs WHERE owner=? ORDER BY created DESC LIMIT 300').all(owner).map(j=>({...j,claimed:!!db.prepare('SELECT claimed FROM job_snapshots WHERE job_id=?').get(j.id)?.claimed,marker:'OPS-'+j.id.replaceAll('-',''),fx:j.target==='tigshop'?(()=>{const snap=db.prepare('SELECT product FROM job_snapshots WHERE job_id=?').get(j.id);return snap?JSON.parse(snap.product).tigshop?.fx:null;})():null})),targets:targets.map(t=>{const row=malls.get(owner,null,t.id);return {...t,connection_id:row.id,system:t.name,name:row.name,configured:!demo&&connected(t.id,owner,row.id)};}),malls:malls.list(owner).map(row=>({...row,type:row.system,system:MALL_SYSTEMS[row.system].name,version:MALL_SYSTEMS[row.system].version,url:credentialsFor(row.system,owner,row.id)?.url||(row.legacy?MALL_SYSTEMS[row.system].origin:''),configured:!demo&&connected(row.system,owner,row.id)})),connections:{casdoor:demo?'demo':'connected',n8n:!demo&&['crmeb-pro','crmeb-store'].some(t=>connected(t,owner))?'configured':'unconfigured'},audit:db.prepare('SELECT action,object_id,created FROM audit WHERE owner=? ORDER BY created DESC LIMIT 30').all(owner)});}
    if(['/api/images/upload','/api/images/shorten'].includes(path)&&req.method==='POST'){if(demo)throw Error('演示模式不上传图片');const input=await body(req,15*1024*1024);if(path.endsWith('/shorten')&&typeof input.url!=='string')throw Error('请提供需要修复的图片地址');const result=await uploadLocalImage(owner,path.endsWith('/shorten')?{sourceUrl:input.url}:input);audit(owner,'image.upload','local');return json(res,201,result);}
    if(path==='/api/products/bulk-settings'&&req.method==='POST'){if(demo)throw Error('演示模式不修改商品');return json(res,200,await bulkProductSettings({db,owner,input:await body(req),validateMapping:m=>checkedBulkMapping(owner,m),audit}));}
    if(path==='/api/supplier-imports'&&req.method==='POST'){if(demo)throw Error('演示模式不导入货盘');return json(res,201,await supplierImport.preview(owner,await body(req,48*1024*1024)));}
    const supplierRoute=path.match(/^\/api\/supplier-imports\/([a-f0-9-]{36})(?:\/(commit|assets\/[a-f0-9]{64}))?$/);
    if(supplierRoute){const id=supplierRoute[1],action=supplierRoute[2];if(req.method==='GET'&&action?.startsWith('assets/')){const image=await supplierImport.asset(owner,id,action.slice(7));res.writeHead(200,{'Content-Type':image.mime,'Content-Length':image.bytes.length,'Cache-Control':'private, no-store'});return res.end(image.bytes);}if(req.method==='GET'&&!action)return json(res,200,supplierImport.get(owner,id));if(req.method==='DELETE'&&!action)return json(res,200,await supplierImport.remove(owner,id));if(req.method==='POST'&&action==='commit'){if(demo)throw Error('演示模式不导入货盘');const input=await body(req);if(Array.isArray(input.items)){for(const item of input.items){if(item.mall_mappings!==undefined){if(!Array.isArray(item.mall_mappings)||item.mall_mappings.length>50)throw Error('商城映射格式无效');for(const mapping of item.mall_mappings){malls.get(owner,mapping.catalog_connection_id,mapping.catalog_target);if(mapping.category_id||mapping.brand_ids?.length){const checked=await checkedBulkMapping(owner,mapping);Object.assign(mapping,checked,{tag_ids:mapping.tag_ids||[]});}}}}}return json(res,202,supplierImport.start(owner,id,input));}}
    if(['/api/products/merge-preview','/api/products/merge'].includes(path)&&req.method==='POST'){const input=await body(req);return path.endsWith('merge-preview')?json(res,200,mergeProducts.preview(owner,input)):json(res,201,mergeProducts.create(owner,input));}
    if(path==='/api/products' && req.method==='POST') {const b=await body(req);const p=await validateCatalog(validateProduct(b),owner);const repaired=await repairSavedImageUrls(p,owner,{getStorage:()=>images.get(),upload:uploadLocalImage});return json(res,201,{id:putProduct(owner,repaired)});}
    if(path==='/api/import' && req.method==='POST') {
      const b=await body(req);if(b.table!==undefined)b.products=parseOfficialExport(b.table);if(!Array.isArray(b.products)||b.products.length>100)throw Error('每次最多导入 100 件商品');
      const results=[];for(const [i,input]of b.products.entries()){try{const p=await validateCatalog(validateProduct(input),owner);results.push({index:i,id:putProduct(owner,p),ok:true});}catch(e){results.push({index:i,ok:false,error:e.message});}}return json(res,200,{results});
    }
    const match=path.match(/^\/api\/products\/([^/]+)(?:\/(approve|publish))?$/);
    if(match){const r=productFor(owner,match[1]),p=decodeProduct(r);
      if(!match[2] && req.method==='PUT') {
        const b=await body(req);if(b.revision!==r.revision)return json(res,409,{error:'商品已被更新，请刷新后重试'});
        if(p.merge_sources&&Array.isArray(b.skus)){const original=new Map(p.skus.filter(s=>s.source).map(s=>[s.sku,s.source]));b.skus=b.skus.map(s=>({...s,...(original.has(s.sku)?{source:original.get(s.sku)}:{})}));}
        const candidate=validateProduct({...b,...(p.merge_sources?{merge_sources:p.merge_sources}:{})},p.supplier_import?{supplier:p.supplier_import}:{});
        if(b.mall_mappings===undefined&&p.mall_mappings!==undefined){
          const active=malls.get(owner,candidate.catalog_connection_id,candidate.catalog_target||'crmeb-pro');candidate.catalog_connection_id=active.id;
          candidate.mall_mappings=p.mall_mappings.filter(m=>m.catalog_connection_id!==active.id).map(m=>({...m}));candidate.mall_mappings.push({catalog_connection_id:active.id,catalog_target:active.system,category_id:candidate.category_id||0,category:candidate.category||'',brand_ids:candidate.brand_ids,tag_ids:candidate.tag_ids,...(active.system==='crmeb-store'?{applicable_type:candidate.applicable_type??0}:{})});
        }
        const validated=await validateCatalog(candidate,owner);const v=await repairSavedImageUrls(validated,owner,{getStorage:()=>images.get(),upload:uploadLocalImage});if(v.source_url!==p.source_url)throw Error('来源链接不能修改');
        const result=db.prepare("UPDATE products SET data=?,status='draft',revision=revision+1,updated=? WHERE id=? AND owner=? AND revision=?").run(JSON.stringify(v),now(),r.id,owner,b.revision);
        if(!result.changes)return json(res,409,{error:'商品已被更新，请刷新后重试'});
        audit(owner,'product.edit',r.id);return json(res,200,{ok:true});
      }
      if(match[2]==='approve'&&req.method==='POST'){const b=await body(req);if(b.revision!==r.revision)return json(res,409,{error:'版本已变化，请重新检查'});await validateCatalog(p,owner);assertPublishable(p);const result=db.prepare("UPDATE products SET status='approved',updated=? WHERE id=? AND revision=?").run(now(),r.id,b.revision);if(!result.changes)return json(res,409,{error:'版本已变化，请重新检查'});audit(owner,'product.approve',r.id);return json(res,200,{ok:true});}
      if(match[2]==='publish'&&req.method==='POST') {
        if(demo)return json(res,503,{error:'尚未配置 n8n 发布连接，未发送任务'});
        const input=await body(req),current=productFor(owner,r.id);if(current.status!=='approved'||input.revision!==current.revision)throw Error('请先审核当前版本商品');
        const submit=async b=>{
        if(!targets.some(t=>t.id===b.target))throw Error('目标商城无效');
        const destination=malls.get(owner,b.connection_id,b.target),destinationId=destination.id;
        if(b.import_images!==undefined&&typeof b.import_images!=='boolean')throw Error('图片转存选项无效');
        const imagePlan=b.import_images===true?images.prepare(mallImageOrigin(destination)):null;
        const publishingProduct=productForMall(decodeProduct(current),destinationId,b.target);assertPublishable(publishingProduct);if(!imagePlan&&['crmeb-pro','crmeb-store'].includes(b.target))assertCrmebImageLengths(publishingProduct);
        if(!connected(b.target,owner,destinationId))throw Object.assign(Error('请先在连接与配置中完成目标商城连接，未发送任务'),{httpStatus:503});
        if(publishingProduct.category_id&&(publishingProduct.catalog_target||'crmeb-pro')!==b.target)throw Error('分类和品牌属于另一商城，请在编辑页选择当前目标商城并重新审核');
        if(b.target==='crmeb-store'&&(!publishingProduct.category_id||publishingProduct.catalog_target!=='crmeb-store'))throw Error('请先选择多门店分类并重新审核');
        await validateCatalog(publishingProduct,owner);
        if(['crmeb-pro','crmeb-store'].includes(b.target)){publishingProduct.crmeb_native_specs=true;publishingProduct.attributes=normalizeProductAttributes(publishingProduct.attributes);}
        if(b.target==='crmeb-store')publishingProduct.attributes=storeLease({product:publishingProduct}).product.attributes;
        if(b.target==='tigshop'){publishingProduct.tigshop_native_attributes=true;publishingProduct.attributes=normalizeProductAttributes(publishingProduct.attributes);}
        if(b.target==='yunzhong'){const connection=credentialsFor('yunzhong',owner,destinationId);const catalog=await catalogLoader('yunzhong',owner,destinationId)();const category=catalog.categories.find(c=>c.id===publishingProduct.category_id);publishingProduct.yunzhong={categoryIds:category?.ids,categoryLevel:catalog.categoryLevel,dispatchPrice:connection.dispatchPrice,mode:connection.mode,origin:connection.url||LEGACY_YUNZHONG_ORIGIN};buildYunzhongProduct({product:publishingProduct,marker:'OPS-'+'0'.repeat(32)},{...publishingProduct.yunzhong,compatibility:connection.mode==='bridge'});}
        if(b.target==='shopxo'){const c=credentialsFor('shopxo',owner,destinationId);publishingProduct.shopxo={origin:c.url,warehouseId:c.warehouseId};buildShopxoProduct({product:publishingProduct,marker:'OPS-'+'0'.repeat(32)},c.warehouseId);}
        if(b.target==='tigshop'){if(publishingProduct.catalog_target!=='tigshop'||!publishingProduct.category_id)throw Error('请选择 Tigshop 分类并重新审核');publishingProduct.tigshop={origin:credentialsFor('tigshop',owner,destinationId).url||'https://xiaolango.com',fx:await fetchTigshopFX(),shipping:{templateId:credentialsFor('tigshop',owner,destinationId).templateId}};}
        if(['crmeb-pro','crmeb-store'].includes(b.target)&&!destination.legacy){const c=credentialsFor(b.target,owner,destinationId);publishingProduct.crmeb={origin:c.url,shippingTemplateId:c.shippingTemplateId};}
        if(['crmeb-pro','crmeb-store'].includes(b.target)&&!destination.legacy)(b.target==='crmeb-store'?buildStoreProduct:buildOfficialProduct)({product:publishingProduct,marker:'OPS-'+'0'.repeat(32)},{...publishingProduct.crmeb,pendingImageTransfer:!!imagePlan});
        if(db.prepare(`SELECT j.id FROM jobs j LEFT JOIN job_snapshots s ON s.job_id=j.id WHERE j.product_id=? AND j.target=? AND j.mall_connection_id=? AND (j.status<>'failed' OR COALESCE(s.claimed,1)<>0 OR j.remote_id<>'' OR COALESCE(s.candidate_id,'')<>'' OR COALESCE(s.verification_nonce,'')<>'') LIMIT 1`).get(r.id,b.target,destinationId))throw Object.assign(Error('此商品已有官方创建任务，不能再次创建；请到发布任务核对商品 ID'),{httpStatus:409});
        const id=uid(),t=now();if(b.target==='tigshop')buildTigshopProduct({product:publishingProduct,marker:'OPS-'+id.replaceAll('-','')},publishingProduct.tigshop.fx,publishingProduct.tigshop.shipping);db.exec('BEGIN IMMEDIATE');try{const latest=productFor(owner,r.id);if(latest.revision!==current.revision||latest.status!=='approved')throw Error('商品版本或审核状态已变化，未创建此商城任务');db.prepare('INSERT INTO jobs(id,owner,product_id,revision,target,status,token,created,updated,mall_connection_id) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,owner,r.id,current.revision,b.target,'dispatching',secret(),t,t,destinationId);initiators.record(id,actor,s.user.name||'');db.prepare('INSERT INTO job_snapshots(job_id,product) VALUES(?,?)').run(id,JSON.stringify(publishingProduct));if(imagePlan)images.record(id,publishingProduct,imagePlan);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');if(String(e).includes('UNIQUE'))throw Object.assign(Error('该版本已有发布任务，请在任务列表查看结果'),{httpStatus:409});throw e;}
        audit(owner,'job.create',id);const job=db.prepare('SELECT * FROM jobs WHERE id=?').get(id);if(['tigshop','yunzhong','shopxo'].includes(job.target)||!malls.forJob(job).legacy){db.prepare("INSERT INTO job_transports VALUES(?,'direct')").run(id);setImmediate(()=>dispatch(job,publishingProduct));}else if(input.destinations||imagePlan)setImmediate(()=>dispatch(job,publishingProduct));else await dispatch(job,publishingProduct);return {id};
        };
        if(input.destinations!==undefined){
          if(!Array.isArray(input.destinations)||!input.destinations.length||input.destinations.length>10)throw Error('请选择1至10个目标商城');
          const seen=new Set();for(const d of input.destinations){if(!d||typeof d.connection_id!=='string'||!d.connection_id||seen.has(d.connection_id))throw Error('目标商城无效或重复');seen.add(d.connection_id);}
          const results=await Promise.all(input.destinations.map(async d=>{try{return {...await submit(d),connection_id:d.connection_id,target:d.target,ok:true};}catch(e){return {connection_id:d.connection_id,target:d.target,ok:false,error:e.message};}}));
          return json(res,202,{results});
        }
        try{return json(res,202,await submit(input));}catch(e){return json(res,e.httpStatus||400,{error:e.message});}
      }
    }
    return json(res,404,{error:'接口不存在'});
  } catch(e){console.error('request_failed',e.name);return json(res,400,{error:e instanceof SyntaxError?'数据格式错误':e.message||'请求失败'});}
};
export const handler=(req,res)=>actorContext.run({actor:''},()=>handleRequest(req,res));
export const closeStore=()=>{clearInterval(notificationTimer);clearInterval(supplierPruneTimer);notifications.stop();nativeRelay.stop();refundPoll.stop();tigshopNoticePoll.stop();db.close();};
const server=http.createServer(handler);
server.requestTimeout=30000;server.headersTimeout=10000;
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){notificationTimer=setInterval(()=>{nativeRelay.tick().catch(()=>console.error('native_notification_read_failed'));notifications.tick().catch(()=>console.error('notification_worker_failed'));refundPoll.tick().catch(()=>console.error('refund_poll_failed'));tigshopNoticePoll.tick().catch(()=>console.error('tigshop_notification_poll_failed'));},4000);notificationTimer.unref();}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url))server.listen(Number(process.env.PORT||3080),host,()=>console.log(`Goods Ops listening on ${host}:${process.env.PORT||3080}${demo?' [LOCAL DEMO]':''}`));
