import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,access} from 'node:fs/promises';
test('只读版移除商城补丁部署入口及同步按钮，不启动分类写入Worker',async()=>{
 const html=await readFile('public/index.html','utf8'),ui=await readFile('public/mall-classification.js','utf8'),server=await readFile('server.mjs','utf8');
 assert.match(html,/id="classificationExport"/);assert.match(html,/不安装商城补丁/);assert.doesNotMatch(html,/id="classificationSubmit"|id="classificationRollback"/);
 assert.doesNotMatch(ui,/\/submit|\/rollback/);assert.doesNotMatch(server,/classificationTick/);
 for(const path of ['scripts/patch-crmeb-classification.py','scripts/register-crmeb-classification.php','integrations/crmeb/ops-classification-methods.php.txt'])await assert.rejects(access(path));
});
