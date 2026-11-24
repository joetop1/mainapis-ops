import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm,chmod} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
test('专用接口安装器先校验全部候选文件，备份后安装，重复跳过并拒绝同名差异',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ops-classification-patch-'));
 const controller=join(dir,'app/controller/out/Product.php'),route=join(dir,'route/out.php');
 try{
  for(const p of ['app/controller/out','route','app/services/product/label','app/services/product/product'])await mkdir(join(dir,p),{recursive:true});
  const original="<?php class Product {\n    public function categoryList() {}\n}\n",routes="<?php\n        Route::get('category/list', 'Product/categoryList');\n// AuthTokenMiddleware::class\n";
  await writeFile(controller,original);await writeFile(route,routes);
  await writeFile(join(dir,'app/services/product/label/StoreProductLabelAuxiliaryServices.php'),'function saveLabelRelation');await writeFile(join(dir,'app/services/product/product/StoreProductServices.php'),'store_label_id');
  // Mock only linter exit codes: this tests installation control flow, not PHP syntax.
  const mock=join(dir,'mock-php');await writeFile(mock,'#!/usr/bin/env python3\nimport sys\nsys.exit(1)\n');await chmod(mock,0o755);
  const args=['scripts/patch-crmeb-classification.py','--root',dir,'--php',mock];
  assert.throws(()=>execFileSync('python3',[...args,'--apply'],{stdio:'pipe'}));assert.equal(await readFile(controller,'utf8'),original);assert.equal(await readFile(route,'utf8'),routes);
  await writeFile(mock,'#!/usr/bin/env python3\nimport sys\nsys.exit(0)\n');
  execFileSync('python3',args);assert.equal(await readFile(controller,'utf8'),original);
  execFileSync('python3',[...args,'--apply']);const installed=await readFile(controller,'utf8');assert.match(installed,/OPS_CLASSIFICATION_V1/);assert.equal((await readdir(join(dir,'app/controller/out'))).filter(n=>n.includes('.bak-')).length,1);
  assert.match(execFileSync('python3',[...args,'--apply'],{encoding:'utf8'}),/无需重复/);
  await writeFile(controller,installed.replace('OPS_CLASSIFICATION_V1','OPS_CLASSIFICATION_V2'));assert.throws(()=>execFileSync('python3',[...args,'--apply'],{stdio:'pipe'}));
  const methods=await readFile('integrations/crmeb/ops-classification-methods.php.txt','utf8');
  assert.match(methods,/lock\(true\)/);assert.match(methods,/\$actual !== \$before/);assert.match(methods,/saveLabelRelation/);
  const update=methods.match(/->update\(\[([\s\S]*?)\]\);/)[1];assert.deepEqual([...update.matchAll(/'([a-z_]+)'\s*=>/g)].map(m=>m[1]),['cate_id','store_label_id']);
  assert.doesNotMatch(methods,/->productSave\(/);
  const registry=await readFile('scripts/register-crmeb-classification.php','utf8');assert.match(registry,/\/ops-classification\/product\/\{id\}/);assert.doesNotMatch(registry,/product\/:id/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
