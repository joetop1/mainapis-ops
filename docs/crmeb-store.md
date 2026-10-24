# CRMEB 多门店 4.2：连接检查

目标 `https://www.xlyp.cc`，与会员商城 `xlupw.com` 分开配置。用户已确认多门店 POST `/outapi/get_token` 接收 `appid`、`appsecret`，返回 `token`、`exp_time`，之后使用 `Authorization: Bearer token`。

已根据运营者提供的当前服务器路由及 `Product::productSave` 字段实现独立发布适配 `crmeb-store.mjs` 和工作流 `workflows/publish-crmeb-store.json`。仍需配置独立凭据、真实运费模板并完成首件下架商品线上验证。只读检查工作流 `inspect-crmeb-store.json` 可先验证授权。

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


## 正式流程配置（尚待线上联调）

1. Mac 推送仓库，OPS 服务器 `/www/wwwroot/mainapis-ops` 拉取代码。
2. n8n 新建工作流，导入 `workflows/publish-crmeb-store.json`，不要覆盖会员商城工作流。
3. 「接收 OPS 官方接口任务」选择 Header Auth 凭据，Header Name 为 `X-Ops-Token`，Value 自设长随机串；「获取 CRMEB Token」使用多门店独立 Custom Auth 凭据（body: appid/appsecret）。此处 token 路径为 `/outapi/get_token`。
4. 「配置分类运费并转换字段」底部的 config 中将 `shippingTemplateId:0` 改为多门店真实运费模板 ID。不要复制会员商城的 1；默认 0 会在领取创建操作前拒绝请求。分类从 OPS 下拉框保存 ID，不需要名称映射。
5. Publish 后，OPS 服务器的 `.env` 新增：

```ini
N8N_STORE_WEBHOOK_URL=https://n8n.mainapis.com/webhook/ops-crmeb-store
N8N_STORE_WEBHOOK_TOKEN=多门店工作流HeaderAuth的Value
```

6. `docker compose up -d --build`，刷新 OPS。在商品编辑页将「商品资料所属商城」切换为多门店，重新选择该商城分类、品牌，检查 SKU 图价库存，保存并审核，选多门店发布。
7. 先创建一件下架测试商品，获取多门店仓库商品 ID 后在 OPS 填回核验。接口成功不等于核验成功；官方详情适配 `data.productInfo` 或 `data` 形态，实际返回尚待实测。不确定时不重新创建。

仅创建总部平台普通实物商品，不指定某家门店或供应商。控制器没有单规格 attr 参数，适配器将单 SKU 也转为 spec_type=1，空规格使用「默认」，只发送该控制器接收的字段。SKU 图片分别传入 pic。会员商城连接与多门店连接独立，不会把多门店任务发送到会员 Webhook。

目录通过固定目标域名的 `/api/category`、`/api/brand` 只读查询；多门店这两个前台端点尚需线上验证，失败会显示错误，不回退到另一商城的数据。分类品牌为前台可见范围，后台未使用品牌可能不可见。切换商城会清空表单分类、品牌、标签 ID，防止跨商城误用；已创建任务快照保持不变。当前一个商品编辑版本对应一个商城分类资料，可切换并生成新版本；不是同时编辑多个商城的独立草稿。

本地 41 项测试通过，覆盖多门店字段白名单、单 SKU/独立图、独立 Token、分类域名、跨商城拒绝、独立 Webhook、一次领取与核验回调。未向线上商城发起创建或修改。
