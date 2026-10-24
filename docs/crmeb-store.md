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


## 已确认的 410003 鉴权失败修复

当前服务器 AuthTokenMiddleware 读取 `cookie.token_name`，默认值是历史拼写 `Authori-zation`。发布模板、详情查询及只读探测现同时发送 `Authorization` 和 `Authori-zation`，值完全相同。新模板在一次性领取创建之前先 GET 所选分类详情，通过同一鉴权中间件；鉴权失败会停在领取前。

线上已有工作流最小修复：在「官方新增下架商品」「官方读取商品详情」的 Headers 中保留原 Authorization，再增加 Authori-zation，值复制原头表达式，然后 Publish。不改 CRMEB 代码。完整模板额外含只读预检节点，后续更新时保留现有凭据与真实运费模板 ID。

2026-10-24 用户提供的执行 12 返回 410003「请登录」，堆栈明确在 AuthTokenMiddleware 调用 OutAccountServices::parseToken 时失败，尚未进入 Product::productSave。对应任务是 `1bc58a43-d560-43be-bdbb-aed14c025f7a`。为此特定任务提供一次性恢复脚本，非通用解锁工具：

```bash
cd /www/wwwroot/mainapis-ops
git pull --ff-only
docker compose up -d --build
docker compose exec -T goods-ops node recover-store-auth.mjs
```

先修复并发布 n8n 工作流，再执行恢复脚本。脚本核对任务、目标、状态、来源以及尚无核验信息，仅将该任务 claimed 恢复为 0，并写审计；保留同一任务 ID、商品快照及全部商品信息。不调用商城接口。成功后在 OPS 点击该任务「重发未领取任务」。脚本只允许恢复一次，无法用于成功任务、结果不明超时或其他任务。不要单独重新执行官方新增节点。


## 执行 13：缺少 presale_status

用户已核对当前服务源码：`saveData` 从 926 行开始，1022 行读取 `presale_status`；保存事务从 1221 行开始，新商品插入在 1263 行。本次截图的 Undefined array key presale_status 在商品保存前失败。用户已在 `/www/wwwroot/xlyp.cc/app/controller/out/Product.php` 的 productSave 参数列表中补入 `['presale_status', 0]`，并通过 PHP 语法检查。该改动是商城现有对外接口的缺省字段修复，n8n 中仅补字段不足以替代控制器修复。

多门店适配器也明确发送 presale_status=0；现有线上工作流即使尚未更新，控制器默认值仍能处理。为此次已核实的执行 13 提供第二个独立恢复入口：

```bash
cd /www/wwwroot/mainapis-ops
git pull --ff-only
docker compose up -d --build
docker compose exec -T goods-ops node recover-store-presale.mjs
```

需先从 Mac 推送本次提交。此脚本固定该任务 UUID，并核对最新领取时间必须仍为用户提供的 `2026-10-24T14:52:02.259Z`、已有首次鉴权恢复记录、未核验、未成功、未填写商品 ID、商品来源和原提示。后续尝试及其他状态均拒绝；仅一次，不是通用解锁工具。不调用商城，不修改原快照、售价或库存，写入独立审计。完成后在 OPS 对同一任务点击「重发未领取任务」。原 recover-store-auth.mjs 不应再次运行。

本次本地 45 项测试通过；线上补字段后的发布仍待验证。


## slider_image 字段超长

后续新增返回 SQLSTATE[22001]/1406，slider_image 超长。来源商品的完整图片集合不应全塞进轮播列。多门店适配器现限制轮播前 5 张，并按 PHP json_encode 转义后的字符串限制为 1000 字符保守预算；单个首图地址超过预算会在领取创建前拒绝。其余原图仍生成在详情中，SKU 独立图片完整保留。不修改数据库列类型，不删除 OPS 原始图片。

现有 n8n 的「官方新增下架商品」JSON Body 可临时改为返回 `{...payload, slider_image:payload.slider_image.slice(0,5)}`，Publish 后生效，保留详情及 attrs。完整新模板另包含上述长度预算校验。

此错误已进入 SQL 保存阶段，不能沿用前两次保存前失败的恢复脚本。需先查询当前商城是否存在该任务编码商品，核对事务回滚和当前最新执行/领取记录，再决定是否恢复；在证据不足时不解除创建保护。


用户随后在多门店服务器用 ThinkPHP Db 按该任务编码查询，结果为 `[]`，确认当前没有相应商品记录。结合已观察的 SQL 1406 失败及已修改的轮播前 5 张请求，新增专用脚本 `recover-store-carousel.mjs --merchant-empty-confirmed`。仅针对同一固定任务，要求已有 presale 恢复审计且之后只领取过一次、无商品 ID/核验信息、状态与原提示匹配；只可执行一次。不适用于之后的任何新失败。

Mac 推送、OPS 服务器拉取并重建容器后：

```bash
docker compose exec -T goods-ops node recover-store-carousel.mjs --merchant-empty-confirmed
```

该标志只用于已实际查询为无记录的本次情况，不代表脚本会连接另一台商城服务器自行查证。恢复后从 OPS 重发原任务，不能单独执行新增节点。保留全部源图片及 SKU，轮播缩减只发生在发布载荷。48 项本地测试通过。
