// One bounded, replaceable draft. No cookies, tokens or historical product archive.
export function draftDatabase(indexedDB=globalThis.indexedDB){
 let opening;
 const open=()=>opening||=(new Promise((resolve,reject)=>{if(!indexedDB)return reject(Error('IndexedDB unavailable'));const req=indexedDB.open('mainapis-collector-drafts',1);req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains('drafts'))req.result.createObjectStore('drafts');};req.onerror=()=>reject(req.error);req.onblocked=()=>reject(Error('Draft database blocked'));req.onsuccess=()=>resolve(req.result);}));
 const operation=async(mode,work)=>{const db=await open();return new Promise((resolve,reject)=>{const tx=db.transaction('drafts',mode),req=work(tx.objectStore('drafts'));let value;req.onsuccess=()=>{value=req.result;};tx.oncomplete=()=>resolve(value);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('Draft write aborted'));});};
 return {get:()=>operation('readonly',s=>s.get('current')),put:value=>operation('readwrite',s=>s.put(value,'current')),remove:()=>operation('readwrite',s=>s.delete('current'))};
}
export function draftCache({storage,database=draftDatabase()}){
 let queue=Promise.resolve();
 const cleanup=async()=>{try{await storage.remove(['draft','merchantImageProduct']);}catch{}};
 const save=value=>{const work=queue.then(async()=>{
  try{if(new TextEncoder().encode(JSON.stringify(value)).length>2*1024*1024)return {saved:false};}catch{return {saved:false};}
  try{await database.put(value);await cleanup();return {saved:true};}catch{}
  try{await storage.remove('merchantImageProduct');await storage.set({draft:value});return {saved:true};}catch{return {saved:false};}
 });queue=work.catch(()=>{});return work;};
 return {save,async read(){try{const draft=await database.get();if(draft)return draft;}catch{}try{const {draft}=await storage.get('draft');if(draft)await save(draft);return draft;}catch{return null;}}};
}
