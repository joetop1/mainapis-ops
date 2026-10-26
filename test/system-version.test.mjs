import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {systemVersion} from '../system-version.mjs';
test('系统构建标识稳定，随部署代码变化，不受凭据和运营数据影响',async()=>{
 const root=await mkdtemp(join(tmpdir(),'ops-version-'));
 try{
  await mkdir(join(root,'public'));await mkdir(join(root,'extensions/1688-collector'),{recursive:true});
  await writeFile(join(root,'package.json'),'{"version":"0.2.1"}');
  await writeFile(join(root,'public/app.js'),'original');
  const first=await systemVersion(root);assert.equal(first.version,'0.2.1');assert.match(first.build,/^[0-9a-f]{12}$/);
  await writeFile(join(root,'.env'),'secret');assert.deepEqual(await systemVersion(root),first);
  await writeFile(join(root,'public/app.js'),'updated');assert.notEqual((await systemVersion(root)).build,first.build);
 }finally{await rm(root,{recursive:true,force:true});}
});
