import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {compareVersions} from '../public/collector-version.js';
test('版本按数字比较，兼容补零并拒绝错误数据',()=>{
 assert.equal(compareVersions('0.1.9','0.1.10'),-1);
 assert.equal(compareVersions('1.0','1.0.0'),0);
 assert.equal(compareVersions('0.2.0','0.1.13'),1);
 assert.equal(compareVersions('bad','0.1.13'),null);
});
test('版本桥仅回复同源窗口的查询，不发送账号或其他扩展信息',()=>{
 let listener;const messages=[],window={addEventListener:(type,fn)=>listener=fn,postMessage:(data,origin)=>messages.push({data,origin})};
 vm.runInNewContext(readFileSync(new URL('../extensions/1688-collector/version-bridge.js',import.meta.url),'utf8'),{window,location:{origin:'https://ops.mainapis.com'},chrome:{runtime:{getManifest:()=>({version:'0.1.10',name:'MainAPIs'})}}});
 for(const event of [{source:{},origin:'https://ops.mainapis.com'},{source:window,origin:'https://evil.test'}])listener({...event,data:{type:'mainapis:collector:query',nonce:'123'}});
 assert.equal(messages.length,0);
 listener({source:window,origin:'https://ops.mainapis.com',data:{type:'mainapis:collector:query',nonce:'123'}});
 assert.equal(JSON.stringify(messages),JSON.stringify([{data:{type:'mainapis:collector:version',nonce:'123',version:'0.1.10',channel:'chromium'},origin:'https://ops.mainapis.com'}]));
});
