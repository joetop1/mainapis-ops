import {readFileSync,writeFileSync} from 'node:fs';
const root=new URL('../',import.meta.url);
const workflow=JSON.parse(readFileSync(new URL('workflows/publish-crmeb-official.json',root)));
const base=readFileSync(new URL('crmeb-official.mjs',root),'utf8').replaceAll('export ','');
const store=readFileSync(new URL('crmeb-store.mjs',root),'utf8').replace(/^import .*;\n/m,'').replaceAll('export ','');
workflow.name='OPS · CRMEB多门店4.2下架入库与核对';
for(const node of workflow.nodes){
 if(node.id==='webhook'){node.webhookId='ops-crmeb-store';node.parameters.path='ops-crmeb-store';}
 if(node.id==='preflight')node.parameters.jsCode=node.parameters.jsCode.replace("b.target!=='crmeb-pro'","b.target!=='crmeb-store'").replace('仅支持会员商城官方入库与核对','仅支持多门店官方入库与核对');
 if(node.parameters?.jsCode?.startsWith(base))node.parameters.jsCode=base+'\n'+store+'\n'+node.parameters.jsCode.slice(base.length);
 if(node.id==='prepare')node.parameters.jsCode=node.parameters.jsCode.replace('const config={"categoryMap":{"炮机":[116]},"shippingTemplateId":0};','const config={categoryMap:{},shippingTemplateId:0};').replace('requireOfficialToken($json)','requireStoreToken($json)').replace('buildOfficialProduct(lease,config):null','buildStoreProduct(lease,config):null');
 if(node.id==='verify')node.parameters.jsCode=node.parameters.jsCode.replace('json:verifyOfficialProduct($json,lease,config)','json:verifyStoreProduct($json,lease,config)');
 if(node.id==='token')node.parameters.url='https://www.xlyp.cc/outapi/get_token';
 if(node.id==='create')node.parameters.url='https://www.xlyp.cc/outapi/product';
 if(node.id==='detail')node.parameters.url='={{ "https://www.xlyp.cc/outapi/product/" + $json.candidate_id }}';
 if(['create','detail'].includes(node.id)){
  const headers=node.parameters.headerParameters.parameters;
  headers.push({name:'Authori-zation',value:headers.find(h=>h.name==='Authorization').value});
 }
}
// Verify the same protected middleware before claiming the single create operation.
const authValue='={{ "Bearer " + ($("获取 CRMEB Token").first().json.data?.token || $("获取 CRMEB Token").first().json.token || $("获取 CRMEB Token").first().json.data?.access_token || "") }}';
workflow.nodes.push({id:'authcheck',name:'只读验证多门店授权',type:'n8n-nodes-base.httpRequest',typeVersion:4.2,position:[700,-240],retryOnFail:false,parameters:{method:'GET',url:'={{ "https://www.xlyp.cc/outapi/category/" + $("读取可信任务快照").first().json.product.category_id }}',sendHeaders:true,headerParameters:{parameters:[{name:'Authorization',value:authValue},{name:'Authori-zation',value:authValue}]},options:{redirect:{redirect:{followRedirects:false}},timeout:30000}}});
workflow.connections['获取 CRMEB Token']={main:[[{node:'只读验证多门店授权',type:'main',index:0}]]};
workflow.connections['只读验证多门店授权']={main:[[{node:'配置分类运费并转换字段',type:'main',index:0}]]};
const prepare=workflow.nodes.find(n=>n.id==='prepare');
prepare.parameters.jsCode=prepare.parameters.jsCode.replace('const token=requireStoreToken($json);','const token=requireStoreToken($("获取 CRMEB Token").first().json);\nif(Number($json.status)!==200||Number($json.data?.id)!==lease.product.category_id)throw Error("多门店授权或分类详情检查未通过，未领取创建操作");');
writeFileSync(new URL('workflows/publish-crmeb-store.json',root),JSON.stringify(workflow,null,2)+'\n');
