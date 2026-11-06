import {canonicalSourceURL as sourceURL} from './public/source-url.js';
import {normalizeMallMappings} from './public/mall-mappings.js';
import {normalizeProductAttributes} from './public/product-attributes.js';
import {specificationMatrix} from './public/specifications.js';
import { DatabaseSync } from 'node:sqlite';
import {existsSync,chmodSync} from 'node:fs';
import { randomUUID, randomBytes, timingSafeEqual, createPublicKey, verify } from 'node:crypto';
export const uid = () => randomUUID();
export const secret = () => randomBytes(32).toString('base64url');
export function equal(a,b) { const x=Buffer.from(String(a||'')), y=Buffer.from(String(b||'')); return x.length===y.length && x.length>0 && timingSafeEqual(x,y); }
export {canonicalSourceURL as sourceURL} from './public/source-url.js';

function provenanceURL(value){return typeof value==='string'&&/^supplier:[a-f0-9]{64}$/.test(value)?value:sourceURL(value);}
function skuSource(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||typeof value.product_id!=='string'||!value.product_id||value.product_id.length>100||!Number.isSafeInteger(value.revision)||value.revision<1||typeof value.sku!=='string'||!value.sku||value.sku.length>100)throw Error('SKU来源记录格式无效');
 return {url:provenanceURL(value.url),sku:value.sku,product_id:value.product_id,revision:value.revision,spec:String(value.spec||'').slice(0,300)};
}
export function validateProduct(input,options={}) {
  if(!input || typeof input!=='object' || Array.isArray(input)) throw Error('商品必须是对象');
  if(input.images!==undefined && !Array.isArray(input.images)) throw Error('images 必须是数组');
  if(input.skus!==undefined && !Array.isArray(input.skus)) throw Error('skus 必须是数组');
  if(input.images?.length>30 || input.skus?.length>500) throw Error('每件商品最多 30 张图片、500 个 SKU，请拆分商品后导入');
  const p={attributes:normalizeProductAttributes(input.attributes),source_url:options.supplier?String(input.source_url):sourceURL(input.source_url),title:String(input.title||'').trim().slice(0,200),category:String(input.category||'').slice(0,100),description:String(input.description||'').slice(0,50000)};
  if(options.supplier){if(!/^supplier:[a-f0-9]{64}$/.test(p.source_url))throw Error('货盘来源标识无效');p.supplier_import=options.supplier;}
  if(input.merge_sources!==undefined){if(!Array.isArray(input.merge_sources)||input.merge_sources.length<2||input.merge_sources.length>20)throw Error('合并来源记录格式无效');p.merge_sources=input.merge_sources.map(r=>{if(!r||typeof r.product_id!=='string'||!r.product_id||r.product_id.length>100||!Number.isSafeInteger(r.revision)||r.revision<1)throw Error('合并来源记录格式无效');return {product_id:r.product_id,revision:r.revision,url:provenanceURL(r.url)};});}
  if(input.same_style!==undefined){const v=input.same_style;if(!v||typeof v.reference_id!=='string'||!Array.isArray(v.stock_ids)||!v.stock_ids.length||v.stock_ids.length>19||v.stock_ids.some(id=>typeof id!=='string'||!id||id.length>100)||!input.merge_sources?.some(r=>r.product_id===v.reference_id)||v.stock_ids.some(id=>!input.merge_sources.some(r=>r.product_id===id)))throw Error('同款整理来源格式无效');const matches=v.matches??[];if(!Array.isArray(matches)||matches.length>500||matches.some(r=>!r||!v.stock_ids.includes(r.product_id)||typeof r.sku!=='string'||!r.sku||r.sku.length>100||typeof r.reference_sku!=='string'||r.reference_sku.length>100))throw Error('同款SKU对应记录格式无效');p.same_style={reference_id:v.reference_id,stock_ids:[...v.stock_ids],matches:matches.map(r=>({product_id:r.product_id,sku:r.sku,reference_sku:r.reference_sku}))};}
  if(input.mall_mappings!==undefined)p.mall_mappings=normalizeMallMappings(input.mall_mappings);
  if(input.catalog_target!==undefined&&!['crmeb-pro','crmeb-store','tigshop','yunzhong','shopxo'].includes(input.catalog_target))throw Error('商品资料所属商城无效');
  if(input.category_id!==undefined){
    if(!Number.isSafeInteger(input.category_id)||input.category_id<0)throw Error('商城分类 ID 无效');
    p.category_id=input.category_id;p.catalog_target=input.catalog_target||'crmeb-pro';
  }
  if(input.catalog_target!==undefined)p.catalog_target=input.catalog_target;
  if(input.catalog_connection_id!==undefined){if(typeof input.catalog_connection_id!=='string'||input.catalog_connection_id.length>100||!input.catalog_connection_id)throw Error('商城连接 ID 无效');p.catalog_connection_id=input.catalog_connection_id;}
  if(p.catalog_target==='crmeb-store'){p.applicable_type=input.applicable_type??0;if(![0,1].includes(p.applicable_type))throw Error('请选择所有门店或仅平台');}
  if(input.sourcing!==undefined){
    if(!input.sourcing||typeof input.sourcing!=='object'||Array.isArray(input.sourcing))throw Error('采购参考资料格式错误');
    p.sourcing=Object.fromEntries(['purchase_price','dropship_price','category','tags','supplier_sales','shipping_time','listed_at'].map(key=>[key,String(input.sourcing[key]??'').slice(0,300)]));
  }
  for(const key of ['brand_ids','tag_ids']){
    const ids=input[key]??[];
    if(!Array.isArray(ids)||ids.length>50||ids.some(id=>!Number.isSafeInteger(id)||id<=0)||new Set(ids).size!==ids.length)throw Error('品牌和标签必须是互不重复的正整数 ID');
    p[key]=ids;
  }
  p.virtual_sales=input.virtual_sales??0;
  if(!Number.isSafeInteger(p.virtual_sales)||p.virtual_sales<0||p.virtual_sales>2147483647)throw Error('虚拟销量必须是 0–2147483647 的整数');
  p.images=(Array.isArray(input.images)?input.images:[]).slice(0,30).map(v=>{ const u=new URL(v); if(u.protocol!=='https:' || u.username || u.password) throw Error('图片地址必须使用 HTTPS'); return u.href; });
  if(input.detail_images!==undefined&&(!Array.isArray(input.detail_images)||input.detail_images.length>100))throw Error('详情图必须为数组且最多 100 张');
  p.detail_images=(input.detail_images||[]).map(v=>{const u=new URL(v);if(u.protocol!=='https:'||u.username||u.password)throw Error('详情图必须使用无账号密码的 HTTPS 地址');return u.href;});
  p.skus=(Array.isArray(input.skus)?input.skus:[]).slice(0,500).map(s=>{
    const v={sku:String(s.sku||'').trim().slice(0,100),spec:String(s.spec||'').slice(0,300),cost:Number(s.cost),price:Number(s.price),stock:Number(s.stock)};
    if(s.source!==undefined)v.source=skuSource(s.source);
    if(s.spec_values!==undefined)v.spec_values=s.spec_values;
    if(s.image){const u=new URL(s.image);if(u.protocol!=='https:'||u.username||u.password)throw Error('SKU 图片必须是无账号密码的 HTTPS 地址');v.image=u.href;}
    if(!v.sku || !Number.isFinite(v.cost) || !Number.isFinite(v.price) || v.cost<0 || v.price<0 || !Number.isSafeInteger(v.stock) || v.stock<0) throw Error('SKU 编码、成本、售价或库存格式错误');
    return v;
  });
  const matrix=specificationMatrix({...p,...(input.spec_names!==undefined?{spec_names:input.spec_names}:{})});
  if(matrix.structured){p.spec_names=matrix.names;p.skus.forEach((s,i)=>{s.spec_values=matrix.rows[i];s.spec=matrix.rows[i].join(' / ');});}
  if(new Set(p.skus.map(s=>s.sku)).size!==p.skus.length) throw Error('SKU 编码不能重复');
  return p;
}
export function assertPublishable(p) {
  if(!p.title || !p.images.length || !p.skus.length || !(p.category||p.mall_mappings?.some(m=>m.category_id&&m.category))) throw Error('请补全标题、分类、图片与 SKU 后再审核');
  if(p.skus.some(s=>s.price<=0)) throw Error('每个 SKU 必须有大于零的售价');
}
export function verifyIdToken(token,jwks,{issuer,audience,nonce,now=Math.floor(Date.now()/1000)}) {
  const parts=String(token).split('.'); if(parts.length!==3) throw Error('ID Token 格式错误');
  const header=JSON.parse(Buffer.from(parts[0],'base64url')), claims=JSON.parse(Buffer.from(parts[1],'base64url'));
  if(header.alg!=='RS256' || header.crit) throw Error('只接受 RS256 签名的 ID Token，请在 Casdoor 配置 RS256');
  const keys=jwks.keys.filter(k=>k.kty==='RSA' && (!header.kid || k.kid===header.kid) && (!k.use || k.use==='sig') && (!k.alg || k.alg==='RS256'));
  if(keys.length!==1 || !verify('RSA-SHA256',Buffer.from(parts[0]+'.'+parts[1]),createPublicKey({key:keys[0],format:'jwk'}),Buffer.from(parts[2],'base64url'))) throw Error('ID Token 签名无效');
  const aud=Array.isArray(claims.aud)?claims.aud:[claims.aud];
  if(claims.iss!==issuer || !aud.includes(audience) || (aud.length>1 && claims.azp!==audience) || (claims.azp && claims.azp!==audience)) throw Error('ID Token 签发者或接收者无效');
  if(!Number.isFinite(claims.exp) || claims.exp<=now || !Number.isFinite(claims.iat) || claims.iat>now+60 || (claims.nbf && claims.nbf>now+60)) throw Error('ID Token 已过期或尚未生效');
  if(!claims.sub || !equal(claims.nonce,nonce)) throw Error('ID Token 身份或 nonce 无效');
  return claims;
}
export function openStore(path) {
  const existed=path!==':memory:'&&existsSync(path),db=new DatabaseSync(path);
  const jobTable=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='jobs'").get();
  if(existed&&jobTable&&!db.prepare('PRAGMA table_info(jobs)').all().some(row=>row.name==='mall_connection_id')){const backup=path+'.pre-mall-connections-'+Date.now()+'.sqlite';db.prepare('VACUUM INTO ?').run(backup);chmodSync(backup,0o600);}
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
  CREATE TABLE IF NOT EXISTS products(id TEXT PRIMARY KEY, owner TEXT NOT NULL, source TEXT NOT NULL, data TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft', revision INTEGER NOT NULL DEFAULT 1, created TEXT NOT NULL, updated TEXT NOT NULL, UNIQUE(owner,source));
  CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, owner TEXT NOT NULL, product_id TEXT NOT NULL REFERENCES products(id), revision INTEGER NOT NULL, target TEXT NOT NULL, status TEXT NOT NULL, token TEXT NOT NULL, message TEXT NOT NULL DEFAULT '', remote_id TEXT NOT NULL DEFAULT '', created TEXT NOT NULL, updated TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS job_snapshots(job_id TEXT PRIMARY KEY REFERENCES jobs(id), product TEXT NOT NULL, claimed INTEGER NOT NULL DEFAULT 0, candidate_id TEXT NOT NULL DEFAULT '', verification_nonce TEXT NOT NULL DEFAULT '');
  CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, data TEXT NOT NULL, expires INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS audit(id TEXT PRIMARY KEY, owner TEXT NOT NULL, action TEXT NOT NULL, object_id TEXT NOT NULL, created TEXT NOT NULL);
  `);
  if(!db.prepare('PRAGMA table_info(jobs)').all().some(row=>row.name==='mall_connection_id'))db.exec("ALTER TABLE jobs ADD COLUMN mall_connection_id TEXT NOT NULL DEFAULT ''");
  const index=db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND name='jobs_active'").get();
  if(!index?.sql.includes('mall_connection_id'))db.exec("DROP INDEX IF EXISTS jobs_active; CREATE UNIQUE INDEX jobs_active ON jobs(product_id,revision,target,mall_connection_id) WHERE status IN ('dispatching','accepted','succeeded','unknown','awaiting_review','verifying')");
  return db;
}
export const now=()=>new Date().toISOString();
export const decodeProduct=r=>({...JSON.parse(r.data),id:r.id,status:r.status,revision:r.revision,updated:r.updated});
