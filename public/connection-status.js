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

export function yunzhongConfiguration(connection){
 if(connection.error)return {state:'error',label:'状态读取失败',detail:'连接可能已保存，请刷新后重试。'};
 if(!connection.configured)return {state:'unconfigured',label:'未配置',detail:'填写 API 应用凭证后测试并保存连接。'};
 if(connection.mode!=='official')return {state:'partial',label:'需重新测试',detail:'已有凭证保留，请选择商城实际分类模式并测试、保存官方API连接。'};
 if(!connection.testedAt)return {state:'partial',label:'待测试',detail:'凭证已保存，尚未完成官方API连接测试。'};
 if(connection.categoryLevel===3)return {state:'readonly',label:'已连接 · 暂不支持发布',detail:'凭证与分类读取成功。商城使用三级分类，现有官方API不能完整创建三级分类商品，发布已停用；无需重新填写密钥。'};
 if(connection.publishingReady)return {state:'configured',label:'已配置',detail:'官方API连接已保存；支持两级分类、单维规格及图片详情。创建下架草稿后需人工核对。'};
 return {state:'partial',label:'待完善',detail:'请核对商城实际分类模式和固定运费，再测试并保存。'};
}
