# 芸众商城独立扩展安装说明

适用：已核验的芸众 2.3.700 源码、PHP 7.3+，商城账号 i=1。安装器按源码指纹预检；其他版本或多商城账号不保证兼容，预检失败请停止。OPS 可填写自己的公网 HTTPS 商城域名，一个团队当前支持一个芸众连接。

此包安装在商城服务器，不是浏览器插件或 OPS 更新包。只新增 MainAPIs 自有文件和任务回执表，不覆盖商城原文件。请先备份商城。压缩包不含 APP_Secret；从商城 API 应用页面取得凭据，只填写在 OPS 连接表单中。

## 1. 下载与上传

登录 OPS，在“连接与配置 → 芸众商城 → 扩展下载与安装”下载完整包。以下占位符须替换：VERSION 为页面版本，SERVER 为商城 SSH 地址，CONTAINER 为实际 PHP 容器名。

在本机终端执行（修改本地文件路径）：

    scp ~/Downloads/mainapis-yunzhong-bridge-VERSION.tar.gz root@SERVER:/tmp/
    ssh root@SERVER

以下均在商城服务器执行。可用 docker ps 查看容器名。SHOP_ROOT 和 DOCUMENT_ROOT 要依据实际商城目录及 Web 服务器配置确定；官方 Docker 常见值均为 /var/www/html，不要直接套用未知目录。

    mkdir -p /tmp/mainapis-yunzhong-VERSION
    tar -xzf /tmp/mainapis-yunzhong-bridge-VERSION.tar.gz -C /tmp/mainapis-yunzhong-VERSION
    docker cp /tmp/mainapis-yunzhong-VERSION CONTAINER:/tmp/mainapis-yunzhong-VERSION

## 2. 首次安装

先执行只读预检：

    docker exec CONTAINER php /tmp/mainapis-yunzhong-VERSION/install.php --check SHOP_ROOT DOCUMENT_ROOT

仅当 ok:true 时执行安装：

    docker exec CONTAINER php /tmp/mainapis-yunzhong-VERSION/install.php --install SHOP_ROOT DOCUMENT_ROOT

Swoole/LaravelS 环境还需新增独立控制器：

    docker exec CONTAINER php /tmp/mainapis-yunzhong-VERSION/install.php --adapt-swoole SHOP_ROOT DOCUMENT_ROOT
    docker restart CONTAINER

重启会短暂中断商城，请安排维护时间。容器启动不等于应用就绪，等待商城恢复后再测试。非 Docker PHP-FPM 部署：将包解压到服务器临时目录，使用商城 PHP CLI 执行相同 install.php 参数（省略 docker exec CONTAINER），并使用自己的进程管理方式重载服务。

## 3. 已安装扩展更新

上传并解压完整包后，先检查，再应用。不要重复运行 --install。

    docker exec CONTAINER php /tmp/mainapis-yunzhong-VERSION/apply-update.php --check SHOP_ROOT
    docker exec CONTAINER php /tmp/mainapis-yunzhong-VERSION/apply-update.php --apply SHOP_ROOT

仅当 ok:true 时重载商城服务。更新器会校验原文件指纹及已知扩展版本、备份自有文件，不改商品数据。未知版本或自检失败请停止，不要强制覆盖。商城官方升级后也要重新预检。

## 4. OPS 验证

填写商城域名，选择“独立对接入口”，填写 APPID、APP_Secret 和运费，点击“测试连接并读取分类”，成功后保存。测试会显示远端扩展版本及最近测试时间。首次用少量商品验证下架入库及主图、详情、规格。已有任务存在商城商品 ID 时只核对该商品，禁止重复创建。

Swoole HTTP 入口： https://你的商城域名/addons/yun_shop/api.php?i=1&route=mainapis-ops.index
未签名访问返回 HTTP 400 是正常的，不能代替 OPS 的签名测试。不要修改 Nginx 为任意 PHP 文件开放执行，也不要修改商城核心路由。

## 5. 停用

    docker exec CONTAINER php /tmp/mainapis-yunzhong-VERSION/install.php --disable SHOP_ROOT

停用保留商品及任务回执。不要删除回执表后重发旧任务。出现错误时记录版本、诊断码、任务编码，勿提交密钥。
