import test from 'node:test';
import assert from 'node:assert/strict';
import {openStore} from '../core.mjs';
import {teamStore} from '../teams.mjs';
import {jobInitiators} from '../job-initiators.mjs';
import {jobPage,jobSummary} from '../job-pages.mjs';
import {dashboardCards} from '../public/dashboard.js';
test('任务计数读取全部历史、按当前筛选统计、状态变更实时反映且空间隔离',()=>{
 const db=openStore(':memory:');teamStore(db);const initiators=jobInitiators(db);
 db.prepare('INSERT INTO products VALUES(?,?,?,?,?,?,?,?)').run('p','team:one','url','{}','draft',1,'now','now');
 const insert=db.prepare('INSERT INTO jobs(id,owner,product_id,revision,target,status,token,created,updated,mall_connection_id) VALUES(?,?,?,?,?,?,?,?,?,?)');
 for(let n=0;n<350;n++){const id='j'+n;insert.run(id,'team:one','p',n+1,'crmeb-pro','succeeded','t','now','now','mall-a');initiators.record(id,'alice');}
 let revision=351;
 for(const [id,status,actor,mall] of [['run','accepted','alice','mall-a'],['verify','verifying','alice','mall-a'],['review','awaiting_review','alice','mall-b'],['unknown','unknown','bob','mall-a'],['fail','failed','alice','mall-a']]){insert.run(id,'team:one','p',revision++,'crmeb-pro',status,'t','now','now',mall);initiators.record(id,actor);}
 insert.run('outside','bob','p',999,'crmeb-pro','succeeded','t','now','now','mall-a');
 assert.deepEqual({...jobSummary(db,'team:one')},{total:355,running:2,review:2,succeeded:350,failed:1});
 const page=jobPage(db,'team:one',1,20,{scope:'mine',actor:'alice',mall:'mall-a'});assert.equal(page.rows.length,20);assert.equal(page.summary.total,353);assert.equal(page.summary.succeeded,350);assert.equal(page.summary.review,0);
 assert.equal(jobPage(db,'team:one',1,20,{status:'failed'}).summary.total,1);assert.equal(jobSummary(db,'none').total,0);
 db.prepare("UPDATE jobs SET status='succeeded' WHERE id='run'").run();assert.equal(jobSummary(db,'team:one').succeeded,351);assert.equal(jobSummary(db,'team:one').running,1);db.close();
});
test('发布任务页显示任务卡片，采集箱保留商品统计且成功数不受300条限制',()=>{
 const state={products:[{status:'draft'},{status:'approved'}],jobs:[],job_summary:{succeeded:350}},view={summary:{total:500,running:20,review:10,succeeded:450,failed:20}};
 const jobs=dashboardCards('jobs',state,view);assert.deepEqual(jobs.map(c=>c.value),[500,20,10,450]);assert.equal(jobs[0].label,'任务总数');
 const products=dashboardCards('products',state,view);assert.deepEqual(products.map(c=>c.value),[2,1,1,350]);assert.equal(products[0].label,'商品总数');
});
