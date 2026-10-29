import test from 'node:test';
import assert from 'node:assert/strict';
import {openStore} from '../core.mjs';
import {teamStore} from '../teams.mjs';
import {jobInitiators} from '../job-initiators.mjs';
import {jobPage} from '../job-pages.mjs';
function add(db,id,owner,mall='mall1',status='failed'){
 db.prepare('INSERT OR IGNORE INTO products VALUES(?,?,?,?,?,?,?,?)').run('p'+owner,owner,owner,'{}','draft',1,'now','now');
 db.prepare('INSERT INTO jobs(id,owner,product_id,revision,target,status,token,created,updated,mall_connection_id) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,owner,'p'+owner,1,'yunzhong',status,'private-token',id,'now',mall);
}
test('任务发起人独立记录，按成员商城状态组合过滤后分页且不泄露密钥',()=>{
 const db=openStore(':memory:');try{teamStore(db);const i=jobInitiators(db);for(let n=0;n<45;n++){const id=String(n).padStart(3,'0');add(db,id,'team:one',n%2?'mall1':'mall2');i.record(id,n%2?'bob':'alice');}add(db,'other','team:two');i.record('other','alice');
 const page=jobPage(db,'team:one',2,20,{scope:'mine',actor:'alice',mall:'mall2',status:'failed'});assert.equal(page.total,23);assert.equal(page.rows.length,3);assert.ok(page.rows.every(row=>row.initiated_by==='alice'&&row.mall_connection_id==='mall2'));assert.equal(JSON.stringify(page).includes('private-token'),false);assert.equal(jobPage(db,'team:one',1,20,{scope:'mine',actor:'alice',mall:'mall1'}).total,0);assert.equal(jobPage(db,'team:one',1,20,{scope:'all'}).total,45);assert.throws(()=>jobPage(db,'team:one',1,20,{status:'bad'}));
 i.record('000','bob');assert.equal(jobPage(db,'team:one',1,20,{scope:'mine',actor:'alice'}).total,23);
 }finally{db.close();}
});
test('旧任务按job.create日志恢复而非商品采集人，未知记录只在团队全部',()=>{
 const db=openStore(':memory:');try{const teams=teamStore(db);add(db,'personal','alice');add(db,'historical','team:one');add(db,'unknown','team:one');db.prepare('INSERT INTO team_events VALUES(?,?,?,?,?,?)').run('e','team:one','bob','job.create','historical','now');db.prepare('INSERT INTO team_events VALUES(?,?,?,?,?,?)').run('fake','team:other','eve','job.create','unknown','now');jobInitiators(db);assert.equal(jobPage(db,'team:one',1,20,{scope:'mine',actor:'bob'}).rows[0].id,'historical');assert.equal(jobPage(db,'team:one',1,20,{scope:'mine',actor:'eve'}).total,0);assert.equal(jobPage(db,'team:one',1,20).rows.find(x=>x.id==='unknown').initiated_by,null);const team=teams.create('alice','团队',[]);assert.equal(jobPage(db,team.id,1,20,{scope:'mine',actor:'alice'}).rows[0].id,'personal');jobInitiators(db);assert.equal(jobPage(db,team.id,1,20,{scope:'mine',actor:'alice'}).total,1);
 }finally{db.close();}
});
