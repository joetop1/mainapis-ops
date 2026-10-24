<?php
// Run with the same PHP CLI version/extensions used by the CRMEB site.
require __DIR__ . '/files/app/services/ops/OpsProductBridge.php';
use app\services\ops\OpsProductBridge;

function check($ok, $name) { if (!$ok) throw new RuntimeException('FAIL: ' . $name); echo 'PASS: ' . $name . PHP_EOL; }
function rejects(callable $fn, $name) {try {$fn();} catch (Throwable $e) {check(true, $name); return;} check(false, $name);}
$p = ['source_url' => 'https://detail.1688.com/offer/123.html', 'title' => '测试商品', 'category' => '测试分类',
    'description' => '<script>alert(1)</script>', 'images' => ['https://cbu01.alicdn.com/test.jpg'],
    'skus' => [['sku' => 'SKU-A', 'spec' => '白色 / 小号', 'cost' => 5, 'price' => 10, 'stock' => 3], ['sku' => 'SKU-B', 'spec' => '黑色 / 大号', 'cost' => 6, 'price' => 12, 'stock' => 4]]];
$data = OpsProductBridge::buildPayload($p, ['https://shop.example.com/upload/1.jpg'], [12, 34], 5);
check($data['is_show'] === 0 && $data['auto_on_time'] === 0 && $data['product_type'] === 0, '强制普通实物、下架、禁用自动上架');
check($data['spec_type'] === 1 && count($data['attrs']) === 2 && $data['attrs'][1]['code'] === 'SKU-B', '多 SKU 编码及数量');
check($data['attrs'][0]['detail'] === ['规格' => '白色 / 小号'], '完整保留组合规格为单一规格维度');
check($data['cate_id'] === [12, 34] && $data['freight'] === 3 && $data['temp_id'] === 5, '分类及运费模板映射');
check(strpos($data['description'], '<script>') === false && strpos($data['description'], '&lt;script&gt;') !== false, '详情按纯文本转义');
$one = $p; $one['skus'] = [$p['skus'][0]]; $single = OpsProductBridge::buildPayload($one, ['https://shop.example.com/1.jpg'], [1], 1);
check($single['spec_type'] === 0 && $single['attr']['code'] === 'SKU-A' && $single['attrs'] === [], '单 SKU 使用单规格');
$bad = $p; $bad['skus'][1]['sku'] = 'SKU-A'; rejects(fn() => OpsProductBridge::validateProduct($bad), '重复编码拒绝');
$bad = $p; $bad['skus'][1]['spec'] = '白色 / 小号'; rejects(fn() => OpsProductBridge::validateProduct($bad), '重复规格拒绝');
$bad = $p; $bad['skus'][0]['stock'] = 1.2; rejects(fn() => OpsProductBridge::validateProduct($bad), '非整数库存拒绝');
$bad = $p; $bad['skus'][0]['price'] = 0; rejects(fn() => OpsProductBridge::validateProduct($bad), '零售价拒绝');
$bad = $p; $bad['source_url'] = 'https://detail.1688.com.evil.com/offer/123.html'; rejects(fn() => OpsProductBridge::validateProduct($bad), '伪造来源拒绝');
$bad = $p; $bad['images'] = array_fill(0, 11, $p['images'][0]); rejects(fn() => OpsProductBridge::validateProduct($bad), '超量图片拒绝');
echo 'All 12 payload checks passed. No database or network writes were performed.' . PHP_EOL;
