# 芸众独立对接入口 0.2.0

对应 OPS 0.4.0、用户提供的芸众 2.3.700 源码。需先在实际 PHP 容器预检，尚未完成真实商城联调。不得用 ShopFW 的通用 SQL 入口替换此包。

## 范围

- 不覆盖任何商城原文件，不改原路由；新增根目录 `ops-bridge/`、实际入口目录 `ops-bridge.php`。
- 安装会新增一张带商城现有表前缀的 `mainapis_ops_receipts` 表，用于任务回执；不改原表结构。
- 仅允许 capabilities、lookup、detail、create；没有 SQL、文件上传、删除或更新已有商品的操作。
- 复用商城1的 API 应用凭证；强制 HMAC-SHA256、5分钟时效，固定商城归属。密钥只保留在原商城和 OPS 加密连接中。
- 正文和参数按纯文本转义生成详情，图片保留原 HTTPS 链接，不抓取或上传远端图片。
- 调用原 CreateGoodsService、模型校验和观察者，支持两级/三级分类。使用独立子类将最终 GoodsCreateEvent 延至规格列表校正之后，原文件不改。
- 对本次新建商品的规格列表按实际关联值重新序列化，规避已审阅 SpecOptionService 的跨维度ID累积问题；不修改历史商品。
- 同任务标记和同内容复用既有回执；不同内容拒绝。回执与商品写入放入同一数据库事务。商城插件事件的外部通知/队列不保证随数据库回滚，因此未知结果仍不自动重试。
- 所有请求核对15个已审阅源码文件的SHA256；商城升级或文件变化即停用请求，必须重新审阅，不能删除检查强行兼容。

## 第一步：上传和预检（不安装、不建表、不创建商品）

从 Mac 上传打好的包到芸众服务器 `/tmp/`；将下面命令中的 `YUNZHONG_SERVER_IP` 换为实际 SSH 公网IP。不是 OPS 服务器。

```bash
cd /Users/j/Documents/Codex/2026-10-24/new-chat/goods-ops
scp dist/mainapis-yunzhong-bridge-0.2.0.tar.gz root@47.98.177.115:/tmp/
```

芸众服务器执行：

```bash
mkdir -p /tmp/mainapis-yunzhong-0.2.0
tar -xzf /tmp/mainapis-yunzhong-bridge-0.2.0.tar.gz -C /tmp/mainapis-yunzhong-0.2.0
docker cp /tmp/mainapis-yunzhong-0.2.0 shop-asns-cc-runtime:/tmp/mainapis-yunzhong-0.2.0
docker exec shop-asns-cc-runtime php /tmp/mainapis-yunzhong-0.2.0/ops-bridge/install.php --check /var/www/html /var/www/html
```

应返回 `ok:true`、实际入口目录和分类层级。source_changed 表示实际源码与已审阅版本不一致，不继续安装；required_class_missing 等错误也须先解决。

## 第二步：预检成功后安装

先保存商城常规备份，然后运行：

```bash
docker exec shop-asns-cc-runtime php /tmp/mainapis-yunzhong-0.2.0/ops-bridge/install.php --install /var/www/html /var/www/html
```

安装器拒绝覆盖已存在入口/目录或回执表，不自动清理已有数据。安装失败后不要反复执行或删除表。

实际网站入口目录根据现有 index.php 判断，需要确认与 OpenResty/Nginx 文档根一致。安装后访问 `https://asns.cc/ops-bridge.php`，无签名请求应返回 HTTP400 JSON。若404、下载源码或出现PHP源码，先停用并检查站点PHP处理配置。

## 第三步：更新 OPS

Mac 推送与 OPS 更新分别执行；芸众PHP容器无需重建。若代码已推送，Mac不用再次推送。

```bash
cd /Users/j/Documents/Codex/2026-10-24/new-chat/goods-ops
git push origin main
```

OPS 服务器：

```bash
cd /www/wwwroot/mainapis-ops
git pull --ff-only
docker compose up -d --build
```

确认0.4.0，进入连接与配置→芸众商城，连接方式选「独立对接入口」，APPID保持原值、Secret留空保留、填写固定运费，先测试、再保存。入口从商城读取实际分类模式，无需改成二级。

## 第四步：真实商品验证

先用一个小测试商品（三级分类、2个规格维度、2个真实组合、正文和基本参数）审核并创建下架商品。到后台核对分类、图片详情、SKU、价格成本、库存和固定运费。OPS 完整读回匹配才记成功；任一字段变化保持待核对，不覆盖旧商品，不自动重发。

这份包只通过本地模拟测试与 PHP 语法解析，并不等于已通过实际PHP、模型、事件插件和数据库的运行验证。

## 停用

独立配置开关可在商城升级后仍执行，不需通过源码兼容检查：

```bash
docker exec shop-asns-cc-runtime php /var/www/html/ops-bridge/install.php --disable /var/www/html
```

只写本入口配置，商品和回执保留。不要删除回执表，否则会丢失重复创建保护。现有官方API连接保留，可用于读取；三级分类仍不能改走原官方创建接口。

## LaravelS/Swoole 部署入口修正（OPS 0.4.1）

现场确认运行容器把所有PHP路径交给Swoole，普通独立PHP文件不会执行；旧 `/ops-bridge.php` 返回404。截图确认 ShopRouteFactory 将 `addons/yun_shop/api.php` 分发给命名空间 app/frontend 的 ShopFrontendRoute。

新增本包自有控制器 `app/frontend/controllers/MainapisOpsController.php`，使用已注册的 API 路径和 `route=mainapis-ops.index`。不修改原控制器、路由、Nginx 或 Composer 配置；不在Swoole工作进程中再次bootstrap Laravel，不调用exit，也不使用全局header输出。签名仍强制校验，固定路由元数据i/route不参加签名，业务参数必须全部签名。

已安装0.2.0的服务器只需补传新的 install.php 与 MainapisOpsController.php 到原临时包目录，执行：

```bash
docker exec shop-asns-cc-runtime php /tmp/mainapis-yunzhong-0.2.0/ops-bridge/install.php --adapt-swoole /var/www/html /var/www/html
```

该步骤检查原扩展和回执表存在，拒绝覆盖不同内容的既有控制器文件；通过现有 ShopFrontendRoute::shopMatch 在CLI验证类和动作分发。只新增本包控制器，不建表，不创建商品。新安装也需在 --install 后执行此步骤。

若返回ok:true，再重启商城容器加载新增类（会短暂中断商城访问）：

```bash
docker restart shop-asns-cc-runtime
curl -sS -i --max-time 15 'https://asns.cc/addons/yun_shop/api.php?i=1&route=mainapis-ops.index'
```

未签名请求预期HTTP400，含响应头 X-Mainapis-Bridge:0.2.1。只有实际HTTP响应证明入口可达，CLI路由校验不替代HTTP联调。

然后更新OPS至0.4.1再测试签名读取，不再使用 /ops-bridge.php。此前前端0.4.0不能使用新的地址；源码已经更新，具体服务器更新命令见第三步。
