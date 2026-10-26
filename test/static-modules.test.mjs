import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
test('网页入口与全部ES模块依赖可经HTTP加载，避免新增模块遗漏导致白屏',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ops-static-'));
 Object.assign(process.env,{DATA_DIR:dir,APP_ORIGIN:'http://127.0.0.1',DEMO_MODE:'true'});
 const {handler,closeStore}=await import('../server.mjs');
 const server=http.createServer(handler);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+server.address().port;
 try{
  const page=await fetch(origin+'/');assert.equal(page.status,200);const html=await page.text();
  const paths=[...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map(m=>new URL(m[1],origin).pathname),seen=new Set();
  while(paths.length){const path=paths.pop();if(seen.has(path))continue;seen.add(path);
   const res=await fetch(origin+path);assert.equal(res.status,200,path);assert.match(res.headers.get('content-type'),/javascript/,path);
   const source=await res.text();
   for(const match of source.matchAll(/(?:from\s*|import\s*)['"](\.\.?\/[^'"]+)['"]/g))paths.push(new URL(match[1],origin+path).pathname);
  }
  assert.ok(seen.has('/collector-version.js'));
 }finally{await new Promise(resolve=>server.close(resolve));closeStore();await rm(dir,{recursive:true,force:true});}
});
