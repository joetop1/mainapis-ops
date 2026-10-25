import {readFileSync,writeFileSync} from 'node:fs';
const root=new URL('../',import.meta.url),read=name=>readFileSync(new URL(name,root),'utf8');
const clean=source=>source.replace(/^import .*;\n/gm,'').replaceAll('export ','');
const base=clean(read('public/specifications.js'))+'\n'+clean(read('crmeb-official.mjs'));
const store=clean(read('crmeb-store.mjs'));
for(const kind of ['member','store']){
 const isStore=kind==='store',library=base+(isStore?'\n'+store:'');
 const config=isStore?'{categoryMap:{},shippingTemplateId:1}':'{"categoryMap":{"炮机":[116]},"shippingTemplateId":1}';
 const prepare=library+`\nconst config=${config};\nconst lease=$('读取可信任务快照').first().json;\nconst token=${isStore?'requireStoreToken':'requireOfficialToken'}($json);\nconst payload=lease.action==='publish_draft'?${isStore?'buildStoreProduct':'buildOfficialProduct'}(lease,config):null;\nif(lease.action==='verify_draft'&&!/^[1-9][0-9]{0,14}$/.test(lease.candidate_id))throw Error('商品ID无效');\nreturn [{json:{token,payload,config,action:lease.action,candidate_id:lease.candidate_id}}];\n`;
 const verify=library+`\nconst lease=$('读取可信任务快照').first().json;\nconst config=$('配置分类运费并转换字段').first().json.config;\nreturn [{json:${isStore?'verifyStoreProduct':'verifyOfficialProduct'}($json,lease,config)}];\n`;
 writeFileSync(new URL(`workflows/crmeb-${kind}-prepare-template1.js`,root),prepare);
 writeFileSync(new URL(`workflows/crmeb-${kind}-verify.js`,root),verify);
}
