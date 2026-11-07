import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {openStore} from '../core.mjs';
test('运行保障仅系统管理员可用，手动备份需要CSRF，子进程实际完成备份；公开健康端点不暴露内部状态',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ops-operations-api-'));Object.assign(process.env,{DATA_DIR:dir,APP_ORIGIN:'https://ops.mainapis.com',DEMO_MODE:'false',ALLOWED_SUBJECTS:'alice,bob',SYSTEM_ADMIN_SUBJECTS:'alice'});
 const {handler,closeStore}=await import('../server.mjs'),db=openStore(join(dir,'ops.sqlite'));
 for(const sub of ['alice','bob'])db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(sub,JSON.stringify({user:{sub},csrf:'csrf'}),Date.now()+60000);
 const call=async(path,method='GET',user='alice',csrf='csrf')=>{const req=Readable.from([Buffer.from('{}')]);Object.assign(req,{url:path,method,headers:{cookie:'ops_session='+user,origin:'https://ops.mainapis.com','x-csrf-token':csrf}});const res={setHeader(){},writeHead(status){this.status=status;},end(bytes){this.body=bytes;}};await handler(req,res);return {status:res.status,data:JSON.parse(res.body)};};
 try{
 assert.equal((await call('/api/operations','GET','nobody')).status,401);assert.equal((await call('/api/operations','GET','bob')).status,403);assert.equal((await call('/api/operations/backup','POST','alice','bad')).status,403);
 const health=await call('/readyz','GET','nobody');assert.equal(health.status,200);assert.deepEqual(Object.keys(health.data).sort(),['ok','reason']);
 assert.equal((await call('/api/operations/backup','POST')).status,202);
 let state;for(let n=0;n<100;n++){state=(await call('/api/operations')).data;if(!state.backup.running)break;await new Promise(r=>setTimeout(r,30));}
 assert.equal(state.backup.running,false);assert.equal(state.backup.lastError,'');assert.ok(state.backup.lastSuccess);assert.equal(JSON.stringify(state).includes('connections.key'),false);
 }finally{db.close();closeStore();await rm(dir,{recursive:true,force:true});}
});
