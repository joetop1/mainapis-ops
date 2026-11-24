import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {classificationRevision,mallClassification} from '../mall-classification.mjs';
import {teamPermission} from '../teams.mjs';
const row={id:1013,title:'水基润滑',image:'',is_show:1,category_ids:[1],tag_ids:[10]};
function fixture(){
 const db=new DatabaseSync(':memory:'),products=new Map([[1013,structuredClone(row)],[1014,{...structuredClone(row),id:1014,title:'凉感润滑'}]]),writes=[];let timeout=false,reject=false,changed=false,wrongId=false,endpoint='https://mall.example.com';
 const fetcher=async(url,options)=>{
  const u=new URL(url);if(u.pathname==='/outapi/access_token')return Response.json({status:200,data:{access_token:'short-token'}});
  assert.match(options.headers.Authorization,/Bearer short-token/);
  let data;
  if(u.pathname.endsWith('/catalog'))data={version:1,categories:[{id:1,pid:0,cate_name:'旧分类'},{id:2,pid:0,cate_name:'润滑液'}],tags:[{id:10,label_name:'水基'},{id:11,label_name:'凉感'}]};
  else if(u.pathname.endsWith('/products'))data={version:1,total:2,page:1,products:[...products.values()]};
  else{
   const id=Number(u.pathname.split('/').at(-1));data=products.get(id);
   if(options.method==='POST'){
    const body=JSON.parse(options.body);assert.deepEqual(Object.keys(body).sort(),['after','before']);writes.push({id,body});
    if(reject)return Response.json({status:400,msg:'conflict'});
    if(changed){data.tag_ids=[99];return Response.json({status:400,msg:'conflict'});}
    assert.deepEqual({category_ids:data.category_ids,tag_ids:data.tag_ids},body.before);Object.assign(data,body.after);
    if(timeout)throw Error('lost response');
   }
   data=structuredClone(data);if(wrongId)data.id=999;
  }return Response.json({status:200,data});
 };
 const service=mallClassification({db,connection:(owner,mall)=>{if(owner!=='alice'||mall!=='member')throw Error('无权');return {system:'crmeb-pro',credentials:{url:endpoint,appid:'test',appsecret:'secret'}};},fetcher});
 const preview=(overrides={})=>service.preview('alice',{mall:'member',products:[{id:1013,revision:classificationRevision(products.get(1013))}],category_ids:[2],tag_ids:[11],tag_mode:'add',...overrides});
 return {db,products,writes,service,preview,setTimeout:v=>timeout=v,setReject:v=>reject=v,setChanged:v=>changed=v,setWrong:v=>wrongId=v,setOrigin:v=>endpoint=v};
}
test('分类整理预览不写商城，Worker只写分类标签并读回，重复确认不重发',async()=>{
 const f=fixture();try{
  const list=await f.service.list('alice','member',{page:1});assert.equal(list.products[0].revision,classificationRevision(row));
  let p=await f.preview();assert.equal(f.writes.length,0);assert.deepEqual(p.items[0].after,{category_ids:[2],tag_ids:[10,11]});
  assert.throws(()=>f.service.view('bob',p.id),/不属于/);assert.throws(()=>f.service.enqueue('bob',p.id),/不属于/);
  f.service.enqueue('alice',p.id);f.service.enqueue('alice',p.id);await Promise.all([f.service.tick(),f.service.tick()]);await f.service.tick();p=f.service.view('alice',p.id);
  assert.equal(p.state,'done');assert.equal(p.items[0].state,'succeeded');assert.equal(f.writes.length,1);
  assert.equal(f.products.get(1013).is_show,1);assert.equal(f.products.get(1013).title,row.title);
  let rollback=await f.service.rollback('alice',p.id);assert.equal(f.writes.length,1);assert.deepEqual(rollback.items[0].after,{category_ids:[1],tag_ids:[10]});f.service.enqueue('alice',rollback.id);await f.service.tick();await f.service.tick();assert.deepEqual(f.products.get(1013).tag_ids,[10]);
 }finally{f.db.close();}
});
test('超时结果记为未知，只读核对不重发；并发变化和连接地址变化阻止写入',async()=>{
 const f=fixture();try{
  const p=await f.preview();f.setTimeout(true);f.service.enqueue('alice',p.id);await f.service.tick();await f.service.tick();assert.equal(f.service.view('alice',p.id).items[0].state,'unknown');assert.equal(f.writes.length,1);
  await f.service.verify('alice',p.id,1013);assert.equal(f.service.view('alice',p.id).items[0].state,'succeeded');assert.equal(f.writes.length,1);
  f.products.get(1013).tag_ids=[99];await assert.rejects(f.service.rollback('alice',p.id),/其他人修改/);
  const next=await f.preview({tag_mode:'replace'});f.products.get(1013).tag_ids=[10];f.service.enqueue('alice',next.id);await f.service.tick();await f.service.tick();assert.equal(f.service.view('alice',next.id).items[0].state,'conflict');assert.equal(f.writes.length,1);
  const third=await f.preview({tag_mode:'replace'});f.setOrigin('https://another.example.com');f.service.enqueue('alice',third.id);await f.service.tick();assert.equal(f.writes.length,1);
 }finally{f.db.close();}
});
test('标签保留、追加、删除、清空；陈旧预览、无效ID和重复任务被拦截',async()=>{
 const f=fixture();try{
  assert.deepEqual((await f.preview({tag_mode:'keep'})).items[0].after.tag_ids,[10]);
  assert.deepEqual((await f.preview({tag_mode:'remove',tag_ids:[10]})).items[0].after.tag_ids,[]);
  assert.deepEqual((await f.preview({tag_mode:'replace',tag_ids:[]})).items[0].after.tag_ids,[]);
  await assert.rejects(f.preview({category_ids:[9]}),/不存在/);await assert.rejects(f.preview({category_ids:[]}),/不能为空/);
  await assert.rejects(f.preview({products:[{id:1013,revision:'stale'}]}),/已变化/);
  const p=await f.preview(),q=await f.preview();f.service.enqueue('alice',p.id);assert.throws(()=>f.service.enqueue('alice',q.id),/已有整理任务/);
  f.db.prepare('UPDATE classification_plans SET created=0 WHERE id=?').run(q.id);assert.throws(()=>f.service.enqueue('alice',q.id),/过期/);
  await assert.rejects(f.service.catalog('bob','member'),/无权/);assert.equal(f.writes.length,0);
 }finally{f.db.close();}
});
test('Worker中断后不重发，读回错误商品不能确认为成功，编辑角色无权同步',async()=>{
 const f=fixture();try{
  const p=await f.preview();f.service.enqueue('alice',p.id);f.db.prepare("UPDATE classification_items SET state='running',updated=0 WHERE plan=?").run(p.id);await f.service.tick();assert.equal(f.service.view('alice',p.id).items[0].state,'unknown');assert.equal(f.writes.length,0);
  f.setWrong(true);await assert.rejects(f.service.verify('alice',p.id,1013),/ID不符/);assert.equal(f.writes.length,0);
  assert.equal(teamPermission('editor','/api/mall-classification/plans/test/submit','POST'),false);
  assert.equal(teamPermission('reviewer','/api/mall-classification/plans/test/submit','POST'),true);
 }finally{f.db.close();}
});
