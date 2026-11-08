// Browser-local conveniences only; live catalog data remains authoritative.
export function createCatalogRecents({storage,limit=6,maxScopes=50,clock=()=>Date.now()}={}){
 if(storage===undefined){try{storage=globalThis.localStorage;}catch{}}
 const key='ops-catalog-recents:v1';
 const scopeKey=scope=>Array.isArray(scope)&&scope.length===3&&scope.every(x=>typeof x==='string'&&x&&x.length<=200)?JSON.stringify(scope):null;
 const read=()=>{try{const data=JSON.parse(storage?.getItem(key)||'null');return data?.version===1&&Array.isArray(data.scopes)?data.scopes.filter(r=>r&&typeof r.key==='string'&&Number.isFinite(r.updated)).slice(0,maxScopes):[];}catch{return [];}};
 const write=rows=>{try{storage.setItem(key,JSON.stringify({version:1,scopes:rows.slice(0,maxScopes)}));return true;}catch{return false;}};
 const valid=kind=>['category','brand'].includes(kind);
 return {
  list(scope,kind,live=[]){const id=scopeKey(scope);if(!id||!valid(kind))return [];const saved=read().find(r=>r.key===id)?.[kind];if(!Array.isArray(saved))return [];const current=new Map(live.map(row=>[Number(row.id),row])),seen=new Set();return saved.filter(row=>Number.isSafeInteger(row?.id)&&row.id>0&&current.has(row.id)&&!seen.has(row.id)&&seen.add(row.id)).slice(0,limit).map(row=>({id:row.id,label:String(current.get(row.id).label||row.id)}));},
  remember(scope,kind,item){const id=scopeKey(scope),number=Number(item?.id);if(!id||!valid(kind)||!Number.isSafeInteger(number)||number<=0)return false;const rows=read(),old=rows.find(r=>r.key===id)||{key:id,category:[],brand:[]},saved=Array.isArray(old[kind])?old[kind]:[];const next={...old,updated:clock(),[kind]:[{id:number},...saved.filter(r=>Number.isSafeInteger(r?.id)&&r.id>0&&r.id!==number)].slice(0,limit)};return write([next,...rows.filter(r=>r.key!==id)]);},
  clear(scope,kind){const id=scopeKey(scope);if(!id||!valid(kind))return false;return write(read().map(r=>r.key===id?{...r,[kind]:[]}:r));}
 };
}
