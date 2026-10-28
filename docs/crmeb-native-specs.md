# 会员商城原生商品参数（OPS 0.6.6）

依据用户提供的 Pro 4.3 源码：out/Product 接收 specs 和 specs_id；normalizeSpecsData 对每项调用 checkSpecsData 并 JSON 存储。参数白名单 id/temp_id/name/value/sort，名称必填。

仅新会员商城任务快照设置 crmeb_native_specs=true。原生参数从已经清洗的 attributes 映射，id/temp_id=0、specs_id=0，不创建全局模板，sort 按输入顺序递减。旧任务不新增参数核对要求，多门店保持原行为。读回 specs 支持数组或 JSON 字符串；缺失或不一致保留待核对。

更新 OPS 后，新增直连连接使用新适配器。历史 n8n 连接还须更新实际运行工作流的「配置分类运费并转换字段」和「核验实际入库结果」代码。对应文件 workflows/crmeb-member-prepare-template1.js 和 workflows/crmeb-member-verify.js。替换转换代码时，务必保留原节点末尾 const config 的真实分类映射和运费模板 ID，示例模板 ID 1 不代表该商城实际设置。保存并发布工作流。

商城核心文件无需修改。已有已发布商品不自动覆盖；首次用单件新任务验收后台其他设置中的商品参数，尚未进行真实商城写入验收。
