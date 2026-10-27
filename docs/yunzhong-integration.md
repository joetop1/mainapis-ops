# 芸众 2.3.700 官方接口依据与边界

目标站点 https://asns.cc，接口前缀 https://asns.cc/outside/1/。依据用户提供的只读源码审阅；商城源码和配置均不修改。先前兼容入口方案已移除，不再生成或安装商城扩展包。

## 鉴权

数字 app_id、sign_type=SHA256、ver=1。按照 NotifyService 的 PHP 顶层 ksort 排序，排除 sign，数组使用默认 json_encode 的 Unicode 和斜线转义，原始 k=v 连接后以 APP_Secret 做 HMAC-SHA256。金额传字符串。客户端始终签名且禁止重定向；原商城 sign_required 判断存在反向条件，测试成功不能证明服务端强制校验签名。

## 接口

- GET goods/category：逐父类分页读取，拒绝异常父子关系或不完整分页。
- GET goods/list：包含下架商品；按标题搜索并用 OPS 任务货号匹配，分页有限制，超限不视为查无商品。
- POST goods/create：两级分类 category_pid/category_cid；主图 thumb/thumb_url；good_content 仅图片数组；固定运费 dispatch_price；status=0 下架。
- POST goods/createOption：SC/SV/SP 为插入标记；只保存真实 SKU，不产生笛卡尔组合。
- GET goods/getOption：读回规格和 SKU，结合列表核对标题、货号、状态、首图、价格成本、库存及 SKU 数据。

不调用 goods/update，不更改已有商城商品。未使用上传、订单、会员等接口。

## 明确拦截的商品

三级分类、文字详情或产品参数、多维规格、未映射品牌/标签/虚拟销量均在写入前拒绝。三级分类模式可保存为仅连接读取状态。不会为了通过接口而清空、合并或转图片处理原始资料。

依据：GoodsController::create 仅传两级分类，good_content 只在数组时生成图片；SpecOptionService::saveSpec 的 itemids 跨维度累积，未提供可安全修正它的官方请求方式。商城升级后需要重新审阅契约，不能自行假定已修复。

## 结果语义与验证

基础商品和 SKU 非原子写入。OPS 领取锁后不自动重建，先保存已获得的商品 ID；结果不明标为 unknown，后续核对仅发 GET 请求。已有同任务货号时不再次新增或覆盖 SKU。

列表和 getOption 无法读回完整分类、主图组、详情内容，因此无论可见字段是否匹配，都停留 awaiting_review，不自动判 succeeded。

版本0.3.1为本地准备版本。自动测试模拟 PHP 接口响应、鉴权、团队权限、加密保存、分步写入失败及重复发布保护；尚无真实凭证联调或真实商品发布记录。按用户要求暂不更新线上 OPS。

## 三级分类现场确认与进一步核查

用户已在现有商城成功读取「计生 / 人体润滑 / 润滑液」等三级分类，保存返回连接成功。OPS 0.3.2将其显示为「已连接 · 暂不支持发布」，不再误导为缺少配置。

再次审阅 routes/outside.php 和 ShopOutsideRoute：动态分发也只进入 app/outside 命名空间；现有商品创建与更新均仅组装 parentid/childid，不能靠额外传 category_tid 或 thirdid 解决。ai-query/outsides.php只声明工作助手接口，无额外商品创建接口。

backend GoodsController::create调用 CreateGoodsService，属于后台商品创建路径；尚未确认它的完整路由与认证契约，不能把后台端点当成 APPID/APP_Secret 外部API调用。下一步应由芸众提供支持 category thirdid、正文参数和多维规格的官方 API 契约或升级修复；不修改源码，不尝试绕过后台认证。
