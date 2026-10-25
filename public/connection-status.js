// Saved configuration is distinct from a live connection test.
export function channelConfiguration(target,parts){
 const required=target==='tigshop'?['auth']:['auth','publishing'];
 if(required.some(key=>parts[key]?.error))return {state:'error',label:'状态读取失败',detail:'配置可能已保存，请刷新后确认。',ready:true};
 if(required.some(key=>!parts[key]))return {state:'loading',label:'读取中',detail:'正在读取已保存配置…',ready:false};
 const auth=!!parts.auth.configured;
 const publishing=target==='tigshop'?Number(parts.auth.templateId)>0:!!parts.publishing.configured;
 if(auth&&publishing)return {state:'configured',label:'已配置',detail:target==='tigshop'?'API Token 与运费模板已保存':'商城凭证与发布通道已配置',ready:true};
 if(auth||publishing)return {state:'partial',label:'待完善',detail:!auth?'待填写商城凭证':target==='tigshop'?'待选择运费模板':'待配置发布通道',ready:true};
 return {state:'unconfigured',label:'未配置',detail:target==='tigshop'?'填写 API Token 并选择运费模板后开始使用':'填写商城凭证并配置发布通道后开始使用',ready:true};
}
