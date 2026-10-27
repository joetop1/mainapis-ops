# 已安装芸众入口的0.2.3修复与原任务恢复

现场只读检查已确认：五张商品表均为BASE TABLE/InnoDB，商品与回执写PDO一致；原任务OPS-0abead4e58e94affab052b6a4bb78ce3查无商品或回执。旧元数据查询依赖配置库名造成误判，改为模型实际写连接的DATABASE()。这修复了一个已验证阻断点，不代表所有创建流程已通过真实验证。

此补丁只替换MainAPIs自有Bridge.php和MainapisOpsController.php，备份也保留.php扩展，不覆盖芸众原文件，不建表，不创建商品。更新器校验安装版本哈希、已审阅商城源码哈希和候选PHP语法；未知文件拒绝覆盖，部分更新可安全再次执行。

## Mac终端上传

```bash
scp /Users/j/Documents/Codex/2026-10-24/new-chat/goods-ops/dist/mainapis-yunzhong-fix-0.2.3.tar.gz root@47.98.177.115:/tmp/
```

## 芸众服务器应用

```bash
mkdir -p /tmp/mainapis-yunzhong-fix-0.2.3
tar -xzf /tmp/mainapis-yunzhong-fix-0.2.3.tar.gz -C /tmp/mainapis-yunzhong-fix-0.2.3
docker cp /tmp/mainapis-yunzhong-fix-0.2.3 shop-asns-cc-runtime:/tmp/mainapis-yunzhong-fix-0.2.3
docker exec shop-asns-cc-runtime php /tmp/mainapis-yunzhong-fix-0.2.3/apply-update.php --apply /var/www/html
```

返回ok:true后，重启容器加载改动。该步骤会使商城短暂不可用；不要同时发布商品。

```bash
docker restart shop-asns-cc-runtime
```

等待启动后测试无签名请求，预期400且X-Mainapis-Bridge:0.2.3：

```bash
curl -sS -i --max-time 15 'https://asns.cc/addons/yun_shop/api.php?i=1&route=mainapis-ops.index'
```

## OPS服务器更新至0.4.3

代码已推送时：

```bash
cd /www/wwwroot/mainapis-ops
git pull --ff-only
docker compose up -d --build
```

刷新OPS，发布任务中找到原任务v6，点击「核对未入库并恢复原任务」。此操作只发签名GET，在商城物理商品表（包含删除状态）和所有本商城应用的回执中检查原任务货号；任何记录存在、不完整响应、旧入口或连接/状态变化都不释放领取锁。

核对通过只把原任务恢复为accepted，并保留原ID、编码和冻结商品内容，不立即写入商城。再点击「重发未领取任务」发送原任务。不要另建同商品的新任务；回执唯一键和原任务标记继续保护重复创建。真正创建后还需完整读取和人工检查SKU、分类、详情、库存与运费。

后续若仍失败，已签名鉴权的调用仅返回预定义诊断码及安全源码位置，不返回原始异常、SQL、凭证或堆栈。未签名调用不获得这些诊断信息。
