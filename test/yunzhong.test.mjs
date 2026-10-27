import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {createYunzhongClient,signYunzhong,yunzhongQueryString,requireYunzhongCredentials,loadYunzhongCategories,YUNZHONG_BASE} from '../yunzhong-client.mjs';
test('签名兼容PHP字典序、空值、布尔值及默认转义JSON',()=>{
 const input={z:'中文 / x',list:[{name:'容量',value:'https://x.test/a'}],nullish:null,yes:true,no:false,sign:'ignore'};
 const expected='list=[{"name":"\\u5bb9\\u91cf","value":"https:\\/\\/x.test\\/a"}]&no=&nullish=&yes=1&z=中文 / x';
 assert.equal(yunzhongQueryString(input),expected);
 assert.equal(signYunzhong(input,'secret'),createHmac('sha256','secret').update(expected).digest('hex'));
 assert.throws(()=>yunzhongQueryString({price:1.23}));
});
test('固定商城只读请求，鉴权签名不含密钥，不允许覆盖鉴权或新增商品',async()=>{
 const calls=[],client=createYunzhongClient({appid:'2026102700151259',appsecret:'secret'},async(url,options)=>{calls.push({url,options});return {ok:true,text:async()=>JSON.stringify({result:1,data:{data:[]}})};});
 await client('goods/list',{page:1,status:0});const {url,options}=calls[0],query=Object.fromEntries(new URL(url).searchParams);
 assert.ok(url.startsWith(YUNZHONG_BASE));assert.equal(query.sign_type,'SHA256');assert.equal(options.method,'GET');assert.equal(options.redirect,'error');assert.equal(query.sign,signYunzhong(query,'secret'));assert.equal(url.includes('secret'),false);
 await assert.rejects(client('goods/create',{}));await assert.rejects(client('goods/list',{app_id:'other'}));assert.equal(calls.length,1);
 const bad=createYunzhongClient({appid:'1',appsecret:'secret'},async()=>({ok:true,text:async()=>JSON.stringify({result:0,msg:'secret',data:{token:'sensitive'}})}));await assert.rejects(bad('goods/list'),error=>!error.message.includes('secret'));
 assert.throws(()=>requireYunzhongCredentials({appid:'2',appsecret:''},{appid:'1',appsecret:'old'}));
 assert.equal(requireYunzhongCredentials({appid:'1',appsecret:''},{appid:'1',appsecret:'old'}).appsecret,'old');
});
test('分类逐级读取含分页，拒绝循环及错误父分类',async()=>{
 const client=async(route,{parent_id,page})=>({result:1,data:{data:parent_id===0?[{id:page,name:'分类'+page,parent_id:0}]:parent_id===1?[{id:3,name:'子类',parent_id:1}]:[],last_page:parent_id===0?2:1}});
 const data=await loadYunzhongCategories(client);assert.deepEqual(data.categories.map(c=>c.ids),[[1],[2],[1,3]]);
 await assert.rejects(loadYunzhongCategories(async()=>({result:1,data:{data:[{id:1,parent_id:1,name:'错'}],last_page:1}})));
});
