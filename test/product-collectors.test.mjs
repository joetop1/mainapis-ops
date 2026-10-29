import test from 'node:test';
import assert from 'node:assert/strict';
import {openStore} from '../core.mjs';
import {teamStore} from '../teams.mjs';
import {productCollectors} from '../product-collectors.mjs';
const add=(db,id,owner)=>db.prepare('INSERT INTO products VALUES(?,?,?,?,?,?,?,?)').run(id,owner,id,'{}','draft',1,'now','now');
test('采集人按当前账号记录、不会被后续编辑抢占；我的视图隔离成员和工作空间',()=>{
 const db=openStore(':memory:');try{teamStore(db);const c=productCollectors(db);add(db,'a','team:one');add(db,'b','team:one');add(db,'c','team:two');c.record('a','alice','小蓝');c.record('b','bob','同事');c.record('c','alice','小蓝');c.record('a','bob','同事');assert.deepEqual(c.rows('team:one','alice','mine').map(x=>x.id),['a']);assert.equal(c.rows('team:one','alice','mine')[0].collector_name,'小蓝');assert.equal(c.rows('team:one','bob','mine')[0].id,'b');assert.equal(c.rows('team:one','alice','all').length,2);assert.throws(()=>c.rows('team:one','alice','invalid'));}finally{db.close();}
});
test('历史创建事件及个人迁入团队保留采集归属；不猜测无记录历史商品',()=>{
 const db=openStore(':memory:');try{const teams=teamStore(db);add(db,'personal','alice');add(db,'historical','team:one');add(db,'unknown','team:one');add(db,'migrated','team:one');db.prepare('INSERT INTO team_events VALUES(?,?,?,?,?,?)').run('e','team:one','bob','product.create','historical','now');db.prepare('INSERT INTO audit VALUES(?,?,?,?,?)').run('audit','carol','product.create','migrated','now');let c=productCollectors(db);assert.equal(c.rows('team:one','bob','mine')[0].id,'historical');assert.equal(c.rows('team:one','carol','mine')[0].id,'migrated');assert.equal(c.rows('team:one','alice','all').find(x=>x.id==='unknown').collected_by,null);const team=teams.create('alice','团队',[]);assert.equal(c.rows(team.id,'alice','mine')[0].id,'personal');c=productCollectors(db);assert.equal(c.rows(team.id,'alice','mine').length,1);}finally{db.close();}
});
