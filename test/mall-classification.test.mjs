import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mallClassification,classificationClient,classificationCSV} from '../mall-classification.mjs';
const original={id:1013,store_name:'水基润滑',type:0,pid:0,image:'',is_show:1,cate_id:'1',store_label_id:[{id:10,label_name:'水基'}]};
function fixture(){
 const db=new DatabaseSync(':memory:'),rows=new Map([[1013,structuredClone(original)],[1014,{...structuredClone(original),id:1014,is_show:0}]]),requests=[];let broken=false,wrong=false;
 const fetcher=async(url,options)=>{
  const u=new URL(url);requests.push({path:u.pathname,method:options.method});
  if(u.pathname==='/outapi/access_token'){assert.equal(options.method,'POST');return Response.json({status:200,data:{access_token:'token'}});}
  assert.equal(options.method,'GET');assert.ok(!u.pathname.includes('ops-classification'));
  if(u.pathname.startsWith('/outapi/'))assert.equal(options.headers.Authorization,'Bearer token');
  let data;
  if(u.pathname==='/api/category')data=[{id:1,cate_name:'原分类'},{id:2,cate_name:'润滑液'}];
  else if(u.pathname==='/api/brand')data=[];
  else if(u.pathname==='/outapi/product/list'){assert.equal(u.searchParams.get('limit'),'50');data={list:[rows.get(1013)],count:1};}
  else if(/^\/outapi\/product\/\d+$/.test(u.pathname)){let r=structuredClone(rows.get(Number(u.pathname.split('/').at(-1))));if(wrong)r.id=999;if(broken)delete r.store_label_id;data={productInfo:r};}
  else throw Error('unexpected endpoint '+u.pathname);
  return Response.json({status:200,data});
 };
 const service=mallClassification({db,connection:(owner,mall)=>{if(owner!=='alice'||mall!=='member')throw Error('无权');return {system:'crmeb-pro',credentials:{url:'https://mall.example.com',appid:'app',appsecret:'secret'}};},fetcher});
 const preview=(overrides={})=>service.preview('alice',{mall:'member',products:[{id:1013}],category_ids:[2],tag_mode:'add',tag_names:['凉感'],...overrides});
 return {db,rows,requests,service,preview,fetcher,setBroken:v=>broken=v,setWrong:v=>wrong=v};
}
test('只使用官方GET读商品和公开分类，唯一远端POST是授权，不调用整商品保存或专用接口',async()=>{
 const f=fixture();try{
  const c=await f.service.catalog('alice','member');assert.equal(c.mode,'official_readonly');assert.match(c.notice,/非商城标签字典/);
  const list=await f.service.list('alice','member',{page:1});assert.equal(list.products.length,1);assert.deepEqual(list.products[0].category_ids,[1]);
  const p=await f.preview();assert.equal(p.state,'worksheet');assert.deepEqual(p.items[0].before.tag_ids,[10]);assert.deepEqual(p.items[0].after.tag_names,['水基','凉感']);assert.deepEqual(p.items[0].after.category_ids,[2]);
  assert.equal(f.service.view('alice',p.id).items.length,1);assert.throws(()=>f.service.view('bob',p.id),/不属于/);assert.equal(f.service.history('bob').length,0);
  const before=structuredClone(f.rows);assert.throws(()=>f.service.enqueue('alice',p.id),/只读/);assert.throws(()=>f.service.rollback('alice',p.id),/只读/);assert.throws(()=>f.service.verify('alice',p.id,1013),/只读/);await f.service.tick();assert.deepEqual(f.rows,before);
  assert.ok(f.requests.filter(r=>r.method==='POST').every(r=>r.path==='/outapi/access_token'));
 }finally{f.db.close();}
});
test('下架商品按ID读取，原标签未知时不假装空标签，不同团队不能读取',async()=>{
 const f=fixture();try{
  const p=await f.service.list('alice','member',{ids:'1013， 1014'});assert.deepEqual(p.products.map(p=>p.is_show),[1,0]);
  await assert.rejects(f.service.list('alice','member',{show:'0'}),/按商品ID/);
  await assert.rejects(f.service.list('bob','member',{}),/无权/);await assert.rejects(f.service.list('alice','member',{ids:'1;rm'}),/格式无效/);
  f.setBroken(true);await assert.rejects(f.preview(),/缺少商品标签字段/);assert.equal(f.service.history('alice').length,0);
  f.setBroken(false);f.setWrong(true);await assert.rejects(f.preview(),/商品ID不符/);
 }finally{f.db.close();}
});
test('标签追加移除替换清空与保留，仅生成建议；CSV含原值且防公式注入',async()=>{
 const f=fixture();try{
  assert.deepEqual((await f.preview({tag_mode:'remove',tag_names:['水基']})).items[0].after.tag_names,[]);
  assert.deepEqual((await f.preview({tag_mode:'replace',tag_names:[]})).items[0].after.tag_names,[]);
  assert.deepEqual((await f.preview({tag_mode:'keep'})).items[0].after.tag_names,['水基']);
  await assert.rejects(f.preview({category_ids:[999]}),/目标分类/);await assert.rejects(f.preview({category_ids:[]}),/分类不能为空/);
  f.rows.get(1013).store_name='  =HYPERLINK("https://example.com")';const p=await f.preview();const csv=f.service.export('alice',p.id);assert.ok(csv.startsWith('\uFEFF'));assert.match(csv,/原商品标签ID/);assert.match(csv,/1013/);assert.match(csv,/"'  =HYPERLINK/);assert.match(csv,/""https:\/\/example.com""/);
  assert.throws(()=>f.service.export('bob',p.id),/不属于/);
 }finally{f.db.close();}
});
test('原标签只返回数字ID时，追加移除被拦截；保留和明确替换仍保留原ID供后台核对',async()=>{
 const f=fixture();try{
  f.rows.get(1013).store_label_id='10';await assert.rejects(f.preview(),/原标签名称不完整/);
  const p=await f.preview({tag_mode:'keep'});assert.deepEqual(p.items[0].before.tag_ids,[10]);assert.match(p.items[0].warning,/原标签名称不完整/);
  assert.match(classificationCSV(p),/"10"/);
 }finally{f.db.close();}
});
