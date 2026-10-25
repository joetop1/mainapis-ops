# CRMEB 完整品牌列表

此前 OPS 使用前台 /api/brand，只包含上架商品使用的品牌。完整品牌读取改为独立、受 outapi Token 保护的 GET /outapi/brand/list，复用 StoreBrandServices::cascaderList(0)，读取未删除且设为显示的完整品牌树。不要求新品牌关联商品；不返回“顶级品牌”虚拟 ID 0。

OPS「连接与配置」有会员商城和多门店两份表单。各自填写该商城原有的对外接口 appid/appsecret，测试后保存。后台加密存储、隔离账号与商城、不回显 AppSecret。发布仍使用现有 n8n 工作流，品牌读取凭据不会修改发布凭据。

已配置的连接读取失败时不退回前台不完整列表。尚未配置者暂时沿用旧来源，界面明确提示其局限性。点击商品编辑页“刷新商城分类与品牌”强制绕过五分钟缓存。品牌层级与完整 ID 路径保持不变。

## 商城补丁

将 scripts/patch-crmeb-brand-readonly.py 上传到每个商城服务器，例如 /root/patch-crmeb-brand-readonly.py。

```
python3 /root/patch-crmeb-brand-readonly.py --root /实际商城PHP根目录
python3 /root/patch-crmeb-brand-readonly.py --root /实际商城PHP根目录 --apply
```

第一条只检查。--apply 会先执行 PHP 语法校验，再备份并写入 app/controller/out/Product.php 与 route/out.php。接口插入到原有 category/list 所在的 Token 授权路由组。重复执行检测到本补丁会直接结束；同名未知方法/路由或缺少原中间件则拒绝修改。

补丁不会变更数据库、商品保存逻辑或写入任何品牌。会员商城 Pro 4.3 的方法已核对本地源码；多门店脚本会先检查相同服务方法是否存在，不满足则停止，需要核对其实际源码。

原文件备份后缀 .bak-ops-brands-时间戳。升级商城后复查接口。回滚时恢复两份对应备份。

节点测试覆盖请求目标、不同鉴权路径、双 Authorization 请求头、全品牌层级、刷新、失败禁止回退，以及凭据和缓存隔离。Python 补丁测试的 lint 调用使用模拟；真实 PHP 语法检查在商城服务器执行。
