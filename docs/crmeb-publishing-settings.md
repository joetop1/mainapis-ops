# CRMEB 发布连接前端配置

OPS「连接与配置」分别提供会员商城和多门店的商品发布连接。填写生产 Webhook 地址与对应 Header Auth 的 X-Ops-Token Value，测试后保存。此处不是 AppID/AppSecret，也不是 Tigshop API Token。

服务器保存的凭据按运营账号和商城隔离，AES-GCM 加密，复用持久化密钥文件。浏览器不回显密钥；留空保留当前有效配置。页面保存值优先于旧环境变量，未保存的账号继续使用旧环境变量。保存发布连接不会修改品牌凭据，保存品牌凭据也不会覆盖发布连接。

固定生产地址：

- 会员：https://n8n.mainapis.com/webhook/ops-crmeb-official
- 多门店：https://n8n.mainapis.com/webhook/ops-crmeb-store

测试只发送 action=ops_connection_test，不含商品、任务 ID 或回调凭据，标准工作流在校验请求节点拒绝，不会创建商品。因为 Webhook 立即响应，入口返回 2xx 只证明入口接收和鉴权，不代表工作流或商城保存成功。n8n 中可能出现测试校验失败记录。401/403、404、重定向和超时在页面分别显示。测试不会自动保存。

更新此功能不需要修改商城源码，不需要变更既有 n8n 流程。Webhook 的 Header Auth Value 必须与页面填写的值相同；如果原密钥已经遗失，需要在该 n8n 入口凭据设置一次新值，并在页面填同一个值。OPS 无权自动读取或修改 n8n 内部凭据。

保存成功后，从任务列表重发原来的未领取任务。领取锁和任务快照保持原样，已领取创建操作仍不可重发。
