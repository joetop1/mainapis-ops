# 芸众商城 2.3.700：MainAPIs 独立兼容入口

这是独立兼容扩展，不是芸众应用市场插件。不会覆盖原控制器、路由或 ai-query 插件，不依赖 ai-query 启用状态。标准插件元数据尚未提供，因此使用独立 `ops-bridge.php` 入口复用现有 Laravel 环境，而不猜测插件安装格式。

状态：OPS 的模拟集成测试已通过；PHP 文件尚未在目标运行时执行。必须先完成下面的只读预检，再决定安装。不得将本包视为已在你的生产商城验证通过。

## 文件和数据变化

安装仅新增网站根目录下的 `ops-bridge/`、实际入口目录下的 `ops-bridge.php`，以及一张使用现有数据库前缀的 `mainapis_ops_receipts` 回执表。安装本身不创建商品、不改旧商品、不改已有配置文件。

HTTP 入口固定为 https://asns.cc/ops-bridge.php ，商城ID固定为1。依赖商城已有API应用的APPID和APP_Secret，每个请求都强制HMAC-SHA256校验且核对商城归属，不受旧接口 `sign_required` 的反向判断影响。密钥只保存在原商城和OPS加密连接中，不写入扩展文件。

`capabilities / lookup / detail` 为只读GET，`create`为POST。无更新和删除旧商品接口。只有此APPID、商城ID、任务货号创建的商品可以通过扩展核对。

## 第一步：只读预检（暂不更新OPS）

Mac上传：

```sh
scp /Users/j/Documents/Codex/2026-10-24/new-chat/goods-ops/dist/asns-ops-bridge-0.1.0.tar.gz root@服务器公网IP:/tmp/
```

芸众服务器：

```sh
mkdir -p /tmp/asns-ops-bridge
 tar -xzf /tmp/asns-ops-bridge-0.1.0.tar.gz -C /tmp/asns-ops-bridge
 docker cp /tmp/asns-ops-bridge shop-asns-cc-runtime:/tmp/asns-ops-bridge
 docker exec shop-asns-cc-runtime php /tmp/asns-ops-bridge/ops-bridge/install.php --check /var/www/html
```

预检会在实际PHP环境运行 `php -l`，确认框架和商品模型可用，并报告识别出的入口目录。只读预检不复制到网站、不建表、不安装、不创建商品。报告的目录必须与Nginx实际文档根目录相同；否则先核对站点配置，不要继续安装。

## 第二步：预检确认后安装

先完成网站文件和数据库备份。下面操作只安装扩展；不会创建商品。已有同名文件时安装器拒绝覆盖。

```sh
docker exec shop-asns-cc-runtime php /tmp/asns-ops-bridge/ops-bridge/install.php --install /var/www/html
```

检查 `/ops-bridge.php` 未签名GET应被拒绝，不应显示PHP源码。OPS测试连接时，只有正确签名才能读取真实分类、品牌和能力。若入口404或被Nginx下载为源文件，立即停用入口并检查PHP处理配置，不要提交商品。

## 第三步：更新OPS与连接测试

完成扩展安装确认后再更新OPS。系统版本应为0.3.0。到连接与配置→芸众商城填写数字APPID、APP_Secret和固定运费（元，免运费明确填0），先测试，再保存。

选用一个新采集的测试商品，选择芸众分类品牌，核对售价和库存后审核并发布。此次真实创建应由用户发起，不自动执行。创建同时保存多维SKU、图片和转义的文字详情（包含产品基本信息），默认下架；商品记录和任务回执在同一数据库事务中写入。第一次成功后需人工在商城后台检查实际图片和详情排版。

响应丢失时任务为需核对，不会自动重复创建。按任务货号找到商城商品ID后，使用OPS的“填写商品ID核对”只读验证。已保存回执不允许同任务以不同内容重建。

## 停用

```sh
docker exec shop-asns-cc-runtime php /var/www/html/ops-bridge/install.php --disable /var/www/html
```

停用仅关闭扩展入口，不删除已创建商品或回执表。当前包故意不提供自动删表命令，保留重复创建防护记录。

## 源码兼容说明

复用芸众Goods、GoodsSpec、GoodsSpecItem、GoodsOption及原模型验证/观察者。原SpecOptionService每维度没有重置itemids，扩展改为按源码字段直接创建这些模型，并在每维度重置ID数组；不修改原服务。

独立入口通过Laravel内核bootstrap加载原运行环境，然后设置商城上下文。此路径仍需真实运行时预检与一次人工测试商品验证，尤其是第三方插件观察者行为、数据库事务、类别层级和图片URL转换。
