import {writeFileSync} from 'node:fs';
const request=(id,name,x,parameters)=>({id,name,type:'n8n-nodes-base.httpRequest',typeVersion:4.2,position:[x,0],parameters:{...parameters,options:{redirect:{redirect:{followRedirects:false}},timeout:20000}},retryOnFail:false});
const nodes=[
 {id:'manual',name:'手动检查多门店连接',type:'n8n-nodes-base.manualTrigger',typeVersion:1,position:[0,0],parameters:{}},
 request('token','获取多门店 Token',220,{method:'POST',url:'https://www.xlyp.cc/outapi/get_token',authentication:'genericCredentialType',genericAuthType:'httpCustomAuth'}),
 {id:'validate',name:'校验多门店授权',type:'n8n-nodes-base.code',typeVersion:2,position:[440,0],parameters:{jsCode:`const response=$json;
if(response.status!==undefined&&Number(response.status)!==200)throw Error('多门店授权失败，请核对专用接口账号、密码和权限；不要转发完整响应');
const data=response.data||response;
const token=data.token||data.access_token;
if(typeof token!=='string'||!token)throw Error('多门店未返回 token；请查看 get_token 返回字段结构，不要分享令牌内容');
return [{json:{token,exp_time:data.exp_time??null}}];`}},
 request('categories','只读查询分类（路径待实测）',660,{method:'GET',url:'https://www.xlyp.cc/outapi/product/category',sendHeaders:true,headerParameters:{parameters:[{name:'Authorization',value:'={{ "Bearer " + $json.token }}'}]}}),
 {id:'summary',name:'连接结果（可截图）',type:'n8n-nodes-base.code',typeVersion:2,position:[880,0],parameters:{jsCode:`const response=$json;
const success=Number(response.status)===200;
const data=response.data;
const rows=Array.isArray(data)?data:Array.isArray(data?.list)?data.list:[];
return [{json:{target:'CRMEB 多门店 4.2',authorization:'已获取 Token',category_query:success?'返回成功':'返回业务失败，请核对分类接口路径和权限',category_count:rows.length,categories:rows.slice(0,10).map(x=>({id:x.id,name:x.cate_name||x.name||'',pid:x.pid??null})),note:'此流程只验证授权和读取分类，不创建、不更新商品。分类路径依据旧版官方文档，仍需在当前 4.2 实测。'}}];`}}
];
const connections={};for(let i=0;i<nodes.length-1;i++)connections[nodes[i].name]={main:[[{node:nodes[i+1].name,type:'main',index:0}]]};
writeFileSync(new URL('../workflows/inspect-crmeb-store.json',import.meta.url),JSON.stringify({name:'OPS · 多门店4.2只读连接检查',active:false,settings:{executionOrder:'v1',saveDataSuccessExecution:'none',saveDataErrorExecution:'none',saveManualExecutions:false},nodes,connections},null,2)+'\n');
