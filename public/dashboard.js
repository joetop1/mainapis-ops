export function dashboardCards(page,state,jobView){
 if(page==='jobs'){const s=jobView.summary||{};return [
  {id:'total',label:'任务总数',value:s.total??jobView.total??0,hint:'当前筛选范围内的全部任务'},
  {id:'drafts',label:'执行中',value:s.running??0,hint:'发送中、执行中及核对中'},
  {id:'approved',label:'需核对',value:s.review??0,hint:'含待填写商品ID；失败 '+(s.failed??0)+' 条'},
  {id:'success',label:'发布成功',value:s.succeeded??0,hint:'以商城实际核对结果为准'}
 ];}
 return [
  {id:'total',label:'商品总数',value:state.products.length,hint:'统一管理货源资料'},
  {id:'drafts',label:'待整理',value:state.products.filter(p=>p.status==='draft').length,hint:'完善图片、价格与规格'},
  {id:'approved',label:'审核通过',value:state.products.filter(p=>p.status==='approved').length,hint:'可创建发布任务'},
  {id:'success',label:'发布成功',value:state.job_summary?.succeeded??state.jobs.filter(j=>j.status==='succeeded').length,hint:'当前空间商城核对成功任务数'}
 ];
}
