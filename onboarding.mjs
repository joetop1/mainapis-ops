// Read-only onboarding: use the same workspace and connection checks as publication.
export function onboardingStatus({team,malls,productCount,publishedCount,billing,storage}){
 const configured=malls.filter(m=>m.configured).length,admin=!team||team.role==='admin';
 const steps=[
  {id:'team',title:'建立团队',done:!!team,page:'team',action:admin?'管理团队':'查看团队',detail:team?'当前团队：'+team.name:'建议先建立团队，再兑换卡密。个人钱包或存储权益不会自动转入团队。'},
  {id:'mall',title:'连接自己的商城',done:configured>0,page:'connections',action:admin?'配置商城':'查看商城',detail:configured?'已保存 '+configured+' 个商城连接；正式发布前仍需测试连接。':admin?'选择商城系统、自定义名称，并保存授权和发布配置。':'请联系团队管理员配置商城。'},
  {id:'product',title:'采集或导入商品',done:productCount>0,page:'products',action:'进入采集箱',detail:productCount?'已有 '+productCount+' 件商品，检查分类、品牌、SKU与图片后审核。':'安装采集插件，或导入供应商货盘；外链图片默认不转存。'},
  {id:'publish',title:'完成首次发布',done:publishedCount>0,page:'jobs',action:'查看发布任务',detail:publishedCount?'已有 '+publishedCount+' 次实际入库核对成功。':'在采集箱审核商品并选择商城发布，实际入库核对通过才记为成功。'}
 ];
 return {workspace:team?team.name:'个人空间',admin,completed:steps.filter(s=>s.done).length,total:steps.length,steps,billing:{enabled:billing.enabled,exempt:!!billing.account.exempt,available:billing.account.available},storage:{active:storage.active,exempt:storage.exempt,expires:storage.expires,limitBytes:storage.limitBytes,storedBytes:storage.storedBytes,reservedBytes:storage.reservedBytes},approvalRequired:true};
}
