import {readFileSync,writeFileSync} from 'node:fs';
const root=new URL('../',import.meta.url),w=JSON.parse(readFileSync(new URL('workflows/publish-crmeb-official.json',root)));
const lib=['tigshop-pricing.mjs','tigshop.mjs'].map(f=>readFileSync(new URL(f,root),'utf8').replace(/^import .*;\n/gm,'').replaceAll('export ','')).join('\n');
w.name='OPS · Tigshop 自营商品入库与核对';
for(const n of w.nodes){
 if(n.id==='webhook'){n.webhookId='ops-tigshop';n.parameters.path='ops-tigshop';}
 if(n.id==='preflight')n.parameters.jsCode=n.parameters.jsCode.replaceAll('crmeb-pro','tigshop').replace('仅支持会员商城官方入库与核对','仅支持 Tigshop 自营入库与核对');
 if(n.id==='token'){
  n.parameters={method:'GET',url:'https://xiaolango.com/adminapi/product/product/shippingTplList',authentication:'genericCredentialType',genericAuthType:'httpHeaderAuth',sendHeaders:true,headerParameters:{parameters:[{name:'X-ADMIN-TYPE',value:'admin'}]},options:{redirect:{redirect:{followRedirects:false}},timeout:30000}};
 }
 if(n.id==='prepare')n.parameters.jsCode=lib+`\nconst lease=$('读取可信任务快照').first().json;\nconst fx=lease.product.tigshop?.fx,shipping=lease.product.tigshop?.shipping;\nif($json.code!==0||!Array.isArray($json.data)||!$json.data.some(t=>t.shippingTplId===shipping?.templateId&&t.shopId===0))throw Error('Tigshop 授权或运费模板检查失败，未领取创建操作');\nconst payload=buildTigshopProduct(lease,fx,shipping);\nif(lease.action==='verify_draft'&&!/^[1-9][0-9]{0,14}$/.test(lease.candidate_id))throw Error('商品ID无效');\nreturn [{json:{payload,action:lease.action,candidate_id:lease.candidate_id}}];`;
 if(['create','detail'].includes(n.id)){
  n.parameters.authentication='genericCredentialType';n.parameters.genericAuthType='httpHeaderAuth';
  n.parameters.headerParameters={parameters:[{name:'X-ADMIN-TYPE',value:'admin'}]};
  n.parameters.url=n.id==='create'?'https://xiaolango.com/adminapi/product/product/create':'={{ "https://xiaolango.com/adminapi/product/product/detail?id=" + $json.candidate_id }}';
 }
 if(n.id==='receipt')n.parameters.jsCode=lib+'\nreturn [{json:tigshopCreateReceipt($json)}];';
 if(n.id==='verify')n.parameters.jsCode=lib+`\nconst lease=$('读取可信任务快照').first().json;return [{json:verifyTigshopProduct($json,lease,lease.product.tigshop.fx,lease.product.tigshop.shipping)}];`;
}
writeFileSync(new URL('workflows/publish-tigshop.json',root),JSON.stringify(w,null,2)+'\n');
