# CRMEB 发布凭证统一在 OPS 填写

两个商城分别在 OPS「连接与配置 → 商城授权」填写自己的 AppID、AppSecret。服务端向固定商城地址执行鉴权，成功才加密保存；测试不会保存，留空密钥保留已保存值，更换 AppID 必须同时填新密钥。这里仅测试授权，不要求后台品牌接口权限，不需要修改商城源码。

原来单独保存的后台品牌凭证与新发布授权使用同一条加密连接记录，不增加第二套 AppID/AppSecret。成功验证过完整品牌读取的配置仍可沿用；仅授权保存不会自动启用后台品牌读取。修改商城凭证后需重新验证品牌读取，避免旧验证状态失效。

团队使用当前团队的加密配置；创建团队会迁移创建者已有连接。其他团队和个人互相隔离。AppSecret 不会回显浏览器，也不会传到 n8n。Webhook 密钥属于 OPS 到 n8n 发布通道，与商城 AppSecret 功能不同，继续保留。

## 更新 OPS

Mac：

```sh
cd /Users/j/Documents/Codex/2026-10-24/new-chat/goods-ops
git push origin main
```

OPS 服务器：

```sh
cd /www/wwwroot/mainapis-ops
git pull --ff-only
docker compose up -d --build
```

刷新 OPS，在两个商城授权卡片分别填入商城凭证并保存。以后更换 AppID/AppSecret 只在这里操作。

## 现有 n8n 工作流的一次性切换

只修改两个工作流的「获取 CRMEB Token」节点，不替换其他节点或整份工作流：

- Method：POST。
- URL 切换为 Expression：

```js
{{ $("校验请求").first().json.callbackUrl + "/merchant-token" }}
```

- Authentication：None（不再选择商城 Custom Auth）。
- Send Headers：开启，添加 Authorization，值切换为 Expression：

```js
{{ "Bearer " + $("校验请求").first().json.callbackToken }}
```

- Send Body：开启，类型 JSON，Using JSON，内容为固定值 `{}`。
- 保留 Redirects 关闭、Timeout 30000 和 Retry On Fail 关闭。
- 保存并 Publish。节点名称与原连线保留。

`workflows/crmeb-token-from-ops.json` 提供同一个节点的可复制配置用于查看；建议按上述步骤更新原节点，避免产生重名节点。新生成的完整工作流已经采用此设置，不含商城凭证。

这个节点只向 OPS 请求临时 Token。OPS 用任务回调密钥鉴权，根据任务所属个人／团队和目标商城选择加密凭证，再到对应商城换取 Token。返回格式同时包含 data.access_token 和 data.token，兼容现有两个字段转换节点。错误为经过清理的提示，不返回 AppSecret、商城堆栈或原始响应。

只给有可信快照、仍可处理的 CRMEB 任务提供授权。已成功或失败的任务不能再取 Token；其他任务的回调密钥也不能使用。

切换不会创建商品、修改快照或解除创建锁。验证用新发起的未领取任务，或从 OPS 重发未领取原任务；已领取任务需核对，禁止直接执行创建节点。

## 验证范围

本地模拟测试覆盖两商城域名与Token字段、加密保存与掩码、测试不落库、错误凭证不覆盖旧值、团队迁移与权限、跨账号与任务密钥隔离及终态拒绝。没有代替用户连接真实商城写入。线上确认应以商城实际响应和任务核验为准。
