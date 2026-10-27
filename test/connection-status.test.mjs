import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {channelConfiguration as status} from '../public/connection-status.js';
test('CRMEB必须同时有商城授权和发布通道才算已配置；加载失败不误报未配置',()=>{
 for(const target of ['crmeb-pro','crmeb-store']){
  assert.equal(status(target,{}).state,'loading');
  assert.equal(status(target,{auth:{configured:true}}).state,'loading');
  assert.equal(status(target,{auth:{configured:false},publishing:{configured:false}}).state,'unconfigured');
  const authOnly=status(target,{auth:{configured:true},publishing:{configured:false}});assert.equal(authOnly.state,'partial');assert.match(authOnly.detail,/发布通道/);
  const channelOnly=status(target,{auth:{configured:false},publishing:{configured:true}});assert.equal(channelOnly.state,'partial');assert.match(channelOnly.detail,/商城凭证/);
  const saved=status(target,{auth:{configured:true},publishing:{configured:true,source:'environment'}});assert.equal(saved.state,'configured');assert.equal(saved.label,'已配置');
  assert.equal(status(target,{auth:{error:true},publishing:{configured:true}}).state,'error');
 }
});
test('Tigshop同时要求已保存Token和运费模板；三个渠道表单只有一份',()=>{
 assert.equal(status('tigshop',{}).state,'loading');
 assert.equal(status('tigshop',{auth:{configured:false,templateId:0}}).state,'unconfigured');
 assert.equal(status('tigshop',{auth:{configured:true,templateId:0}}).state,'partial');
 assert.equal(status('tigshop',{auth:{configured:true,templateId:51}}).state,'configured');
 assert.equal(status('tigshop',{auth:{error:true}}).state,'error');
 const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
 assert.equal((html.match(/data-channel=/g)||[]).length,3);assert.equal(html.includes('id="connectionCards"'),false);
 const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);assert.equal(ids.length,new Set(ids).size);
 for(const target of ['crmeb-pro','crmeb-store'])for(const kind of ['auth','publishing'])assert.equal((html.match(new RegExp(`data-crmeb-${kind}="${target}"`,'g'))||[]).length,1);
});

import {yunzhongConfiguration} from '../public/connection-status.js';
test('芸众三级分类连接成功与缺少凭证明确区分，保留发布限制',()=>{
 assert.equal(yunzhongConfiguration({configured:false}).state,'unconfigured');
 assert.equal(yunzhongConfiguration({configured:true}).label,'需重新测试');
 const status=yunzhongConfiguration({configured:true,mode:'official',testedAt:'now',categoryLevel:3,publishingReady:false});
 assert.equal(status.state,'readonly');assert.equal(status.label,'已连接 · 暂不支持发布');assert.match(status.detail,/无需重新填写密钥/);
 assert.equal(yunzhongConfiguration({configured:true,mode:'official',testedAt:'now',categoryLevel:2,publishingReady:true}).state,'configured');
});
