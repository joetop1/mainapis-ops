import {readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join,dirname} from 'node:path';
const root=dirname(dirname(fileURLToPath(import.meta.url)));
const library=readFileSync(join(root,'crmeb-official.mjs'),'utf8').replaceAll('export ','');
const cfg={categoryMap:{'炮机':[116]},shippingTemplateId:0};
const code=(id,name,x,source)=>({id,name,type:'n8n-nodes-base.code',typeVersion:2,position:[x,0],parameters:{jsCode:source}});
const http=(id,name,x,parameters)=>({id,name,type:'n8n-nodes-base.httpRequest',typeVersion:4.2,position:[x,0],parameters:{...parameters,options:{redirect:{redirect:{followRedirects:false}},timeout:30000}},retryOnFail:false});
const bearer=value=>({sendHeaders:true,headerParameters:{parameters:[{name:'Authorization',value}]}});
const body=value=>({sendBody:true,specifyBody:'json',jsonBody:value});
const nodes=[
 {id:'webhook',name:'接收 OPS 官方接口任务',type:'n8n-nodes-base.webhook',typeVersion:2,position:[0,0],webhookId:'ops-crmeb-official',parameters:{httpMethod:'POST',path:'ops-crmeb-official',authentication:'headerAuth',responseMode:'onReceived',options:{}}},
 code('preflight','校验请求',200,`const b=$json.body;
if(!b||!['publish_draft','verify_draft'].includes(b.action)||b.target!=='crmeb-pro')throw Error('仅支持会员商城官方入库与核对');
if(typeof b.job_id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(b.job_id))throw Error('任务ID错误');
if(b.callback?.url!=='https://ops.mainapis.com/api/callback/'+b.job_id||typeof b.callback.token!=='string'||b.callback.token.length<32)throw Error('回调地址或令牌错误');
return [{json:{action:b.action,verification_nonce:b.verification_nonce||'',callbackUrl:b.callback.url,callbackToken:b.callback.token}}];`),
 http('context','读取可信任务快照',400,{method:'POST',url:'={{ $json.callbackUrl + "/claim" }}',...bearer('={{ "Bearer " + $json.callbackToken }}'),...body('={{ {action:$json.action === "publish_draft" ? "inspect_publish" : $json.action, verification_nonce:$json.verification_nonce} }}')}),
 http('token','获取 CRMEB Token',600,{method:'POST',url:'https://xlupw.com/outapi/access_token',authentication:'genericCredentialType',genericAuthType:'httpCustomAuth'}),
 code('prepare','配置分类运费并转换字段',800,library+`\nconst config=${JSON.stringify(cfg)};\nconst lease=$('读取可信任务快照').first().json;\nconst token=requireOfficialToken($json);\nconst payload=lease.action==='publish_draft'?buildOfficialProduct(lease,config):null;\nif(lease.action==='verify_draft'&&!/^[1-9][0-9]{0,14}$/.test(lease.candidate_id))throw Error('商品ID无效');\nreturn [{json:{token,payload,config,action:lease.action,candidate_id:lease.candidate_id}}];`),
 {id:'branch',name:'创建还是核对',type:'n8n-nodes-base.if',typeVersion:2.2,position:[1000,0],parameters:{conditions:{options:{caseSensitive:true,leftValue:'',typeValidation:'strict',version:2},conditions:[{id:'publish',leftValue:'={{ $json.action }}',rightValue:'publish_draft',operator:{type:'string',operation:'equals'}}],combinator:'and'},options:{}}},
 http('lock','锁定一次创建',1200,{method:'POST',url:'={{ $("校验请求").first().json.callbackUrl + "/claim" }}',...bearer('={{ "Bearer " + $("校验请求").first().json.callbackToken }}'),...body('={{ {action:"publish_draft"} }}')}),
 http('create','官方新增下架商品',1400,{method:'POST',url:'https://xlupw.com/outapi/product',...bearer('={{ "Bearer " + $("配置分类运费并转换字段").first().json.token }}'),...body('={{ $("配置分类运费并转换字段").first().json.payload }}')}),
 code('receipt','创建后等待核对ID',1600,library+`\nreturn [{json:officialCreateReceipt($json)}];`),
 http('detail','官方读取商品详情',1200,{method:'GET',url:'={{ "https://xlupw.com/outapi/product/" + $json.candidate_id }}',...bearer('={{ "Bearer " + $json.token }}')}),
 code('verify','核验实际入库结果',1400,library+`\nconst lease=$('读取可信任务快照').first().json;\nconst config=$('配置分类运费并转换字段').first().json.config;\nreturn [{json:verifyOfficialProduct($json,lease,config)}];`),
 http('callback','回传 OPS 结果',1800,{method:'POST',url:'={{ $("校验请求").first().json.callbackUrl }}',...bearer('={{ "Bearer " + $("校验请求").first().json.callbackToken }}'),...body('={{ {...$json, verification_nonce:$("读取可信任务快照").first().json.action === "verify_draft" ? $("读取可信任务快照").first().json.verification_nonce : ""} }}')})
];
nodes.find(n=>n.id==='detail').position=[1200,240];nodes.find(n=>n.id==='verify').position=[1400,240];
const connections={};const link=(a,b)=>connections[a]={main:[[{node:b,type:'main',index:0}]]};
for(const [a,b]of [['接收 OPS 官方接口任务','校验请求'],['校验请求','读取可信任务快照'],['读取可信任务快照','获取 CRMEB Token'],['获取 CRMEB Token','配置分类运费并转换字段'],['配置分类运费并转换字段','创建还是核对'],['锁定一次创建','官方新增下架商品'],['官方新增下架商品','创建后等待核对ID'],['创建后等待核对ID','回传 OPS 结果'],['官方读取商品详情','核验实际入库结果'],['核验实际入库结果','回传 OPS 结果']])link(a,b);
connections['创建还是核对']={main:[[{node:'锁定一次创建',type:'main',index:0}],[{node:'官方读取商品详情',type:'main',index:0}]]};
writeFileSync(join(root,'workflows/publish-crmeb-official.json'),JSON.stringify({name:'OPS · CRMEB官方接口下架入库与核对',active:false,settings:{executionOrder:'v1',saveDataSuccessExecution:'none',saveDataErrorExecution:'none',saveManualExecutions:false},nodes,connections},null,2)+'\n');
