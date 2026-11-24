import {randomUUID,createHash} from 'node:crypto';
import {fetchCrmebToken} from './crmeb-auth.mjs';
import {mallOrigin,mallDispatcher} from './mall-address.mjs';
import {createCatalogLoader} from './catalog.mjs';
export const CLASSIFICATION_TAGS=['水基','硅基','水硅混合','油基','男用','女用','男女通用','口交适用','阴道适用','后庭适用','拳交适用','热感','凉感','仿精','无香','果香','花香','香草香','草莓味','樱桃味','桃子味','保湿','干涩护理','舒缓','修护','长效润滑','易清洗'];
function ids(value){
 if(typeof value==='string')value=value.split(',').filter(v=>v.trim()&&v.trim()!=='0').map(Number);
 if(Array.isArray(value))value=value.map(v=>typeof v==='object'&&v?Number(v.id??v.value):Number(v));
 if(!Array.isArray(value)||value.length>100||value.some(v=>!Number.isSafeInteger(v)||v<1||v>999999999))throw Error('商城分类或标签ID格式无效');
 return [...new Set(value)].sort((a,b)=>a-b);
}
export const classificationRevision=row=>createHash('sha256').update(JSON.stringify([row.id,row.category_ids,row.tag_ids])).digest('hex');
function normalize(row,detail=false){
 if(!row||!Number.isSafeInteger(Number(row.id))||Number(row.id)<1||typeof row.store_name!=='string')throw Error('商城商品格式无效');
 if(Number(row.is_del||0)===1)throw Error('回收站商品不参与整理');
 if(row.type!==undefined&&Number(row.type)!==0||row.pid!==undefined&&Number(row.pid)!==0)throw Error('当前仅整理平台主商品');
 const tagKnown=row.store_label_id!==undefined&&row.store_label_id!==null;
 if(detail&&!tagKnown)throw Error('商城详情缺少商品标签字段，未生成清单');
 const tagRows=Array.isArray(row.store_label_id)?row.store_label_id:[];
 const result={id:Number(row.id),title:row.store_name,image:typeof row.image==='string'?row.image:'',is_show:Number(row.is_show??1),category_ids:ids(row.cate_id??''),tag_ids:tagKnown?ids(row.store_label_id):null,tag_names:tagRows.filter(v=>v&&typeof v==='object'&&typeof v.label_name==='string').map(v=>v.label_name),tag_names_known:tagKnown&&(!ids(row.store_label_id).length||Array.isArray(row.store_label_id)&&tagRows.every(v=>v&&typeof v==='object'&&typeof v.label_name==='string'))};
 return {...result,revision:classificationRevision(result)};
}
export function classificationClient(credentials,fetcher=fetch){
 let token;
 const origin=mallOrigin(credentials?.url||'https://xlupw.com');
 async function read(path,authenticated=true){
  const access=authenticated?await(token??=fetchCrmebToken('crmeb-pro',credentials,fetcher)):null;
  let response,data;
  try{response=await fetcher(origin+path,{method:'GET',headers:authenticated?{Authorization:'Bearer '+access,'Authori-zation':'Bearer '+access}:{},dispatcher:mallDispatcher,redirect:'error',signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error();const text=await response.text();if(text.length>8e6)throw Error();data=JSON.parse(text);}catch{throw Error('商城官方只读接口未完成，请检查网络和读取权限');}
  if(Number(data?.status)!==200)throw Error('商城官方只读接口拒绝请求，请检查商品列表或商品详情权限');return data;
 }
 const publicCatalog=createCatalogLoader(url=>read(new URL(url).pathname,false),'crmeb-pro',null,origin);
 async function detail(id){if(!Number.isSafeInteger(id)||id<1)throw Error('商品ID无效');const data=(await read('/outapi/product/'+id)).data;const row=normalize(data?.productInfo??data,true);if(row.id!==id)throw Error('商城读回商品ID不符');return row;}
 return {origin,async catalog(){const c=await publicCatalog();if(c.categoryError)throw Error(c.categoryError);return {version:2,mode:'official_readonly',categories:c.categories.map(r=>({id:r.id,pid:0,cate_name:r.label})),tags:CLASSIFICATION_TAGS.map(name=>({id:name,label_name:name})),notice:'分类来自商城前台可见分类；标签是整理建议，非商城标签字典，需在后台核对或创建。'};},detail,
  async list(q){
   const page=Number(q.page||1);if(!Number.isSafeInteger(page)||page<1||page>100000)throw Error('页码无效');
   if(q.ids){const selected=ids(String(q.ids).trim().split(/[,，\s]+/).map(Number));if(!selected.length||selected.length>20)throw Error('按ID读取每次限1至20件商品');const rows=[];for(let i=0;i<selected.length;i+=3)rows.push(...await Promise.all(selected.slice(i,i+3).map(detail)));return {version:2,mode:'official_readonly',page:1,total:rows.length,products:rows};}
   if(q.show==='0')throw Error('官方列表只提供上架商品；下架商品请按商品ID读取');
   const data=(await read('/outapi/product/list?'+new URLSearchParams({page:String(page),limit:'50',store_name:String(q.q||'').slice(0,100)}))).data;
   if(!data||!Array.isArray(data.list)||data.list.length>50)throw Error('商城官方商品列表格式无效');const total=Number(data.count??data.total);if(!Number.isSafeInteger(total)||total<0)throw Error('商城未返回有效商品总数');
   return {version:2,mode:'official_readonly',page,total,products:data.list.map(row=>normalize(row))};
  }
 };
}
export function classificationCSV(plan){
 const quote=v=>{let text=String(v??'');if(/^[\s]*[=+@-]|^[\t\r]/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';};
 const rows=[['商城商品ID','商品名称','原分类ID','原分类','目标分类ID','目标分类','原商品标签ID','原商品标签','标签操作','目标商品标签名称','核对提示']];
 for(const i of plan.items)rows.push([i.id,i.title,i.before.category_ids.join(','),i.before.category_names.join(' / '),i.after.category_ids.join(','),i.after.category_names.join(' / '),i.before.tag_ids.join(','),i.before.tag_names.join(' / '),({keep:'保留',add:'追加建议',remove:'移除建议',replace:'替换建议'})[i.tag_mode],i.after.tag_names.join(' / '),i.warning]);
 return '\uFEFF'+rows.map(r=>r.map(quote).join(',')).join('\r\n');
}
export function mallClassification({db,connection,fetcher=fetch,audit=()=>{}}){
 db.exec('CREATE TABLE IF NOT EXISTS classification_sheets(id TEXT PRIMARY KEY,owner TEXT NOT NULL,mall TEXT NOT NULL,created INTEGER NOT NULL,data TEXT NOT NULL)');
 const client=(owner,id)=>{if(typeof id!=='string'||!id)throw Error('请选择商城连接');const c=connection(owner,id);if(c.system!=='crmeb-pro')throw Error('当前只支持CRMEB会员商城，请核对连接');return classificationClient(c.credentials,fetcher);};
 const view=(owner,id)=>{const r=db.prepare('SELECT * FROM classification_sheets WHERE owner=? AND id=?').get(owner,id);if(!r)throw Error('整理清单不存在或不属于当前工作空间');return {id:r.id,mall:r.mall,created:r.created,mode:'official_readonly',state:'worksheet',...JSON.parse(r.data)};};
 async function preview(owner,input){
  if(!input||!Array.isArray(input.products)||!input.products.length||input.products.length>50||new Set(input.products.map(r=>r.id)).size!==input.products.length||input.products.some(r=>!Number.isSafeInteger(r.id)||r.id<1))throw Error('请选择1至50件不同商品');
  const api=client(owner,input.mall),catalog=await api.catalog(),categories=input.category_ids==null?null:ids(input.category_ids),mode=input.tag_mode||'keep';
  if(categories&&!categories.length)throw Error('分类不能为空');if(!['keep','add','remove','replace'].includes(mode)||!categories&&mode==='keep')throw Error('请选择分类或标签整理方式');
  if(categories?.some(id=>!catalog.categories.some(c=>c.id===id)))throw Error('目标分类未在商城可见分类中，请刷新或到后台核对');
  const tags=input.tag_names??[];if(!Array.isArray(tags)||tags.length>50||tags.some(t=>typeof t!=='string'||!t.trim()||t.length>40||/[\u0000-\u001f]/.test(t)))throw Error('标签名称无效');
  const wanted=[...new Set(tags.map(t=>t.trim()))],items=[];const names=ids=>ids.map(id=>catalog.categories.find(c=>c.id===id)?.cate_name||'#'+id+'（后台核对）');
  const selected=[];for(let i=0;i<input.products.length;i+=3)selected.push(...await Promise.all(input.products.slice(i,i+3).map(r=>api.detail(r.id))));
  for(const row of selected){
   if(!row.tag_names_known&&['add','remove'].includes(mode))throw Error('商品 '+row.id+' 的原标签名称不完整，不能准确追加或移除，请在后台核对');
   const before={category_ids:row.category_ids,category_names:names(row.category_ids),tag_ids:row.tag_ids,tag_names:row.tag_names};
   const after={category_ids:categories||before.category_ids,category_names:names(categories||before.category_ids),tag_names:mode==='keep'?before.tag_names:mode==='replace'?wanted:mode==='add'?[...new Set([...before.tag_names,...wanted])]:before.tag_names.filter(t=>!wanted.includes(t))};
   items.push({id:row.id,title:row.title,before,after,tag_mode:mode,warning:!row.tag_names_known?'原标签名称不完整，以原标签ID和商城后台为准；标签建议需核实产品资料':'标签建议需核实产品资料；此清单不会写入商城'});
  }
  const id=randomUUID(),created=Date.now();db.prepare('INSERT INTO classification_sheets VALUES(?,?,?,?,?)').run(id,owner,input.mall,created,JSON.stringify({items,origin:api.origin}));audit(owner,'classification.worksheet',id);return view(owner,id);
 }
 const blocked=()=>{throw Error('当前为官方只读整理模式，不同步商城；请导出清单后使用商城后台批量分类和商品标签功能');};
 return {catalog:async(owner,id)=>client(owner,id).catalog(),list:async(owner,id,q)=>client(owner,id).list(q),preview,view,export:(owner,id)=>classificationCSV(view(owner,id)),history:owner=>db.prepare("SELECT id,mall,created,'worksheet' state FROM classification_sheets WHERE owner=? ORDER BY created DESC LIMIT 30").all(owner),enqueue:blocked,verify:blocked,rollback:blocked,tick:()=>Promise.resolve(),stop:()=>Promise.resolve()};
}
