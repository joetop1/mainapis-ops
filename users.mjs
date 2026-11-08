export function userDirectory({db,allowed,isSystemAdmin}){
 db.exec("CREATE TABLE IF NOT EXISTS ops_users(sub TEXT PRIMARY KEY,name TEXT NOT NULL DEFAULT '',active INTEGER NOT NULL DEFAULT 1,granted INTEGER NOT NULL DEFAULT 0,last_login TEXT NOT NULL DEFAULT '',created TEXT NOT NULL);CREATE TABLE IF NOT EXISTS ops_user_events(actor TEXT NOT NULL,subject TEXT NOT NULL,action TEXT NOT NULL,created TEXT NOT NULL)");
 if(!db.prepare('PRAGMA table_info(ops_users)').all().some(c=>c.name==='requested'))db.exec("ALTER TABLE ops_users ADD COLUMN requested TEXT NOT NULL DEFAULT ''");
 const ensure=(sub,name='')=>db.prepare("INSERT OR IGNORE INTO ops_users(sub,name,created) VALUES(?,?,?)").run(sub,name,new Date().toISOString());
 for(const sub of allowed){ensure(sub);db.prepare("UPDATE ops_users SET requested='' WHERE sub=?").run(sub);}
 for(const r of db.prepare('SELECT sub FROM team_members').all())ensure(r.sub);
 for(const row of db.prepare('SELECT data FROM sessions').all()){try{const u=JSON.parse(row.data).user;if(u?.sub)ensure(u.sub,u.name||'');}catch{}}
 const row=sub=>db.prepare('SELECT * FROM ops_users WHERE sub=?').get(sub);
 function revoke(sub){for(const r of db.prepare('SELECT id,data FROM sessions').all()){try{if(JSON.parse(r.data).user?.sub===sub)db.prepare('DELETE FROM sessions WHERE id=?').run(r.id);}catch{}}}
 return {
  blocked:sub=>row(sub)?.active===0,
  granted:sub=>!!row(sub)?.granted&&row(sub)?.active===1,
  request(sub,name){
   if(typeof sub!=='string'||!sub||sub.length>200||/[\u0000-\u0020]/.test(sub))throw Error('用户ID无效');
   ensure(sub);const current=row(sub);if(!current.active||current.granted||allowed.includes(sub))return;
   db.prepare('UPDATE ops_users SET name=?,requested=? WHERE sub=?').run(String(name||sub).slice(0,200),current.requested||new Date().toISOString(),sub);
   if(!current.requested)db.prepare('INSERT INTO ops_user_events VALUES(?,?,?,?)').run(sub,sub,'access_requested',new Date().toISOString());
  },
  seen(sub,name){ensure(sub,name);db.prepare("UPDATE ops_users SET name=?,last_login=?,requested='' WHERE sub=?").run(String(name||sub).slice(0,200),new Date().toISOString(),sub);},
  list(search='',page=1,filter='all'){for(const r of db.prepare('SELECT sub FROM team_members').all())ensure(r.sub);search=String(search).trim().slice(0,100);page=Math.max(1,Math.min(100000,Math.trunc(Number(page))||1));const pattern='%'+search.replace(/[\\%_]/g,'\\$&')+'%';let where="WHERE (u.sub LIKE ? ESCAPE '\\' OR u.name LIKE ? ESCAPE '\\' OR t.name LIKE ? ESCAPE '\\')",args=[pattern,pattern,pattern];if(filter==='pending')where+=" AND u.active=1 AND u.granted=0 AND u.requested<>'' AND m.sub IS NULL";else if(filter==='disabled')where+=' AND u.active=0';else if(filter!=='all')throw Error('用户筛选无效');
   const total=db.prepare('SELECT COUNT(*) n FROM ops_users u LEFT JOIN team_members m ON m.sub=u.sub LEFT JOIN teams t ON t.id=m.team_id '+where).get(...args).n;
   const items=db.prepare('SELECT u.*,m.team_id,m.role,m.active member_active,t.name team_name FROM ops_users u LEFT JOIN team_members m ON m.sub=u.sub LEFT JOIN teams t ON t.id=m.team_id '+where+' ORDER BY u.last_login DESC,u.sub LIMIT 20 OFFSET ?').all(...args,(page-1)*20).map(u=>({...u,system_admin:isSystemAdmin(u.sub),allowlisted:allowed.includes(u.sub)}));return {items,total,page,pageSize:20,pending:db.prepare("SELECT COUNT(*) n FROM ops_users u LEFT JOIN team_members m ON m.sub=u.sub WHERE u.active=1 AND u.granted=0 AND u.requested<>'' AND m.sub IS NULL").get().n};
  },
  detail(sub){
   const user=db.prepare('SELECT u.*,m.team_id,m.role,m.active member_active,t.name team_name FROM ops_users u LEFT JOIN team_members m ON m.sub=u.sub LEFT JOIN teams t ON t.id=m.team_id WHERE u.sub=?').get(sub);if(!user)throw Error('用户不存在');
   const sources=[...(allowed.includes(sub)?['部署允许名单']:[]),...(user.granted?['OPS管理员授权']:[]),...(user.team_id?['团队成员']:[])];let sessions=0;
   for(const r of db.prepare('SELECT data FROM sessions WHERE expires>?').all(Date.now())){try{if(JSON.parse(r.data).user?.sub===sub)sessions++;}catch{}}
   const events=db.prepare('SELECT e.actor,e.action,e.created,u.name actor_name FROM ops_user_events e LEFT JOIN ops_users u ON u.sub=e.actor WHERE e.subject=? ORDER BY e.created DESC,e.rowid DESC LIMIT 50').all(sub);
   return {user:{...user,system_admin:isSystemAdmin(sub),sources,access:!user.active?'disabled':user.member_active===0?'team_disabled':sources.length?'enabled':user.requested?'pending':'unauthorized',sessions},events};
  },
  update(actor,input){
   const sub=input.sub;if(typeof sub!=='string'||!sub||sub.length>200||/[\u0000-\u0020]/.test(sub))throw Error('请填写准确的Casdoor用户ID（sub）');
   if(!['enable','disable','revoke_sessions','role'].includes(input.action))throw Error('用户操作无效');
   if(input.action==='disable'&&(actor===sub||isSystemAdmin(sub)))throw Error('不能停用当前账号或系统管理员');
   db.exec('BEGIN IMMEDIATE');try{
    ensure(sub);
    if(input.action==='enable')db.prepare("UPDATE ops_users SET active=1,granted=1,requested='' WHERE sub=?").run(sub);
    if(input.action==='disable'){db.prepare('UPDATE ops_users SET active=0 WHERE sub=?').run(sub);revoke(sub);}
    if(input.action==='revoke_sessions')revoke(sub);
    if(input.action==='role'){
     if(!['admin','reviewer','editor'].includes(input.role))throw Error('团队角色无效');const old=db.prepare('SELECT * FROM team_members WHERE sub=?').get(sub);if(!old)throw Error('此用户尚未加入团队，请先由团队管理员添加');
     if(old.active&&old.role==='admin'&&input.role!=='admin'&&db.prepare("SELECT COUNT(*) n FROM team_members WHERE team_id=? AND role='admin' AND active=1").get(old.team_id).n<=1)throw Error('团队必须保留至少一位启用的管理员');
     db.prepare('UPDATE team_members SET role=? WHERE sub=?').run(input.role,sub);
    }
    db.prepare('INSERT INTO ops_user_events VALUES(?,?,?,?)').run(actor,sub,input.action+(input.action==='role'?':'+input.role:''),new Date().toISOString());db.exec('COMMIT');return {ok:true};
   }catch(e){db.exec('ROLLBACK');throw e;}
  }
 };
}
