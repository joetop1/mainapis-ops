import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
test('系统设置表单预览、保存即时生效、重置图片使用同一配置版本',async()=>{
 const ids=['systemInfoName','systemInfoBrand','systemInfoTitle','systemLoginHeading','systemDescription','systemInfoStatus','systemInfoForm','saveSystemInfo','reloadSystemInfo','systemIconPreview','systemLogoPreview','systemTitlePreview','systemIconFile','systemLogoFile','removeSystemIcon','removeSystemLogo','siteIcon','brandName','brandSystemName','brandMark','brandLogo','loginHeading','loginDescription'];
 const nodes=new Map(ids.map(id=>[id,{id,value:'',textContent:'',disabled:false,events:{},classList:{hidden:false,toggle(_name,v){this.hidden=v;},add(){this.hidden=true;},remove(){this.hidden=false;}},addEventListener(name,fn){this.events[name]=fn;},removeAttribute(name){delete this[name];}}]));nodes.get('systemInfoForm').querySelectorAll=()=>[...nodes.values()];
 const data={revision:4,name:'原系统',brand:'原品牌',title:'旧标签',login_heading:'第一行\n第二行',description:'介绍',icon_url:'/favicon.ico',logo_url:''},calls=[];const document={title:'旧标题',querySelector:()=>({setAttribute(){}})};
 const context=vm.createContext({$:s=>nodes.get(s.slice(1)),me:{systemAdmin:true},document,URL:{revokeObjectURL(){}},api:async(path,method,input)=>{calls.push({path,method,input});return method==='POST'?{...data,...input,revision:5}:data;}});
 vm.runInContext(source.slice(source.indexOf('const systemFields='),source.indexOf('function notificationElement(')),context);
 await context.loadSystemInfo();assert.equal(nodes.get('systemInfoName').value,'原系统');nodes.get('systemInfoTitle').value='新标签';nodes.get('systemInfoTitle').events.input();assert.equal(nodes.get('systemTitlePreview').textContent,'新标签');assert.equal(document.title,'旧标题');
 nodes.get('removeSystemIcon').onclick();assert.equal(nodes.get('systemIconPreview').src,'/default-icon.svg');await nodes.get('systemInfoForm').onsubmit({preventDefault(){}});
 assert.equal(calls.at(-1).input.revision,4);assert.equal(calls.at(-1).input.icon,null);assert.equal(document.title,'新标签');assert.equal(nodes.get('brandSystemName').textContent,'原系统');assert.equal(nodes.get('loginHeading').textContent,'第一行\n第二行');assert.match(nodes.get('systemInfoStatus').textContent,/已保存/);
});
