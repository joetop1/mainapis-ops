# 已安装站点的0.2.4适配修正

现场确认：原任务无商品或回执；goods_sn允许批量填充，内存原始值和getter都保留标记，读取PDO与写PDO相同。Common Goods全局作用域读取当前商城上下文；实际GoodsObserverBase的saved事件读取request()->input()。

这些证据不证明某一个观察器改写了货号，也不能断言原204行的唯一成因。已发现的适配问题是：独立入口给创建服务传临时Request，但保存事件仍读取外层签名请求。0.2.4将同一个当前请求对象临时替换为goods/widgets业务参数，finally恢复原JSON和表单，适配服务和事件的输入契约。

读回使用回执的固定商城ID、实际写连接和商品ID，不依赖可变商城全局作用域；回执归属与原始/读取货号仍须严格匹配。缺少商品、标记改变、已删除等失败分开抛出，位置可以区分具体分支。没有跳过核验或将不匹配标记为成功。

更新器先在真实Laravel环境用内存请求验证服务和request()助手读取相同参数，并模拟异常确保finally恢复原始签名数据；不调用创建服务、不保存模型。该自检成功才更新两个自有文件，保留备份，不改原商城源码、路由或表结构。支持已知0.2.0/0.2.3及相同0.2.4文件，未知编辑版本拒绝覆盖。

## Mac终端

```bash
scp /Users/j/Documents/Codex/2026-10-24/new-chat/goods-ops/dist/mainapis-yunzhong-fix-0.2.4.tar.gz root@47.98.177.115:/tmp/
```

## 芸众服务器

```bash
mkdir -p /tmp/mainapis-yunzhong-fix-0.2.4
tar -xzf /tmp/mainapis-yunzhong-fix-0.2.4.tar.gz -C /tmp/mainapis-yunzhong-fix-0.2.4
docker cp /tmp/mainapis-yunzhong-fix-0.2.4 shop-asns-cc-runtime:/tmp/mainapis-yunzhong-fix-0.2.4
docker exec shop-asns-cc-runtime php /tmp/mainapis-yunzhong-fix-0.2.4/apply-update.php --apply /var/www/html
```

需要返回ok:true及request_context_check:true。失败则保留输出，不继续重启或发布。

成功后重启容器加载自有文件更新（会短暂中断商城）：

```bash
docker restart shop-asns-cc-runtime
```

待启动后无签名入口应返回400及X-Mainapis-Bridge:0.2.4：

```bash
curl -sS -i --max-time 15 'https://asns.cc/addons/yun_shop/api.php?i=1&route=mainapis-ops.index'
```

OPS0.4.3可以继续使用，不需要更新OPS或采集插件。原任务先点“核对未入库并恢复原任务”，通过后重发同一冻结任务，仍不能另建任务或跳过远程查重。

本地现有135项Node模拟测试通过，PHP语法解析通过。真实Laravel请求自检和商品写入结果均待现场验证，不能将此修改提前描述为发布已成功。
