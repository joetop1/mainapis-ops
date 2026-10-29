// Task initiator is the account that submitted publication, not the product collector.
export function jobInitiators(db){
 db.exec(`CREATE TABLE IF NOT EXISTS job_initiators(job_id TEXT PRIMARY KEY REFERENCES jobs(id),sub TEXT NOT NULL,name TEXT NOT NULL DEFAULT '');
 CREATE INDEX IF NOT EXISTS job_initiators_sub ON job_initiators(sub,job_id);
 INSERT OR IGNORE INTO job_initiators(job_id,sub,name) SELECT id,owner,'' FROM jobs WHERE owner NOT LIKE 'team:%';
 INSERT OR IGNORE INTO job_initiators(job_id,sub,name)
 SELECT j.id,e.actor,'' FROM jobs j JOIN team_events e ON e.object_id=j.id AND e.team_id=j.owner AND e.action='job.create' WHERE e.actor NOT IN ('','system') ORDER BY e.created,e.id;
 INSERT OR IGNORE INTO job_initiators(job_id,sub,name)
 SELECT j.id,a.owner,'' FROM jobs j JOIN audit a ON a.object_id=j.id AND a.action='job.create' WHERE a.owner NOT LIKE 'team:%' ORDER BY a.created,a.id;`);
 return {record(id,sub,name=''){if(!sub)throw Error('缺少任务发起人身份');db.prepare('INSERT OR IGNORE INTO job_initiators VALUES(?,?,?)').run(id,sub,String(name||'').slice(0,100));}};
}
