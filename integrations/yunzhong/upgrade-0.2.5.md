# 独立入口0.2.5：查询回执行返回格式兼容

现场SELECT 1通过实际QueryBuilder返回row_type=array、is_array=true、is_object=false。原入口把原始回执行当stdClass读取，创建后的goods_id/uniacid/app_id/marker及重复请求payload_hash读取都会失败。这是本次回执校验错误的已确认类型兼容问题；先前静态填充、getter、读写连接和观察器源代码检查未发现货号直接改写。

0.2.5在原始查询结果边界把关联数组或stdClass规范化为统一对象，并统一列名大小写，不修改字段值。事务内重放检查和完整读回均走此规范化。null仍表示没有回执，不支持的返回格式被拒绝；商城归属、ID、货号和payload_hash校验全部保留。

更新器会在现场PHP中直接测试候选normalizer：数组、对象、大写列名、空结果、错误返回类型，以及真实QueryBuilder的SELECT 1结果。输出receipt_row_check:true、framework_row_type:array后才更新自有文件。该自检没有商品写入。

## Mac上传

```bash
scp /Users/j/Documents/Codex/2026-10-24/new-chat/goods-ops/dist/mainapis-yunzhong-fix-0.2.5.tar.gz root@47.98.177.115:/tmp/
```

## 芸众服务器更新

```bash
mkdir -p /tmp/mainapis-yunzhong-fix-0.2.5
tar -xzf /tmp/mainapis-yunzhong-fix-0.2.5.tar.gz -C /tmp/mainapis-yunzhong-fix-0.2.5
docker cp /tmp/mainapis-yunzhong-fix-0.2.5 shop-asns-cc-runtime:/tmp/mainapis-yunzhong-fix-0.2.5
docker exec shop-asns-cc-runtime php /tmp/mainapis-yunzhong-fix-0.2.5/apply-update.php --apply /var/www/html
```

成功输出需要ok:true、request_context_check:true、receipt_row_check:true。失败时保留输出，运行文件不会在这些自检之前更新。

成功后重启商城容器加载自有代码（短暂中断访问）：

```bash
docker restart shop-asns-cc-runtime
```

启动恢复后，已有OPS0.4.3直接在原任务点击“核对未入库并恢复原任务”，在线确认商品和回执均不存在，再“重发未领取任务”。保持原任务编码，不另建任务。OPS和采集插件无需更新。

安装器同时支持已知0.2.0/0.2.3/0.2.4文件及相同0.2.5文件，未知改动仍拒绝覆盖，商城原文件和表结构均不修改。真实商品写入与完整读回仍需现场验证，修正此类型问题不等于提前确认商品已成功发布。
