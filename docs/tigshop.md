# Tigshop 自营对接（源码核对中）

目标 https://xiaolango.com，JAVA-B2B2C-OVERSEAS v5.8.60。
源码核对自本地同版本 ProductController、ProductSaveParam、ProductServiceImpl。

- 鉴权：n8n 独立 Header Auth，X-Api-Token；另加 X-ADMIN-TYPE: admin。
- GET /adminapi/product/product/list：已由操作者实际测试 code=0。
- GET /adminapi/product/product/detail?id=1567：实际响应已验证。
- GET /adminapi/product/category/getAllCategory：分类树。
- GET /adminapi/product/brand/search：品牌选项。
- POST /adminapi/product/product/create：ProductSaveParam。

映射：categoryId、brandId（单品牌）、productName、productSn（OPS 标记）、shopId=0、productStatus=0。
图库 imgList；描述 productDesc / productDescArr。
规格定义 attrList.spe[].attrList[]：attrName / attrValue / attrPic。
SKU productList[]：skuSn / skuStock / skuPrice / costPrice / attrs[{attrName,attrValue}]。
保存侧会将 attrs 转换为 skuData，不能简单照抄详情响应作为创建请求。
新增记录不传已有 productId / skuId / attributesId / picId。
create 返回字符串“商品已添加”，没有商品 ID；必须回查核对才能确认成功。

跨境价格必须确认商城基准币种；OPS 当前价格以人民币记录，不能默认为目标币种或猜测汇率。
连接器、发布工作流和 OPS 路由尚未启用。已有 CRMEB 工作流保持原样。

## 已实现的接入配置

独立工作流：workflows/publish-tigshop.json（保持未发布，导入后再配置凭据）。
三处商城 HTTP 节点（获取 CRMEB Token、官方新增下架商品、官方读取商品详情）选择同一个 Tigshop Header Auth 凭据，头名 X-Api-Token；工作流已带 X-ADMIN-TYPE: admin。
“获取 CRMEB Token”沿用模板节点名称，实际为只读运费模板列表校验，不请求 CRMEB。
Webhook 节点使用独立 Header Auth，建议头名 X-Ops-Token。

OPS 服务器环境变量：

```
N8N_TIGSHOP_WEBHOOK_URL=https://n8n.mainapis.com/webhook/ops-tigshop
N8N_TIGSHOP_WEBHOOK_TOKEN=<独立 webhook 密钥>
TIGSHOP_API_TOKEN=<用于后台读取分类品牌的 API Token>
```

密钥只写服务器 .env / n8n 凭据，不提交 Git。新增后先下架核对。
平台已确认欧元为基准币种。任务创建前读取 ECB 日报价并保存到 job_snapshots 的商品配置中；重试和核对不重新取汇率。报价最多允许七天（兼容周末假日），失败阻止发送。SKU 售价/成本分别换算，两位小数，人民币产品原数据不变。
运费使用真实列表中模板 51（中国大陆），shopId=0；fixedShippingType=2，freeShipping=0。工作流创建前确认模板仍存在。
目前未提供重量体积编辑字段；按重量/体积计费模板可能被商城拒绝，需先补充相关参数，不自动猜测。

上述为本地实现，尚未部署或通过真实创建测试。此前“尚未启用”指远程实例。
