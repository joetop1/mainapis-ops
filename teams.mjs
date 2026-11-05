import {uid,now} from './core.mjs';
export function teamStore(db){
 db.exec(`CREATE TABLE IF NOT EXISTS teams(id TEXT PRIMARY KEY,name TEXT NOT NULL,creator TEXT NOT NULL,created TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS team_members(sub TEXT PRIMARY KEY,team_id TEXT NOT NULL REFERENCES teams(id),role TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1);
 CREATE TABLE IF NOT EXISTS team_events(id TEXT PRIMARY KEY,team_id TEXT NOT NULL,actor TEXT NOT NULL,action TEXT NOT NULL,object_id TEXT NOT NULL,created TEXT NOT NULL);`);
 const member=sub=>db.prepare('SELECT m.*,t.name FROM team_members m JOIN teams t ON t.id=m.team_id WHERE m.sub=?').get(sub);
 return {
  member,
  context(sub){const m=member(sub);return m?.active?{id:m.team_id,name:m.name,role:m.role}:null;},
  create(sub,name,stores,moveConnections=null){
   name=String(name||'').trim();if(!name||name.length>60)throw Error('团队名称请填写1–60个字符');
   if(member(sub))throw Error('该账号已有团队成员记录');
   const id='team:'+uid();db.exec('BEGIN IMMEDIATE');
   try{
    db.prepare('INSERT INTO teams VALUES(?,?,?,?)').run(id,name,sub,now());
    db.prepare('INSERT INTO team_members VALUES(?,?,?,1)').run(sub,id,'admin');
    if(moveConnections)moveConnections(sub,id);
    db.prepare('UPDATE products SET owner=? WHERE owner=?').run(id,sub);
    db.prepare('UPDATE jobs SET owner=? WHERE owner=?').run(id,sub);
    if(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='product_merge_requests'").get())db.prepare('UPDATE product_merge_requests SET owner=? WHERE owner=?').run(id,sub);
    for(const store of stores){const connection=store.get(sub);if(connection)store.set(id,connection);}
    db.exec('COMMIT');return {id,name,role:'admin'};
   }catch(e){db.exec('ROLLBACK');throw e;}
  },
  list(id){return db.prepare('SELECT sub,role,active FROM team_members WHERE team_id=? ORDER BY role,sub').all(id);},
  setMember(actor,sub,role,active=1){
   const admin=member(actor);if(!admin?.active||admin.role!=='admin')throw Error('仅管理员可管理成员');
   if(typeof sub!=='string'||!sub.trim()||sub.length>200||/[\u0000-\u0020]/.test(sub))throw Error('请填写准确的 Casdoor 用户 ID（sub）');
   if(!['admin','reviewer','editor'].includes(role)||![0,1].includes(active))throw Error('角色或启用状态无效');
   const old=member(sub);if(old&&old.team_id!==admin.team_id)throw Error('该账号已属于另一个团队');
   if(old?.active&&old.role==='admin'&&(role!=='admin'||!active)&&db.prepare("SELECT COUNT(*) AS n FROM team_members WHERE team_id=? AND role='admin' AND active=1").get(admin.team_id).n<=1)throw Error('必须保留至少一位启用的管理员');
   db.prepare('INSERT INTO team_members VALUES(?,?,?,?) ON CONFLICT(sub) DO UPDATE SET role=excluded.role,active=excluded.active').run(sub,admin.team_id,role,active);
   // Revocations take effect for already logged-in sessions on their next request.
   return {ok:true};
  }
 };
}
export function teamPermission(role,path,method){
 if(!role||role==='admin')return true;
 if(path==='/api/team'&&method==='GET')return true;
 if(path==='/auth/logout')return true;
 if(path==='/api/malls'&&method!=='GET')return false;
 if(path.startsWith('/api/connections/')||path.startsWith('/api/team'))return false;
 if(['GET','HEAD'].includes(method))return true;
 if(role==='editor'&&path==='/api/products/bulk-settings'&&method==='POST')return true;
 if(role==='editor'&&path.startsWith('/api/supplier-imports'))return true;
 if(role==='editor')return ['/api/products/merge-preview','/api/products/merge'].includes(path)||path==='/api/import'||path==='/api/products'||(/^\/api\/products\/[^/]+$/.test(path)&&method==='PUT');
 return role==='reviewer';
}
