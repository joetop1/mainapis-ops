# Tigshop 自营连接

目标：xiaolango.com，JAVA-B2B2C-OVERSEAS v5.8.60；平台自营，基准币种 EUR。

## 页面操作

进入 OPS「连接与配置 → Tigshop 自营连接」：

1. 填写 Tigshop 后台生成的 API Token。
2. 点击「测试连接并读取模板」。后端只读检查鉴权、分类、品牌、模板。
3. 选择运费模板并保存。测试不会自动保存新 Token，保存前会再次验证。
4. 商品编辑选择 Tigshop，搜索并选择真实分类、品牌，完成审核后发布。

Token 只发送到 OPS 同源后端，使用 AES-256-GCM 加密保存于 SQLite，按运营账号隔离，页面不回显。密钥文件 `/app/data/connections.key` 权限 0600，位于原有持久化数据卷。备份需要同时保留数据库和该密钥文件；文件丢失后需从备份恢复原密钥，否则原连接无法解密。页面留空保存时保留原 Token。

不再需要设置 Tigshop 的 n8n Webhook、凭据或服务器环境变量。旧 `TIGSHOP_API_TOKEN`、`N8N_TIGSHOP_WEBHOOK_URL`、`N8N_TIGSHOP_WEBHOOK_TOKEN` 不再使用，可以移除。CRMEB 仍使用原有连接方式。

## 发布与核对

后端固定访问商城 HTTPS 域名，携带 `X-Api-Token` 和 `X-ADMIN-TYPE: admin`，禁止重定向。没有浏览器直连商城或自由 URL 输入。

- 商品保存为 `shopId=0`、`productStatus=0`。
- 运费设置为 `fixedShippingType=2`、`freeShipping=0`，使用页面选择的模板。
- 发布任务创建时将汇率与模板 ID 保存进不可变快照，人民币原商品不变。
- 汇率取 ECB 最新日参考报价（非实时成交价），允许最多七天以覆盖周末和假日，读取失败阻止发布。EUR = CNY ÷ CNY/EUR，售价与成本保留两位小数。
- 发布前读取模板和同任务货号记录；领取创建操作后最多发送一次新增 POST。
- 创建成功后根据 `productSn=OPS-<任务ID去连字符>` 精确查找，自动读取详情，核验自营、下架、货号、分类品牌、SKU、欧元价格成本、库存及规格图片地址。
- 未找到唯一商品时保留「待核对」，支持页面手工填写商品 ID 进行只读核对。
- 任何创建请求超时或业务报错均保留领取锁，防止已落库却重复创建。错误直接显示在 OPS 任务列表。

目前没有重量体积编辑字段；按重量/体积计费的模板可能要求补充这些参数，商城返回的具体错误会显示在 OPS，不自动猜测数值。

## 从旧 n8n 流程切换

部署后可停用 Tigshop 工作流，保留 CRMEB 工作流。到页面填写 API Token 并保存模板。
已有 **未领取** 任务可以在 OPS「重发未领取任务」，会沿用原任务 ID、汇率和模板，转为后端直连。已领取的任务只可核对，不能重发新增。
任务切换为直连后，后端拒绝旧 n8n 对该任务的领取或结果回调。重启不会自动重发未知创建操作。

## 源码映射

依据本地同版本 ProductController、ProductSaveParam、ProductServiceImpl 及操作者提供的实际响应核对：

- GET `/adminapi/product/product/list`
- GET `/adminapi/product/product/detail?id=...`
- GET `/adminapi/product/product/shippingTplList`
- GET `/adminapi/product/category/getAllCategory`
- GET `/adminapi/product/brand/search`
- POST `/adminapi/product/product/create`

图库 `imgList`，规格图 `attrList.spe[].attrList[].attrPic`，SKU `productList[].attrs[{attrName,attrValue}]`；保存侧 attrs 转为 skuData。新增请求不携带旧 productId、skuId、attributesId、picId。

`workflows/publish-tigshop.json` 为早期 n8n 方案存档，不用于当前直连。

## 原生普通属性（OPS 0.6.8）

参考本地 Java 5.8.32 源码的 ProductSaveParam、ProductAttrsDTO、ProductAttributeDTO、ProductServiceImpl.saveProductAttr 和 ProductAttributesServiceImpl：普通属性 attrList.normal 为按 attrName 分组的 attrList，每项 attrType=0、attrName/attrValue。保存服务合并 extra/spe/normal 后重设 sortOrder，详情按 sortOrder 读回再按名称分组。原规格 attrList.spe 和 productList 不改。

新任务快照设置 tigshop_native_attributes=true，清洗后的产品属性进入 normal，不再拼接至详情。已知 pure.sql 的 attr_value 为 varchar(120)、utf8mb3，保守限制参数值120字，拒绝四字节字符，不截断数据。参数同名不同值合并分组，读回检查名称、值、分组顺序、普通属性类型及数量。旧任务无标记，不要求新增普通属性字段。

只需更新 OPS，无需商城源码或 n8n 变更。历史 n8n JSON 同步生成但仍为存档。165项测试通过，包括直连模拟；本地参考源码版本5.8.32，实际已配置商城版本5.8.60，新字段真实写入仍须单件验收，不据模拟宣称线上成功。已有商品不自动补写，已有任务不重复创建。
