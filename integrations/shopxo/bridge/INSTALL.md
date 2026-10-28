# MainAPIs ShopXO 6.9.2 独立扩展 0.1.0

此包用于 PHP-FPM 部署的普通平台商品，不覆盖 ShopXO 原文件或后台入口。适配 ShopXO v6.9.2 官方分支提交 9a0a99fd54be5decc4c8587a5d07bbec7b80d399；预检会核对核心服务源码指纹，版本相同但文件不同也会停止，不能强行跳过。暂不适配多商户店铺、门店独立库存、虚拟商品。PHP CLI 至少 8.0.2，须和网站使用相同扩展及配置。

## 1. 上传

从 OPS“ShopXO → 扩展下载与安装”下载包，通过服务器文件管理或 SCP 上传到商城服务器 /tmp。下列 SHOP_ROOT 必须替换为实际商城根目录，即同时包含 public/core.php、vendor/autoload.php 的目录。不要把后台网址当作文件系统路径。

    mkdir -p /tmp/mainapis-shopxo-0.1.0
    tar -xzf /tmp/mainapis-shopxo-bridge-0.1.0.tar.gz -C /tmp/mainapis-shopxo-0.1.0

## 2. 只读预检

先备份商城。用网站对应的 PHP CLI 执行，php 可以替换为面板中的 PHP 8.0 CLI 完整路径：

    php /tmp/mainapis-shopxo-0.1.0/install.php --check SHOP_ROOT https://你的商城域名

若 Web 实际根目录是 SHOP_ROOT/public，在所有安装器命令末尾再加上 SHOP_ROOT/public 参数；默认 Web 根目录为 SHOP_ROOT。请以网站配置为准。

看到 ok:true 才可继续。此步骤不安装、不建表、不创建商品，检查实际源码、数据库事务引擎和可用仓库。SOURCE_VERSION_MISMATCH 表示实际服务文件与已审核版本不同，请停止并提供诊断码，不要改源码强行适配。

## 3. 安装独立入口

    php /tmp/mainapis-shopxo-0.1.0/install.php --install SHOP_ROOT https://你的商城域名

仅新增 Web实际根目录/mainapis-shopxo.php、SHOP_ROOT/mainapis-shopxo/ 及带实际表前缀的 mainapis_shopxo_receipts / mainapis_shopxo_nonces 表，不修改原商品表结构，也不创建商品。入口读取带保护的配置文件，文件所有者与 runtime 目录一致，需确保 runtime 属于 PHP-FPM 网站用户。

安装失败或部分完成时不要重复安装或删除回执表；保留输出，先核对已有文件/表。当前版本不提供强制覆盖和自动卸载。

## 4. 在服务器本机查看凭据

    php /tmp/mainapis-shopxo-0.1.0/install.php --credentials SHOP_ROOT https://你的商城域名

将应用 ID 和密钥直接填到 OPS 表单，不要发送到聊天、截图或工单。这里的密钥是独立生成的，不是商城管理员密码。

## 5. 测试与发布

在 OPS 选择 ShopXO，填写商城 HTTPS 域名和扩展凭据，测试连接后选择实际仓库并保存。准备一件测试商品，选择该连接的分类和品牌，审核后下架入库。任务将读回商品货号、分类品牌、主图与电脑/手机详情、SKU售价、仓库库存及规格配图。首次务必人工预览。

- 库存调用原生仓库服务写入，不直接修改商品库存字段。
- 采购参考成本保存在原生规格 extends.mainapis.cost 字段，不代表 ShopXO 存在原生成本/利润字段。
- 运费沿用商城设置；虚拟销量不提交。CRMEB 标签尚不映射。
- ShopXO 原生规格图片按维度值保存，无法表示的逐组合配图会在提交前拦截。
- 分类设置了本扩展不支持的必填基础字段或参数模板时，不会伪造数据。
- 原始图片为外链，图片能否持续加载仍需商家检查。
- 创建前保留永久任务回执；发生异常后不自动重复创建。已有商品时填写实际商品ID核对，不重发新任务。

接口为 https://你的商城域名/mainapis-shopxo.php，只接受签名 POST。浏览器直接访问返回400正常；不能代替签名测试。468或其他网关拦截需网站管理员检查独立路径的安全规则，不要全站关闭防护。

## 6. 停用

    php /tmp/mainapis-shopxo-0.1.0/install.php --disable SHOP_ROOT https://你的商城域名

保留已有商品和回执。商城更新或服务源码变化后先重新预检；此版本不自动覆盖更新。

本包已做源码审查和静态语法检查；真实 ShopXO PHP/MySQL 环境须执行上述预检与单件验收，不能将本地测试等同于线上验证。
