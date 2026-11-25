# 502 诊断与发布回执

0.26.2 起，每个HTTP响应带 X-Request-ID；服务端 JSON 日志包括 request_finished、request_aborted、request_failed、publication_submit_failed、process_started、process_fatal。请求日志保留路径但不记录查询参数、请求正文、Cookie或授权头。异常文本中的远程URL和常见凭证键会被遮蔽；任意第三方错误仍需按敏感日志管理。process_fatal 使用 uncaughtExceptionMonitor，不阻止 Node 默认的异常退出。

发布POST携带 request_id；各商城任务与 publication_receipts 在同一事务写入。GET /api/products/:id/publish?request_id=... 仅返回当前工作空间、商品、请求下真实已创建的任务，不提供商城创建凭证。

前端网络错误或5xx后最多进行6次只读回执查询，单次5秒超时、间隔2秒。全部商城匹配才恢复正常进度；部分提交、查询失败、空回执保持待核对，不自动再次提交POST。回执表示任务创建，不代表商城发布成功。409仍是冲突，不假报成功。这不是一个允许任意重放的通用幂等POST接口。旧前端不带request_id时仍可发布，但没有精确回执恢复。

发布根因尚未确认。复现时记录发生时间、浏览器HTTP状态和Cloudflare Ray ID，并在服务器读取：

```bash
docker inspect mainapis-ops-goods-ops-1 --format 'restart={{.RestartCount}} started={{.State.StartedAt}} oom={{.State.OOMKilled}}'
docker compose logs --since 15m --tail 200 goods-ops worker
journalctl -u cloudflared --since '15 minutes ago' --no-pager -n 80
```

RestartCount和启动时间需与本次502对应，计划部署重启不能视为崩溃证据。只有请求实际经过nginx时，其upstream错误日志才与本次链路相关。
