# MainAPIs Safari 采集助手 0.1.15（待真机验收）

此包是 Safari Web Extension 资源包，不是可以直接安装的 IPA。需使用自己的 Apple Developer 账号签名、构建后，通过 TestFlight 安装。桌面 Chrome/Edge 采集插件保持原样。

## 通过苹果后台构建

1. 登录 https://appstoreconnect.apple.com/ ，在「我的 App」新建 iOS App（覆盖 iPad）。建议名称 MainAPIs Collector，SKU mainapis-collector；Bundle ID 使用自己账号下注册的唯一标识，例如 com.mainapis.collector。
2. 进入 App 的 Xcode Cloud 页面，找到 Safari Web Extension Packager，上传 safari-collector.zip。manifest.json 已位于 ZIP 根目录。
3. 按苹果提示补充图标、签名和构建信息，处理成功后在 TestFlight 选择构建。此资源包没有代填签名、隐私声明或完成审核。
4. 团队成员需要测试邀请；外部测试可能需苹果 Beta 审核。不要把所有团队成员都加成开发者后台管理员。

若后台没有打包入口，可在安装完整 Xcode 的 Mac 运行以下命令（二选一，取决于 Xcode 版本）：

```sh
xcrun safari-web-extension-packager /绝对路径/safari-collector --ios-only --copy-resources --app-name 'MainAPIs Collector' --bundle-identifier com.mainapis.collector
# 老版本命令名：
xcrun safari-web-extension-converter /绝对路径/safari-collector --ios-only --copy-resources --app-name 'MainAPIs Collector' --bundle-identifier com.mainapis.collector
```

打开生成的工程，在宿主 App 和扩展的 Signing & Capabilities 中选择自己的 Team，按 Xcode 的兼容性提示处理后 Archive，再 Distribute App → App Store Connect。资源转换成功不代表真机功能测试通过。

## iPad 使用和验收

1. 通过 TestFlight 安装后，在系统「设置 → App → Safari → 扩展」（旧系统可能为「设置 → Safari → 扩展」）启用采集助手，允许访问 detail.1688.com 和 ops.mainapis.com。
2. 使用 Safari 登录 OPS，确认团队空间正确；保留 OPS 首页标签页。商城 AppID/AppSecret 仍只保存在 OPS，不填写到扩展中。
3. Safari 打开 https://detail.1688.com/offer/商品编号.html 。若跳到手机页或 App，选择请求桌面网站并返回该商品地址。
4. 滚动到商品详情等待图片加载，从 Safari 扩展菜单打开采集助手，点击「读取当前商品」。检查标题、主图、详情图、SKU 数量、多维规格及配图。
5. 核对后点击确认导入。若提示打开 OPS，完成登录和站点授权后回到商品页重开扩展，草稿会恢复。
6. 在 OPS 待整理采集箱检查实际导入结果，再设置分类、售价和库存。采集助手不会自动发布商品。

上线前需真机检查：两维规格商品、缺详情图商品、刷新/关闭弹窗后草稿恢复、登录过期、编辑者导入与空间归属、重复来源拦截、拒绝站点权限的提示、JSON 下载备用。不要用主图或 SKU 配图补充缺失的详情图。

当前复用了 0.1.9 的采集器与 OPS 登录和 CSRF 校验；适配了 browser/chrome API 入口、触控尺寸与窄屏布局，移除了商品 554 临时修图入口。仍使用 scripting MAIN world 读取页面商品状态，具体系统版本兼容性和下载行为需要 Safari 真机确认。此包未经苹果签名或 TestFlight 真机测试。

## 重新生成

在仓库根目录运行：

```sh
node scripts/build-safari-collector.mjs
```

只打包固定公开资源文件和图标，不包含账号密码、Cookie、数据库或服务器配置。

0.1.14：采集产品基本信息，过滤下游平台、销售地区和出口专供等供货信息；OPS 0.2.2 支持参数编辑及随详情发布。

0.1.15：加入淘宝桌面商品页读取和OPS淘宝来源支持；需重新生成并安装Safari扩展，允许访问item.taobao.com。新增资源taobao.js和source-url.js须随包安装。本版本仍需iPad真机验收。
