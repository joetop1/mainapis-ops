# 芸众商城 2.3.700：接入阶段与源码依据

目标 https://asns.cc/outside/1/ 。已完成只读连接配置；未完成商品发布，不能创建商品。

## 已完成

- 管理员在 OPS 连接与配置中输入 app_id / APP_Secret。只发送到固定商城，HTTPS 且拒绝重定向。
- 按提供的 NotifyService.php 排序参数、排除 sign，HMAC-SHA256 小写十六进制；sign_type=SHA256，ver=1。不假设时间戳等源码中不存在的参数。
- 请求 /goods/list?page=1&status=0 测试读取；/goods/category 按 parent_id 和 page 读取各级分类。
- 数据库独立芸众连接表，复用持久化 connections.key 的 AES-GCM。测试不保存，成功后才保存，留空保留同一 APPID 的旧密钥；团队创建时迁移。密钥不返回浏览器。
- 没有商品创建入口和自动创建流程。连接已保存不等于发布适配完成。

## 未完成及依据

提供的 app/outside/modules/goods/controllers/GoodsController.php：

- create 接收基本商品字段、分类 parentid/childid，返回 data.goods_id；thumb_url 使用 PHP serialize 保存。
- good_content 仅在值为数组时逐项作为图片地址拼接 img，文字 description/content/HTML 没有被读取。因此不能把 OPS 的文字和产品参数静默丢弃。
- createOption 单独写规格，委托 backend Goods SpecOptionService::store。需要确认 specs/option 的真实结构和临时 ID 映射，不能猜测或生成不存在的 SKU。
- getOption 可读规格，但 list 的模型字段没有详情内容，需要另寻可核验的读取方式。
- OutsideController 的签名启用条件依赖 sign_required，当前仅始终发送签名，不宣称服务端一定启用了验证。

下一步需要 app/backend/modules/goods 的 PHP 源码，以及 app/frontend/controllers/UploadController.php，确认 SKU 持久化、校验与上传行为。不得因源码不足而反复请求真实新增接口试错。

## 第二份商品源码核对结果

- SpecOptionService 接受 SC 开头规格 ID、SV 开头规格值 ID、SP 开头 SKU ID，服务内部换成数据库真实 ID。option.specs 用下划线连接规格值临时 ID。
- option 字段使用 product_price、cost_price、market_price、stock、goods_sn、thumb，extra_info 的 SKU 详情不等同于商品详情。
- GoodsService::saveGoodsCategory 在 cat_level=3 时读取 thirdid；现有 outside create/update 没有传入 thirdid，不得直接用于三级分类。
- UploadController 使用 multipart 字段 file，返回 data.img（相对地址）和 data.img_url（绝对地址）。文件被排除签名，但 upload_type 等普通参数参与签名。
- 已添加 yunzhong-product.mjs 的两级、图片详情字段映射及测试，未接到真实写入流程。文字详情、参数、品牌标签或三级分类未兼容时显式拒绝，防止静默丢数据。
- 完整接入应使用可独立停用的扩展，补充商品文本/参数、三级分类及完整详情读取；不能修改未知核心保存流程或复用后台 Cookie。
