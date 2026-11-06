import test from 'node:test';
import assert from 'node:assert/strict';
import {draftCache} from '../extensions/1688-collector/draft-cache.js';
test('Safari本地存储超限时使用独立草稿库，迁移旧草稿且保留其他设置',async()=>{
 let stored;const removed=[],storage={set:async()=>{throw Error('Exceeded storage quota');},get:async()=>({draft:{product:{title:'旧草稿'}}}),remove:async keys=>removed.push(keys)};
 const cache=draftCache({storage,database:{put:async value=>{stored=value;},get:async()=>stored}});
 assert.equal((await cache.read()).product.title,'旧草稿');assert.equal(stored.product.title,'旧草稿');const draft={product:{title:'新商品',images:Array(100).fill('https://example.com/image.jpg')}};assert.equal((await cache.save(draft)).saved,true);assert.deepEqual(await cache.read(),draft);assert.deepEqual(removed[0],['draft','merchantImageProduct']);
});
test('两个存储均失败不抛异常，不修改当前采集结果；存储不可用时可回退',async()=>{
 const draft={product:{title:'采集结果'}},before=JSON.stringify(draft),failed=async()=>{throw Error('quota');};
 const cache=draftCache({storage:{set:failed,get:failed,remove:failed},database:{put:failed,get:failed}});assert.deepEqual(await cache.save(draft),{saved:false});assert.equal(await cache.read(),null);assert.equal(JSON.stringify(draft),before);
 let local;const fallback=draftCache({storage:{remove:async()=>{},set:async value=>local=value,get:async()=>local},database:{put:failed,get:failed}});assert.equal((await fallback.save(draft)).saved,true);assert.deepEqual(await fallback.read(),draft);
});
test('自动保存串行防止旧内容覆盖新编辑，限制草稿体积',async()=>{
 let stored;const cache=draftCache({storage:{remove:async()=>{}},database:{put:async value=>{if(value===1)await new Promise(r=>setTimeout(r,10));stored=value;},get:async()=>stored}});await Promise.all([cache.save(1),cache.save(2)]);assert.equal(await cache.read(),2);assert.equal((await cache.save('x'.repeat(2*1024*1024))).saved,false);assert.equal(await cache.read(),2);
});
