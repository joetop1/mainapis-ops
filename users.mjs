export function userDirectory({db,allowed,isSystemAdmin}){
 db.exec("CREATE TABLE IF NOT EXISTS ops_users(sub TEXT PRIMARY KEY,name TEXT NOT NULL DEFAULT '',active INTEGER NOT NULL DEFAULT 1,granted INTEGER NOT NULL DEFAULT 0,last_login TEXT NOT NULL DEFAULT '',created TEXT NOT NULL);CREATE TABLE IF NOT EXISTS ops_user_events(actor TEXT NOT NULL,subject TEXT NOT NULL,action TEXT NOT NULL,created TEXT NOT NULL)");
 const ensure=(sub,name='')=>db.prepare("INSERT OR IGNORE INTO ops_users(sub,name,created) VALUES(?,?,?)").run(sub,name,new Date().toISOString());
 for(const sub of allowed)ensure(sub);
 for(const r of db.prepare('SELECT sub FROM team_members').all())ensure(r.sub);
 for(const row of db.prepare('SELECT data FROM sessions').all()){try{const u=JSON.parse(row.data).user;if(u?.sub)ensure(u.sub,u.name||'');}catch{}}
 const row=sub=>db.prepare('SELECT * FROM ops_users WHERE sub=?').get(sub);
 function revoke(sub){for(const r of db.prepare('SELECT id,data FROM sessions').all()){try{if(JSON.parse(r.data).user?.sub===sub)db.prepare('DELETE FROM sessions WHERE id=?').run(r.id);}catch{}}}
 return {
  blocked:sub=>row(sub)?.active===0,
  granted:sub=>!!row(sub)?.granted&&row(sub)?.active===1,
  seen(sub,name){ensure(sub,name);db.prepare('UPDATE ops_users SET name=?,last_login=? WHERE sub=?').run(String(name||sub).slice(0,200),new Date().toISOString(),sub);},
  list(search='',page=1){for(const r of db.prepare('SELECT sub FROM team_members').all())ensure(r.sub);search=String(search).trim().slice(0,100);page=Math.max(1,Math.min(100000,Math.trunc(Number(page))||1));const pattern='%'+search.replace(/[\\%_]/g,'\\$&')+'%';const where="WHERE u.sub LIKE ? ESCAPE '\\' OR u.name LIKE ? ESCAPE '\\' OR t.name LIKE ? ESCAPE '\\'",args=[pattern,pattern,pattern];
   const total=db.prepare('SELECT COUNT(*) n FROM ops_users u LEFT JOIN team_members m ON m.sub=u.sub LEFT JOIN teams t ON t.id=m.team_id '+where).get(...args).n;
   const items=db.prepare('SELECT u.*,m.team_id,m.role,m.active member_active,t.name team_name FROM ops_users u LEFT JOIN team_members m ON m.sub=u.sub LEFT JOIN teams t ON t.id=m.team_id '+where+' ORDER BY u.last_login DESC,u.sub LIMIT 20 OFFSET ?').all(...args,(page-1)*20).map(u=>({...u,system_admin:isSystemAdmin(u.sub),allowlisted:allowed.includes(u.sub)}));return {items,total,page,pageSize:20};
  },
  update(actor,input){
   const sub=input.sub;if(typeof sub!=='string'||!sub||sub.length>200||/[\u0000-\u0020]/.test(sub))throw Error('请填写准确的Casdoor用户ID（sub）');
   if(!['enable','disable','revoke_sessions','role'].includes(input.action))throw Error('用户操作无效');
   if(input.action==='disable'&&(actor===sub||isSystemAdmin(sub)))throw Error('不能停用当前账号或系统管理员');
   db.exec('BEGIN IMMEDIATE');try{
    ensure(sub);
    if(input.action==='enable')db.prepare('UPDATE ops_users SET active=1,granted=1 WHERE sub=?').run(sub);
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
