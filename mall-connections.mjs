import {createHash,randomUUID} from 'node:crypto';
export const MALL_SYSTEMS={
 shopxo:{name:'ShopXO',version:'6.9.2',origin:'https://xiaolanyoupin.wang'},
 'crmeb-pro':{name:'CRMEB 会员商城',version:'4.3',origin:'https://xlupw.com'},
 'crmeb-store':{name:'CRMEB 多门店',version:'4.2',origin:'https://www.xlyp.cc'},
 tigshop:{name:'Tigshop 跨境 Java',version:'5.8.60',origin:'https://xiaolango.com'},
 yunzhong:{name:'芸众商城',version:'2.3.700',origin:'https://asns.cc'}
};
export const legacyMallId=(owner,system)=>'legacy-'+createHash('sha256').update(JSON.stringify([owner,system])).digest('hex').slice(0,32);
export function mallConnections(db,profiles){
 db.exec(`CREATE TABLE IF NOT EXISTS mall_connections(id TEXT PRIMARY KEY,owner TEXT NOT NULL,system TEXT NOT NULL,name TEXT NOT NULL,legacy INTEGER NOT NULL DEFAULT 0,created TEXT NOT NULL);
 CREATE UNIQUE INDEX IF NOT EXISTS mall_connections_legacy ON mall_connections(owner,system) WHERE legacy=1;`);
 db.exec("CREATE INDEX IF NOT EXISTS jobs_unbound_mall_owner ON jobs(owner,target) WHERE mall_connection_id=''");
 if(!db.prepare('PRAGMA table_info(mall_connections)').all().some(c=>c.name==='badge'))db.exec("ALTER TABLE mall_connections ADD COLUMN badge TEXT NOT NULL DEFAULT ''");
 function ensure(owner){
  // Reads must not acquire the writer lock on every lookup. Check actual DB
  // state instead of memoizing: another process or a rollback can change it.
  const existing=db.prepare('SELECT id,system FROM mall_connections WHERE owner=? AND legacy=1').all(owner);
  const bySystem=new Map(existing.map(row=>[row.system,row.id]));
  const missing=Object.keys(MALL_SYSTEMS).filter(system=>!bySystem.has(system));
  const pending=db.prepare("SELECT 1 FROM jobs WHERE owner=? AND mall_connection_id='' AND target IN ('shopxo','crmeb-pro','crmeb-store','tigshop','yunzhong') LIMIT 1").get(owner);
  if(!missing.length&&!pending)return;
  db.exec('SAVEPOINT ensure_mall_connections');
  try{
   if(missing.length){
    const names=profiles?.get(owner)||{},created=new Date().toISOString();
    const insert=db.prepare('INSERT OR IGNORE INTO mall_connections(id,owner,system,name,legacy,created) VALUES(?,?,?,?,1,?)');
    for(const system of missing)insert.run(legacyMallId(owner,system),owner,system,names[system]?.name||MALL_SYSTEMS[system].name,created);
   }
   // Preserve moved legacy IDs, credentials, task tokens and snapshots.
   if(pending)db.prepare(`UPDATE jobs SET mall_connection_id=(SELECT m.id FROM mall_connections m WHERE m.owner=jobs.owner AND m.system=jobs.target AND m.legacy=1)
    WHERE owner=? AND mall_connection_id='' AND target IN ('shopxo','crmeb-pro','crmeb-store','tigshop','yunzhong')`).run(owner);
   db.exec('RELEASE SAVEPOINT ensure_mall_connections');
  }catch(error){db.exec('ROLLBACK TO SAVEPOINT ensure_mall_connections');db.exec('RELEASE SAVEPOINT ensure_mall_connections');throw error;}
 }

 const get=(owner,id,system)=>{ensure(owner);const row=db.prepare('SELECT * FROM mall_connections WHERE owner=? AND id=?').get(owner,id||db.prepare('SELECT id FROM mall_connections WHERE owner=? AND system=? AND legacy=1').get(owner,system)?.id||'');if(!row||system&&row.system!==system)throw Error('商城连接不存在或不属于当前工作空间');return row;};
 return {ensure,get,list(owner){ensure(owner);return db.prepare('SELECT * FROM mall_connections WHERE owner=? ORDER BY legacy DESC,created,id').all(owner);},
  scope(row){return row.legacy?row.owner:'mall:'+row.id;},
  forJob(job){return get(job.owner,job.mall_connection_id,job.target);},
  create(owner,system,name){if(typeof system!=='string'||!Object.hasOwn(MALL_SYSTEMS,system))throw Error('不支持的商城系统');name=validMallName(name);ensure(owner);if(db.prepare('SELECT COUNT(*) AS n FROM mall_connections WHERE owner=?').get(owner).n>=100)throw Error('每个工作空间最多100个商城连接');const id=randomUUID();db.prepare('INSERT INTO mall_connections(id,owner,system,name,legacy,created) VALUES(?,?,?,?,0,?)').run(id,owner,system,name,new Date().toISOString());return get(owner,id);},
  rename(owner,id,name,badge){const row=get(owner,id);const mark=badge===undefined?row.badge:validMallBadge(badge);db.prepare('UPDATE mall_connections SET name=?,badge=? WHERE owner=? AND id=?').run(validMallName(name),mark,owner,row.id);return get(owner,id);},
  // Executed inside the existing team migration transaction. IDs and credential scopes stay stable.
  moveOwner(previous,next){ensure(previous);db.prepare('UPDATE mall_connections SET owner=? WHERE owner=?').run(next,previous);},
 };
}
export function validMallName(value){const name=typeof value==='string'?value.trim():'';if(!name||[...name].length>50||/[\u0000-\u001f\u007f]/.test(name))throw Error('商城名称须为1–50字，不能包含控制字符');return name;}

export function validMallBadge(value){const mark=typeof value==='string'?value.trim():'';if([...mark].length>1||/[\s\u0000-\u001f\u007f]/u.test(mark))throw Error('商城标识请填写一个字，留空使用名称首字');return mark;}
