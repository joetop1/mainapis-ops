import {randomUUID,createHash} from 'node:crypto';
import {fetchCrmebToken} from './crmeb-auth.mjs';
import {mallOrigin,mallDispatcher} from './mall-address.mjs';
const ids=value=>{if(!Array.isArray(value)||value.length>100||value.some(x=>!Number.isSafeInteger(x)||x<1||x>999999999))throw Error('分类或标签ID无效');return [...new Set(value)].sort((a,b)=>a-b);};
const fields=row=>({category_ids:ids(row.category_ids),tag_ids:ids(row.tag_ids)});
const equal=(a,b)=>JSON.stringify(fields(a))===JSON.stringify(fields(b));
export const classificationRevision=row=>createHash('sha256').update(JSON.stringify(fields(row))).digest('hex');
export function classificationClient(credentials,fetcher=fetch){
 let token;
 const request=async(path,body)=>{
  token??=await fetchCrmebToken('crmeb-pro',credentials,fetcher);
  let response,data;
  try{
   response=await fetcher(mallOrigin(credentials.url||'https://xlupw.com')+'/outapi/ops-classification/'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Authori-zation':'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),dispatcher:mallDispatcher,redirect:'error',signal:AbortSignal.timeout(15000)});
   if(!response.ok)throw Error();
   const text=await response.text();if(text.length>4e6)throw Error();data=JSON.parse(text);
  }catch{const e=Error(body?'提交结果未确认，请读回核对；不要重复提交':'读取分类整理接口失败，请检查网络、专用接口安装和授权');e.uncertain=!!body;throw e;}
  if(Number(data.status)!==200){const e=Error('商城分类整理接口拒绝请求，请检查接口授权、商品是否已变化及分类标签是否有效');e.rejected=true;throw e;}
  return data.data;
 };
 return {catalog:()=>request('catalog'),list:q=>request('products?'+new URLSearchParams(q)),detail:id=>request('product/'+id),write:(id,body)=>request('product/'+id,body)};
}
export function mallClassification({db,connection,fetcher=fetch,audit=()=>{}}){
 db.exec(`CREATE TABLE IF NOT EXISTS classification_plans(id TEXT PRIMARY KEY,owner TEXT NOT NULL,mall TEXT NOT NULL,origin TEXT NOT NULL,state TEXT NOT NULL,created INTEGER NOT NULL,updated INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS classification_items(plan TEXT NOT NULL,product_id INTEGER NOT NULL,title TEXT NOT NULL,before_data TEXT NOT NULL,after_data TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'pending',message TEXT NOT NULL DEFAULT '',updated INTEGER NOT NULL,PRIMARY KEY(plan,product_id));`);
 let busy=null,stopping=false;
 const client=(owner,mall)=>{if(typeof mall!=='string'||!mall)throw Error('请选择商城连接');const c=connection(owner,mall);if(c.system!=='crmeb-pro')throw Error('当前仅支持CRMEB会员商城，请核对小蓝优品的连接');return {origin:mallOrigin(c.credentials?.url||'https://xlupw.com'),api:classificationClient(c.credentials,fetcher)};};
 const planFor=(owner,id)=>{const p=db.prepare('SELECT * FROM classification_plans WHERE id=? AND owner=?').get(id,owner);if(!p)throw Error('整理记录不存在或不属于当前工作空间');return p;};
 function view(owner,id){const p=planFor(owner,id);return {...p,items:db.prepare('SELECT * FROM classification_items WHERE plan=? ORDER BY product_id').all(id).map(i=>({id:i.product_id,title:i.title,before:JSON.parse(i.before_data),after:JSON.parse(i.after_data),state:i.state,message:i.message}))};}
 function save(owner,mall,origin,items){
  const id=randomUUID(),now=Date.now();db.exec('BEGIN IMMEDIATE');try{
   db.prepare('INSERT INTO classification_plans VALUES(?,?,?,?,?,?,?)').run(id,owner,mall,origin,'draft',now,now);
   for(const i of items)db.prepare('INSERT INTO classification_items(plan,product_id,title,before_data,after_data,updated) VALUES(?,?,?,?,?,?)').run(id,i.id,i.title.slice(0,300),JSON.stringify(i.before),JSON.stringify(i.after),now);
   audit(owner,'classification.preview',id);db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}return view(owner,id);
 }
 async function catalog(owner,mall){const {api}=client(owner,mall),c=await api.catalog();if(c?.version!==1||!Array.isArray(c.categories)||!Array.isArray(c.tags)||c.categories.length>10000||c.tags.length>10000)throw Error('商城分类整理接口版本或字典格式无效');return c;}
 async function list(owner,mall,q){const page=Number(q.page||1);if(!Number.isSafeInteger(page)||page<1||page>100000)throw Error('页码无效');const {api}=client(owner,mall),data=await api.list({page:String(page),q:String(q.q||'').slice(0,100),show:['0','1'].includes(q.show)?q.show:''});if(data?.version!==1||!Array.isArray(data.products)||data.products.length>50)throw Error('商城商品列表格式无效');return {...data,products:data.products.map(r=>{if(!Number.isSafeInteger(r.id)||r.id<1||typeof r.title!=='string')throw Error('商品格式无效');return {...r,...fields(r),revision:classificationRevision(r)};})};}
 async function preview(owner,input){
  if(!input||typeof input.mall!=='string'||!Array.isArray(input.products)||!input.products.length||input.products.length>50||new Set(input.products.map(r=>r.id)).size!==input.products.length)throw Error('请选择1至50个不同商品');
  const categories=input.category_ids==null?null:ids(input.category_ids),tags=ids(input.tag_ids||[]),mode=input.tag_mode||'keep';
  if(categories&&!categories.length)throw Error('分类不能为空');if(!['keep','add','remove','replace'].includes(mode))throw Error('标签操作无效');if(!categories&&mode==='keep')throw Error('请设置分类或标签修改');
  const {api,origin}=client(owner,input.mall),dict=await api.catalog();if(dict?.version!==1)throw Error('专用接口版本无效');
  if(categories?.some(id=>!dict.categories.some(c=>Number(c.id)===id))||tags.some(id=>!dict.tags.some(t=>Number(t.id)===id)))throw Error('分类或商品标签不存在，请刷新');
  if(input.products.some(p=>!Number.isSafeInteger(p.id)||p.id<1))throw Error('商品ID无效');
  const snapshot=await api.list({ids:input.products.map(p=>p.id).join(',')});
  if(snapshot?.version!==1||!Array.isArray(snapshot.products)||snapshot.products.length>50)throw Error('商城批量商品快照无效');
  const items=[];
  for(const selected of input.products){
   if(!Number.isSafeInteger(selected.id)||selected.id<1)throw Error('商品ID无效');
   const row=snapshot.products.find(r=>r.id===selected.id);if(row?.id!==selected.id||classificationRevision(row)!==selected.revision)throw Error('商品分类标签已变化，请重新读取后预览');
   const before=fields(row),after={category_ids:categories||before.category_ids,tag_ids:mode==='keep'?before.tag_ids:mode==='replace'?tags:mode==='add'?ids([...before.tag_ids,...tags]):before.tag_ids.filter(id=>!tags.includes(id))};
   if(!after.category_ids.length)throw Error('商品缺少分类，请先选择分类');
   if(!equal(before,after))items.push({id:row.id,title:row.title,before,after});
  }
  if(!items.length)throw Error('所选商品无需修改');return save(owner,input.mall,origin,items);
 }
 function enqueue(owner,id){const p=planFor(owner,id);if(p.state!=='draft')return view(owner,id);if(p.created<Date.now()-30*60000)throw Error('预览已过期，请重新预览');
  db.exec('BEGIN IMMEDIATE');try{
   const collision=db.prepare("SELECT 1 FROM classification_items i JOIN classification_plans p ON p.id=i.plan WHERE p.owner=? AND p.mall=? AND p.state IN ('queued','running') AND i.product_id IN (SELECT product_id FROM classification_items WHERE plan=?) LIMIT 1").get(owner,p.mall,id);
   if(collision)throw Error('商品已有整理任务，请先等待并核对');
   db.prepare("UPDATE classification_plans SET state='queued',updated=? WHERE id=? AND state='draft'").run(Date.now(),id);audit(owner,'classification.queued',id);db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}return view(owner,id);
 }
 function mark(plan,id,state,message){db.prepare('UPDATE classification_items SET state=?,message=?,updated=? WHERE plan=? AND product_id=?').run(state,message.slice(0,300),Date.now(),plan,id);db.prepare('UPDATE classification_plans SET updated=? WHERE id=?').run(Date.now(),plan);}
 async function verify(owner,id,productId){const p=planFor(owner,id),i=db.prepare('SELECT * FROM classification_items WHERE plan=? AND product_id=?').get(id,productId);if(!i||!['unknown','not_applied','conflict'].includes(i.state))throw Error('此记录无需核对');const {api,origin}=client(owner,p.mall);if(origin!==p.origin)throw Error('商城地址已变化，停止核对');const row=await api.detail(productId);if(row.id!==productId)throw Error('读回商品ID不符');
  mark(id,productId,equal(row,JSON.parse(i.after_data))?'succeeded':equal(row,JSON.parse(i.before_data))?'not_applied':'conflict','已只读核对；未重复写入');return view(owner,id);
 }
 async function rollback(owner,id){const p=planFor(owner,id),{api,origin}=client(owner,p.mall);if(origin!==p.origin)throw Error('商城地址已变化');const items=[];
  const successful=db.prepare("SELECT * FROM classification_items WHERE plan=? AND state='succeeded'").all(id);if(!successful.length)throw Error('没有可回退的成功记录');
  const snapshot=await api.list({ids:successful.map(i=>i.product_id).join(',')});if(snapshot?.version!==1||!Array.isArray(snapshot.products))throw Error('商城批量商品快照无效');
  for(const i of successful){
   const row=snapshot.products.find(r=>r.id===i.product_id),expected=JSON.parse(i.after_data),original=JSON.parse(i.before_data);if(row?.id!==i.product_id||!equal(row,expected))throw Error('商品已被其他人修改，不能回退，请重新整理');if(!original.category_ids.length)throw Error('原商品没有分类，无法直接回退，请重新整理');items.push({id:i.product_id,title:i.title,before:expected,after:original});
  }if(!items.length)throw Error('没有可回退的成功记录');return save(owner,p.mall,p.origin,items);
 }
 async function runOne(){
  // A dead worker may have completed a write. Never automatically resend it.
  const expired=db.prepare("SELECT plan,product_id FROM classification_items WHERE state='running' AND updated<?").all(Date.now()-120000);
  for(const i of expired)mark(i.plan,i.product_id,'unknown','Worker执行中断，请只读核对结果');
  const p=db.prepare("SELECT * FROM classification_plans WHERE state IN ('queued','running') ORDER BY created LIMIT 1").get();if(!p)return;
  db.prepare("UPDATE classification_plans SET state='running' WHERE id=?").run(p.id);
  const i=db.prepare("SELECT * FROM classification_items WHERE plan=? AND state='pending' ORDER BY product_id LIMIT 1").get(p.id);
  if(!i){if(!db.prepare("SELECT 1 FROM classification_items WHERE plan=? AND state='running'").get(p.id))db.prepare("UPDATE classification_plans SET state='done',updated=? WHERE id=?").run(Date.now(),p.id);return;}
  if(!db.prepare("UPDATE classification_items SET state='running',updated=? WHERE plan=? AND product_id=? AND state='pending'").run(Date.now(),p.id,i.product_id).changes)return;
  let sent=false;
  try{const {api,origin}=client(p.owner,p.mall);if(origin!==p.origin)throw Error('商城地址已变化，任务停止');const row=await api.detail(i.product_id),before=JSON.parse(i.before_data),after=JSON.parse(i.after_data);if(row.id!==i.product_id)throw Error('读回商品ID不符');
   if(equal(row,after)){mark(p.id,i.product_id,'succeeded','读回确认分类标签已一致');return;}
   if(!equal(row,before)){mark(p.id,i.product_id,'conflict','商品分类或标签已变化，请重新预览');return;}
   sent=true;await api.write(i.product_id,{before,after});const actual=await api.detail(i.product_id);if(actual.id!==i.product_id||!equal(actual,after))throw Error('读回未确认，请核对');mark(p.id,i.product_id,'succeeded','分类及标签已更新并读回确认');audit(p.owner,'classification.succeeded',p.id+':'+i.product_id);
  }catch(e){mark(p.id,i.product_id,sent&&!e.rejected?'unknown':'conflict',e.message);}
 }
 return {catalog,list,preview,view,enqueue,verify,rollback,history:owner=>db.prepare('SELECT id,mall,state,created FROM classification_plans WHERE owner=? ORDER BY created DESC LIMIT 30').all(owner),tick(){if(stopping||busy)return busy||Promise.resolve();busy=runOne().finally(()=>{busy=null;});return busy;},async stop(){stopping=true;await busy;}};
}
