# CRMEB 创建节点异常回传

问题：HTTP 创建节点默认 On Error = Stop Workflow。遇到 502、超时、JSON 格式错误会直接终止，OPS 未收到回传，原任务仍显示“执行中”。这是原有工作流的问题，在个人和团队模式均可模拟复现。

修复现有线上流程时，不要覆盖整份工作流或凭证：

1. 在 Editor 打开“官方新增下架商品” → Settings。保持 Retry On Fail 关闭，将 On Error 改为 Continue（普通输出，不选 using error output）。
2. 将“创建后等待核对ID”代码替换为 `workflows/crmeb-create-receipt.js`。
3. 保留原连接：官方新增下架商品 → 创建后等待核对ID → 回传 OPS 结果。保存、Publish。

失败通过普通输出交给回执代码，回执只产生安全的 unknown 状态，不传回含鉴权信息的原始错误。OPS 保留 claimed=1，不自动重试、不允许再次创建。界面应显示“需核对”，而非永久“执行中”。明确成功仍返回 awaiting_review，必须核对真实商品 ID 后才能计为成功。

新生成的两份工作流也为读取商品详情节点设置 Continue，已有核验代码会将读取失败转换为 awaiting_review。修改线上时可另行设置该节点，不需改变认证头或地址。

本地测试运行了 OPS 路由、加密连接迁移、n8n Code 沙箱及模拟商城返回；没有运行实际 n8n 引擎或真实商城写入。修复错误回传不代表解决了 502 根因，也不会恢复已经中断的执行31。原任务需要独立核对处理。
