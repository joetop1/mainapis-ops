# CRMEB Pro 4.3 · OPS 下架入库连接器（待服务器验证）

基于用户提供的 CRMEB_PRO_v4.3.0(20261008) 源码字段编写，复用 `StoreProductServices::saveData()`。仅支持当前内部平台自营实物商品，不支持多门店版、供应商商品、Tigshop、虚拟商品或修改现有商品。

**当前状态：代码已准备，未部署到商城；本机没有 PHP，未通过 PHP 语法和业务执行检查。必须先在服务器检查，通过后再安装。不能仅凭 Node 测试通过认定 PHP 连接器已可用于生产。**

## 本次行为

- 独立入口 `POST https://www.xlupw.com/ops-bridge/import`，默认关闭；认证头为 `X-Ops-Bridge-Token`，是新密钥，不能用 Casdoor 密钥。
- 分类文本精确映射到既有分类 ID；使用明确配置的既有运费模板，不默认设为包邮。
- 1–10 张图片、1–100 个 SKU。首版将“白色 / 小号”这样的组合保留为一个“规格”维度，保持每行 SKU 对应关系；尚未拆分颜色和尺寸维度。SKU 图暂用主图，重量/体积默认为 0，后续在商城检查补齐。
- 只接收 HTTPS 图片，域名精确允许名单，解析公网 IPv4 并固定连接 IP，不跟随重定向，验证 TLS、实际图片类型、8 MB 上限及尺寸；使用商城现有上传驱动转存。详情按纯文本转义，并追加转存图片，不执行或保留传入 HTML。
- 固定下架入库，禁用自动上架，不修改已有来源商品。完成后核对实际商品 ID 和下架状态，再返回成功。
- 任务 ID 和来源同时加非阻塞文件锁，任务记录在商城根目录 `ops_bridge_state/`（不在 public，不应被缓存清理删除）。仅适合单机或共享同一文件锁目录的部署，不支持多机器各自独立存储。
- 同任务同内容成功重放只返回原 ID，不再次保存；保存结果不明时返回非 2xx，停止自动重试，人工核对。已存在同来源的不同任务返回失败，不覆盖。
- SKU 编码仍受商城全局唯一性校验。若与既有商品冲突，进入“需核对”的保守处理，不能反复重试。

## 安装前检查（先做，不改线上）

服务器拉取 OPS 最新源码后，在 OPS 项目目录运行：

```bash
php -v
php -l connectors/crmeb-pro/files/app/services/ops/OpsProductBridge.php
php -l connectors/crmeb-pro/files/route/ops_bridge.php
php connectors/crmeb-pro/test.php
```

若 `php` 不在 PATH，宝塔 PHP 通常位于 `/www/server/php/<版本号>/bin/php`，须使用商城实际运行版本（PHP 8+，扩展 curl、mbstring、JSON、数据库驱动）。测试仅执行 12 个数据映射断言，不连接数据库、不下载图片、不保存商品。

## 安装到商城根目录

先确认商城实际路径（根目录包含 `think`、`app/`、`route/`、`config/`、`public/`）。不要将 PHP 文件上传到 public/admin，不要覆盖原文件。备份商城和数据库。

将以下四个新文件按相同目录放入商城：

```text
files/route/ops_bridge.php                         → route/ops_bridge.php
files/app/services/ops/OpsProductBridge.php        → app/services/ops/OpsProductBridge.php
files/app/services/ops/product-defaults.json       → app/services/ops/product-defaults.json
config.example.php                               → config/ops_bridge.php
```

不需要编辑 `route/admin.php` 或原商品类；本源码的 ThinkPHP 自动加载 route 目录中的 PHP 路由文件。检查新路径与原有文件无冲突。

确保商城 PHP 运行用户（宝塔通常为 www，以实际进程用户为准）可以创建并写入根目录 `ops_bridge_state/`。不要使用 777。任务目录必须持久保存、纳入备份。

编辑商城 `config/ops_bridge.php`：

1. `token`：在服务器用 `openssl rand -hex 32` 生成新密钥；后面填入 n8n 的独立 Header Auth 凭据。
2. `admin_id`：真实平台管理员 ID，用于库存操作记录。
3. `category_map`：例如 OPS 分类文本为“家居 / 收纳”，映射到商城对应真实分类 ID。示例 12/34 不是实际 ID，不能照抄。只配置已确认的分类。
4. `shipping_template_id`：商城真实运费模板 ID。
5. `image_hosts`：默认支持 cbu01–cbu04.alicdn.com。其他图片主机按实际需要精确添加，禁止通配符和内网域名。
6. 最后才将 `enabled` 改为 `true`。

按商城现有运行方式重载配置（Swoole/长驻进程必须重载，PHP-FPM 如有 OPcache 需按现有方式刷新）。不要删除 `ops_bridge_state`。连接器禁用时返回 HTTP 503；密钥错误返回 401。

先用一个新来源、少量图片和 1–2 个 SKU 测试，在商城仓库核对：图片可访问、标题/规格/售价/库存正确、下架状态、来源链接和操作记录。首次测试不应上架。

## n8n 新工作流

导入 `workflows/publish-crmeb-pro.json`，它与原模板使用不同的 Webhook 路径，避免冲突。

1. “接收 CRMEB 发布任务”：选择原有 Header Auth 凭据，Name 是 `X-Ops-Token`。
2. “CRMEB 下架入库”：创建新的 Header Auth 凭据，Name 为 `X-Ops-Bridge-Token`，Value 等于商城配置里的新 token。该节点 URL 固定为 `https://www.xlupw.com/ops-bridge/import`，不要改成 /admin 地址。
3. 工作流保存、发布。OPS `.env` 中 `N8N_WEBHOOK_URL` 改为新 Production URL（路径 `webhook/goods-ops-crmeb-publish`），`N8N_WEBHOOK_TOKEN` 仍是原来的 OPS→n8n 密钥。
4. 重建 OPS 容器加载配置，再从 OPS 选择 CRMEB 会员商城提交测试商品。

新流程不会调用 AI；仅执行经过审核的商品入库。其他两个商城目标暂不支持，请勿选择它们。

商城返回失败且确认尚未保存时，n8n 将 failed 回传 OPS；网络超时或商城 409/503 时，工作流停止，**不会将未知结果当成可安全重试的失败**。OPS 此时可能保持“执行中”，需要先到 n8n Executions 和商城核对。禁止自动重试 HTTP 节点。n8n 与代理 timeout 要允许转存图片；节点默认 90 秒。

## 回滚

先在商城将 `enabled=false` 并重载。OPS 改回原联调模板的 Production URL 并重建。必要时删除上述四个新增文件并重载路由；不要删除任务记录和已经创建的商品。商品删除或上架由管理员在商城后台核对后处理。

## 边界

图片上传不是数据库事务，失败可能留下未引用图片；清理需人工核对，不自动删除。商城原保存服务会触发既有事件，具体事件/队列处理需要在该服务器验证。文件锁不阻止人工或其他插件创建相同来源，因此连接器在事务内再次检查，仍不应同时运行其他来源相同的批量导入。当前未进行真实商城联调。
