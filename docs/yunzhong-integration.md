# 芸众 2.3.700 接口依据与两种连接方式

目标站点 https://asns.cc。OPS 0.4.0保留现有官方API模式，并增加经用户授权的独立入口0.2.0。独立入口新增自身文件与回执表，不覆盖商城原文件。以下先说明原官方API的边界，独立入口实现及安装见本文末段与 integrations/yunzhong/README.md。

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

原官方模式保留只读/受限创建行为。当前独立入口尚无真实PHP环境联调或真实商品发布记录，自动化测试仅模拟接口响应。

## 三级分类现场确认与进一步核查

用户已在现有商城成功读取「计生 / 人体润滑 / 润滑液」等三级分类，保存返回连接成功。OPS 0.3.2将其显示为「已连接 · 暂不支持发布」，不再误导为缺少配置。

再次审阅 routes/outside.php 和 ShopOutsideRoute：动态分发也只进入 app/outside 命名空间；现有商品创建与更新均仅组装 parentid/childid，不能靠额外传 category_tid 或 thirdid 解决。ai-query/outsides.php只声明工作助手接口，无额外商品创建接口。

backend GoodsController::create调用 CreateGoodsService，属于后台商品创建路径；尚未确认它的完整路由与认证契约，不能把后台端点当成 APPID/APP_Secret 外部API调用。下一步应由芸众提供支持 category thirdid、正文参数和多维规格的官方 API 契约或升级修复；不修改源码，不尝试绕过后台认证。

## 用户授权的独立入口方案（0.4.0）

用户提供的 ShopFW PHP 明确将请求数据交给 PDO query/exec 执行。用户随后同意开发独立且固定操作的入口，更新了先前「任何商城新增文件都不部署」的范围；仍不覆盖商城原有源码。旧官方接口模式保留，不自动切换。

实现和安装检查见 integrations/yunzhong/README.md。独立入口0.2.0使用新的契约 mainapis-yunzhong-2，带时效签名，15个源文件逐请求核对；旧0.1.0草稿不兼容、不接受。创建走原服务，三级分类以后台服务所需 category 二维数组传递，文字参数放正文，多维规格完成后修正仅新商品的序列化维度列表。读回额外核对固定运费、基础金额和总库存。

真实PHP运行验证尚未完成；先做容器 --check，再安装、验证签名读取，最后人工核对一个下架测试商品。不得将本地模拟通过描述为真实商城发布成功。

## Swoole 现场入口适配（OPS 0.4.1）

安装预检已在真实PHP8.3.31容器通过，读取分类11、品牌579；安装回执表和自有文件成功。旧独立PHP URL在Swoole部署返回404，尚未创建任何真实商品。

现场Nginx所有php路径均反代5200的LaravelS；ShopRouteFactory截图确认前台API路径转ShopFrontendRoute，命名空间app/frontend。新控制器加入app/frontend/controllers，不改任何原文件；通过CLI真实shopMatch检查后仍必须验证HTTP请求命中。OPS地址改为 /addons/yun_shop/api.php?i=1&route=mainapis-ops.index。详见安装说明末段，不继续猜测独立脚本可执行。

## 首次创建400与事务元数据检查修正

任务OPS-0abead4e58e94affab052b6a4bb78ce3的现场只读检查未发现回执或同货号商品；五个商品模型的旧元数据查询均返回engine:null。尚不能仅据此认定完整400链路的唯一原因，也不能认定商品表不支持事务。

旧代码依赖默认连接配置中的database名称。修正为在各模型实际写PDO会话中用DATABASE()查询，并使用明确的小写别名，检查元数据是否唯一、表类型和InnoDB；商品模型与回执的写PDO必须相同，否则拒绝创建。只读检查增加metadata_found、table_type和same_write_connection供现场验证。真实环境结果未返回前，不恢复任务或发送新增请求。

## 现场确认与受控恢复（0.2.3／OPS0.4.3）

更新的只读检查已在实际容器返回五张表metadata_found=1、InnoDB、BASE TABLE、same_write_connection=true；原任务商品和回执仍为空。

新增签名GET check_absent，以物理表查询包含删除商品及同商城全部appid回执。恢复接口只支持本工作空间的独立入口直连、claimed且unknown、无候选ID/核对nonce、收到HTTP400的任务；入口必须支持safe_absence_check，并严格返回原marker、absent=true和两个零计数。响应期间连接和任务快照/更新时间变化会中止；本地事务把原任务改为accepted、claimed=0，不创建商品或新任务。正常重发仍用冻结快照与原任务标记。编辑角色不能恢复。

本地自动测试覆盖空记录恢复、商品/回执存在、错误或缺失证明、跨团队、旧扩展、状态与连接变化及诊断信息过滤。真实商品创建仍待部署补丁后验证。
