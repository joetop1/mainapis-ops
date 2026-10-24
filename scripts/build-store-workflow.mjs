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
}
writeFileSync(new URL('workflows/publish-crmeb-store.json',root),JSON.stringify(workflow,null,2)+'\n');
