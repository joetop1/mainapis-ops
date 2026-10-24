# CRMEB 多门店 4.2：连接检查

目标 `https://www.xlyp.cc`，与会员商城 `xlupw.com` 分开配置。用户已确认多门店 POST `/outapi/get_token` 接收 `appid`、`appsecret`，返回 `token`、`exp_time`，之后使用 `Authorization: Bearer token`。

现阶段只制作只读检查工作流 `workflows/inspect-crmeb-store.json`，尚未接通 OPS 多门店发布。不要复制会员版商品字段后直接试创建：目前没有多门店 4.2 的对应控制器源码、正式字段文档或线上返回可验证版本差异。

## n8n 只读验证

1. 新建工作流，从文件导入 `inspect-crmeb-store.json`。
2. 打开「获取多门店 Token」，新建独立 Custom Auth 凭据，名称可用「CRMEB 多门店接口」。不要选择会员商城现有凭据。
3. Custom Auth 的 JSON：

```json
{"body":{"appid":"多门店接口账号","appsecret":"多门店接口密码"}}
```

4. 点击 Execute workflow。此流程为手动触发，不需要 Publish，不更改 OPS 的现有 Webhook。
5. 最后「连接结果（可截图）」只返回分类概要，不包含 token。不要截图或转发 Token 节点的完整返回值，可能含授权秘密。

Token 接口来自用户提供的当前系统说明。服务器 `/www/wwwroot/xlyp.cc/route/out.php` 已确认分类 `GET /outapi/category/list`、分类详情 `GET /outapi/category/:id`、新增 `POST /outapi/product`、编辑 `PUT /outapi/product/:id`、商品详情 `GET /outapi/product/:id`。旧版官方文档的 `/outapi/product/category` 路径不适用于当前系统，探测模板已修正。若分类返回空数组，不代表商城没有分类，需要核对分类控制器过滤条件。如 Token 节点提示重定向，按站点实际规范域名调整 URL，保持禁止携带凭据自动重定向。

接下来只需读取当前服务器 `app/controller/out/Product.php` 的 `productSave` 与 `productInfo` 方法，核对字段和返回结构；不修改商城程序。

## 后续接入所需证据

确认当前多门店商品新增、详情查询、品牌及运费模板接口及返回结构；明确先创建总部平台商品还是某家门店商品。先以平台普通实物商品、下架、不自动上架进行一件测试，核对 SKU 编码、图片、价格、库存，再确认成功。分类/品牌 ID 属于各自商城，不能复用会员商城 ID。
