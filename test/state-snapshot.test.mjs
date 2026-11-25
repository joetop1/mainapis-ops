import test from 'node:test';
import assert from 'node:assert/strict';
import {openStore} from '../core.mjs';
import {recentStateJobs,measureState} from '../state-snapshot.mjs';
test('状态任务一次JOIN保留原回执字段与汇率，按工作空间隔离且限制300条',()=>{
 const db=openStore(':memory:');try{
 for(const [id,owner] of [['p','alice'],['q','bob']])db.prepare('INSERT INTO products VALUES(?,?,?,?,?,?,?,?)').run(id,owner,'https://example.com/'+id,'{}','draft',1,'now','now');
 const insert=db.prepare('INSERT INTO jobs(id,owner,product_id,revision,target,status,token,created,updated) VALUES(?,?,?,?,?,?,?,?,?)');
 insert.run('fx','alice','p',2,'tigshop','accepted','token','999','999');
 db.prepare('INSERT INTO job_snapshots(job_id,product,claimed) VALUES(?,?,?)').run('fx',JSON.stringify({tigshop:{fx:{rate:7.8,date:'today'}}}),1);
 insert.run('foreign','bob','q',1,'tigshop','accepted','private','999','999');
 for(let i=0;i<305;i++)insert.run('j'+i,'alice','p',1,'crmeb-pro','failed','token',String(i).padStart(3,'0'),'now');
 const rows=recentStateJobs(db,'alice');assert.equal(rows.length,300);assert.equal(rows[0].id,'fx');assert.deepEqual(rows[0].fx,{rate:7.8,date:'today'});assert.equal(rows[0].claimed,true);assert.equal(rows[0].marker,'OPS-fx');
 assert(!rows.some(row=>row.id==='foreign'));assert.equal(rows[1].fx,null);assert.equal(rows[1].claimed,false);assert(!('token' in rows[0]));assert(!('fx_json' in rows[0]));
 }finally{db.close();}
});
test('状态分段计时不改变数据，只报告耗时',()=>{
 let timing;const data=measureState(measure=>({products:measure('products_ms',()=>[1]),malls:measure('malls_ms',()=>[2])}),value=>timing=value);
 assert.deepEqual(data,{products:[1],malls:[2]});assert(timing.total_ms>=0);assert(timing.products_ms>=0);assert(timing.malls_ms>=0);
});
