# MainAPIs 商品运营台 · v0.1.0

独立、自部署的内部商品运营后台。Casdoor 认证，SQLite 持久化，n8n 在后台执行商品发布任务。无需 npm 依赖，运行环境 Node.js 22.13+（推荐 Node 22 LTS）。

## 已实现与尚未接通

已实现：Casdoor OIDC 授权码登录（PKCE、state、nonce、RS256 签名校验）、账号允许名单、服务端会话、CSRF、账号数据隔离；1688 来源链接规范化与去重；JSON 商品批量导入；SKU 编辑、审核、版本校验；多商城任务选择；n8n Webhook 派发、回调认证与任务状态；Docker 部署。

尚未实现：直接从 1688 采集资料的插件、AI 整理工作流、三个商城真正写入商品的连接器。添加链接只创建待整理记录，不会自动抓取。任务成功必须由连接器回传真实商城商品 ID。此版本不能当作完整自动铺货系统。

本包不包含 CRMEB 商业源码，不更改任何现有商城、不修改 n8n 授权或登录方式。商城入口来自本次会话，Tigshop 地址尚未提供。跨境币种、分类 ID、运费模板及 SKU 映射由后续连接器处理；当前输入价格按人民币保存。

## 在服务器部署

已确定域名 `ops.mainapis.com`，尚未创建 DNS 或部署。解压到单独目录，例如 `/www/wwwroot/goods-ops`。

```bash
cp .env.example .env
```

编辑 `.env`，填写 Casdoor 应用参数和账号允许名单。不要把密钥发送到聊天或提交到 Git。`APP_ORIGIN` 必须与实际 HTTPS 域名一致。`DEMO_MODE=false`。

```bash
docker compose up -d --build
docker compose logs --tail 50 goods-ops
```

端口仅绑定服务器 `127.0.0.1:3080`。在宝塔创建站点、签发 HTTPS 证书，再参考 `deploy/nginx.conf.example` 反向代理。若端口占用，仅修改 compose 左侧宿主机端口和 Nginx 上游；容器内部维持 3080。

数据库持久化在 Docker 命名卷 `goods_ops_data`。备份前停止应用后复制整个卷，或使用 SQLite backup 工具；不要单独复制正在写入的 sqlite 主文件而漏掉 WAL。不要运行 `docker compose down -v`，否则会删除数据库。

## Casdoor 配置

认证站点为 `https://auth.mainapis.com`。为此后台单独创建应用，复用现有组织和用户，**不要修改 API、Canvas 或 Edu 现有应用**。

1. 启用标准 OIDC 授权码流程，允许 scope `openid profile email`，签名算法选择 RS256。
2. Redirect URL 添加 `https://ops.mainapis.com/auth/callback`，与实际域名严格一致。
3. 复制 Client ID、Client Secret 到 `.env` 中的对应变量。
4. 将获准运营账号的**确切 OIDC sub 值**填入 `ALLOWED_SUBJECTS`，多个用逗号分隔。不是邮箱、显示名或 Client ID。可从 Casdoor 为该应用签发的 ID Token 载荷在本机查看，勿将完整 Token 发给别人。允许名单为空时登录关闭，不会自动允许所有注册用户。

程序从 `CASDOOR_ISSUER/.well-known/openid-configuration` 自动发现端点，严格检查 issuer；若现有 Casdoor 使用应用专属 issuer，应填写其真实 issuer。认证仅开放 RS256；程序不会接受未验签 Token。

“退出”仅销毁此后台的本地会话，不注销整个 Casdoor 账号。用户再次登录可能复用 Casdoor 会话。

## n8n 连接与协议

服务地址已知是 `https://n8n.mainapis.com`，但这**不是 Webhook URL**。在 n8n 建立并激活工作流后，复制其 Production URL 到 `N8N_WEBHOOK_URL`。

Webhook 使用 POST，并启用 Header Auth：头名 `X-Ops-Token`，值与 `.env` 中 `N8N_WEBHOOK_TOKEN` 一致。不要将其暴露到浏览器。没有配置时发布返回 503，任务不会假成功。

请求体示例：

```json
{
  "job_id": "UUID",
  "idempotency_key": "同一个 UUID",
  "action": "publish_draft",
  "target": "crmeb-pro",
  "product_revision": 1,
  "product": {"source_url":"https://detail.1688.com/offer/123.html","title":"商品名","category":"分类","images":[],"description":"纯文本","skus":[]},
  "callback": {"url":"https://ops.mainapis.com/api/callback/任务ID","token":"每任务独立令牌"}
}
```

`target` 可取 `crmeb-pro`、`crmeb-store`、`tigshop`。所有连接器必须强制保存为**下架**，不能直接上架。

推荐工作流：Webhook（Header Auth）→ 按 job_id 持久化去重 → 校验 action/target → 转换商品字段、上传图片 → 使用商城正常服务接口保存 → 回调结果。

回调使用 POST，`Authorization: Bearer <callback.token>`，Content-Type 为 application/json：

```json
{"status":"succeeded","remote_id":"真实商城商品ID","message":"已保存为下架商品"}
```

失败用 `{"status":"failed","message":"可供运营查看的失败原因"}`。只有确认没有产生未记录的商城副作用时才返回 failed；若商品已经创建但后续操作失败，应保留商品 ID 并人工核对，避免重试重复创建。不要回传密钥、Token 或内部堆栈。

相同终态回调可重放；冲突终态返回 409。相同商品版本与目标已有 accepted/succeeded/unknown 任务时拒绝重复提交。请求超时可能已经被 n8n 接收，标记为“需核对”，不会自动重试。可通过原 job_id 继续回调；人工核对 n8n 记录后再决定处理。n8n Webhook 的 2xx 仅代表接收，不能作为商品发布成功。

本包有可导入的 `workflows/publish-contract.json` **失败回传联调模板**：仅检查 action 与 target 并回传“连接器未配置”的 failed，用于测试全链路和授权。导入后必须设置 Webhook 的 Header Auth 凭据并激活，默认未激活；它不会创建商城商品。真正连接器尚需实现。

## 本地体验

```bash
DEMO_MODE=true APP_ORIGIN=http://127.0.0.1:3080 node server.mjs
```

打开 `http://127.0.0.1:3080`，点登录进入本机演示。演示模式只监听 127.0.0.1，禁止 n8n 派发与外部回调，但可真实保存、编辑、导入和审核本机数据。不要将演示模式通过反向代理公开。

导入 `sample-products.json` 可体验格式；示例无真实图片，无法审核通过，需要补充真实商品资料。界面最多展示 1000 件商品、最近 300 条任务；大量使用时需增加分页、角色与后台工作队列。

## 校验

```bash
npm test
node --check server.mjs
node --check public/app.js
```

自动测试覆盖 OIDC 签名/过期/接收者/nonce、来源验证、SKU 校验、允许去重约束，以及 HTTP 登录、CSRF、商品创建与审核、过时版本拦截、未配置发布关闭。已通过 9 项自动测试（请求处理链路使用内存请求/响应，不依赖监听端口）。当前执行环境禁止监听本地端口，因此未启动预览、未执行真实 HTTP 网络与浏览器视觉验收；未与线上 Casdoor、n8n、三个商城联调，未执行 Docker 镜像构建。
