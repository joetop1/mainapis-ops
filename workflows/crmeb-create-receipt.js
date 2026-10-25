function officialCreateReceipt(response){
  // Even a business error can follow a committed save/event failure. Never release a write for retry.
  if(response?.error||Number(response?.status)!==200)return {status:'unknown',message:'创建请求未返回明确成功（接口错误或响应异常）；请先在商城按任务编码核对，禁止自动重新创建'};
  return {status:'awaiting_review',message:'官方接口已返回成功；请到商城仓库查找该任务编码，填回商品 ID 后核验。此接口不返回 ID，当前尚未计为成功'};
}
return [{json:officialCreateReceipt($json)}];
