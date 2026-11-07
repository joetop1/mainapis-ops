import test from 'node:test';
import assert from 'node:assert/strict';
import {actionDialogs} from '../public/action-dialogs.js';
function fixture(){
 const nodes=Object.fromEntries(['actionDialog','actionForm','actionTitle','actionMessage','actionInputLabel','actionInput','actionCancel','actionClose'].map(id=>[id,{value:'',focus(){},setCustomValidity(v){this.invalid=v;},reportValidity(){this.reported=true;},classList:{toggle(){}}}]));
 nodes.actionDialog.showModal=function(){assert.equal(!!this.open,false);this.open=true;};nodes.actionDialog.close=function(){this.open=false;queueMicrotask(()=>this.onclose?.());};
 return {nodes,actions:actionDialogs({$:s=>nodes[s.slice(1)]})};
}
test('确认和输入框统一组件，取消和Esc不提交，多个请求不会被旧close事件取消',async()=>{
 const {nodes,actions}=fixture();const first=actions.confirm('审核商品'),second=actions.prompt('填写ID');await Promise.resolve();assert.equal(nodes.actionMessage.textContent,'审核商品');assert.equal(nodes.actionInput.disabled,true);
 nodes.actionCancel.onclick();assert.equal(await first,false);await Promise.resolve();assert.equal(nodes.actionMessage.textContent,'填写ID');assert.equal(nodes.actionDialog.open,true);assert.equal(nodes.actionInput.disabled,false);
 let prevented=false;nodes.actionDialog.oncancel({preventDefault(){prevented=true;}});assert.equal(await second,null);assert.equal(prevented,true);
 const approved=actions.confirm('确认审核');await Promise.resolve();nodes.actionForm.onsubmit({preventDefault(){}});assert.equal(await approved,true);
});
test('商品ID只允许有效数字，错误输入留在窗口，正确输入才返回',async()=>{
 const {nodes,actions}=fixture();const pending=actions.prompt('ID');await Promise.resolve();nodes.actionInput.value='not-id';nodes.actionForm.onsubmit({preventDefault(){}});assert.equal(nodes.actionInput.reported,true);assert.equal(nodes.actionDialog.open,true);
 nodes.actionInput.value=' 18 ';nodes.actionInput.oninput();nodes.actionForm.onsubmit({preventDefault(){}});assert.equal(await pending,'18');
});
