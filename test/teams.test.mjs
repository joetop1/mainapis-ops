import test from 'node:test';
import assert from 'node:assert/strict';
import {openStore} from '../core.mjs';
import {teamStore,teamPermission} from '../teams.mjs';
test('creates shared ownership once, preserves job snapshots and prevents membership capture',()=>{
 const db=openStore(':memory:'),teams=teamStore(db),connections=new Map([['alice',{token:'secret'}]]);
 try{
  db.prepare('INSERT INTO products VALUES(?,?,?,?,?,?,?,?)').run('p','alice','source','{}','approved',1,'now','now');db.prepare('INSERT INTO jobs VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('j','alice','p',1,'crmeb-pro','unknown','token','','','now','now');db.prepare('INSERT INTO job_snapshots(job_id,product,claimed) VALUES(?,?,1)').run('j','snapshot');
  const team=teams.create('alice','运营团队',[{get:id=>connections.get(id),set:(id,value)=>connections.set(id,value)}]);
  assert.equal(db.prepare('SELECT owner FROM products').get().owner,team.id);assert.equal(db.prepare('SELECT owner FROM jobs').get().owner,team.id);assert.equal(db.prepare('SELECT claimed FROM job_snapshots').get().claimed,1);assert.equal(db.prepare('SELECT product FROM job_snapshots').get().product,'snapshot');assert.equal(connections.get(team.id).token,'secret');
  teams.setMember('alice','bob','editor');assert.equal(teams.context('bob').id,team.id);assert.throws(()=>teams.setMember('bob','eve','admin'));
  assert.throws(()=>teams.setMember('alice','alice','editor'),/至少一位/);
  teams.create('carol','其他团队',[]);assert.throws(()=>teams.setMember('alice','carol','editor'),/另一个团队/);
  teams.setMember('alice','bob','editor',0);assert.equal(teams.context('bob'),null);assert.equal(teams.member('bob').active,0);
 }finally{db.close();}
});
test('editor can edit but never approve, publish, retry, verify or access secrets; reviewer cannot administer',()=>{
 for(const path of ['/api/products/p/approve','/api/products/p/publish','/api/jobs/j/retry','/api/jobs/j/verify','/api/team/members','/api/connections/tigshop'])assert.equal(teamPermission('editor',path,'POST'),false);
 assert.equal(teamPermission('editor','/api/products/p','PUT'),true);assert.equal(teamPermission('editor','/api/catalog/crmeb-pro','GET'),true);
 assert.equal(teamPermission('reviewer','/api/products/p/publish','POST'),true);assert.equal(teamPermission('reviewer','/api/connections/crmeb-pro/publishing','GET'),false);assert.equal(teamPermission('reviewer','/api/team/members','POST'),false);
});
