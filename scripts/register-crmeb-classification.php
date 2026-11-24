<?php
// Run from the intended CRMEB PHP project root. Registers metadata only; grants no permissions.
$root = getcwd();
if (!is_file($root . '/think') || !is_file($root . '/vendor/autoload.php')) {
    fwrite(STDERR, "请先 cd 到 CRMEB PHP 项目根目录，未修改\n"); exit(1);
}
require $root . '/vendor/autoload.php';
(new \think\App())->initialize();
if (!method_exists(\app\controller\out\Product::class, 'opsClassificationCatalog')) {
    fwrite(STDERR, "未找到分类整理接口，请先安装专用接口，未修改\n"); exit(1);
}
$definitions = [
    ['get', '/ops-classification/catalog', 'OPS分类标签字典'],
    ['get', '/ops-classification/products', 'OPS现有商品列表'],
    ['get', '/ops-classification/product/{id}', 'OPS现有商品分类详情'],
    ['post', '/ops-classification/product/{id}', 'OPS仅更新商品分类标签']
];
$result = \think\facade\Db::transaction(function () use ($definitions) {
    $category = \think\facade\Db::name('out_interface')->where('url', '/category/list')->where('method', 'get')->where('is_del', 0)->lock(true)->find();
    if (!$category || (int)$category['pid'] <= 0) throw new \RuntimeException('未找到商品权限分组');
    $result = [];
    foreach ($definitions as [$method, $url, $name]) {
        $existing = \think\facade\Db::name('out_interface')->where('url', $url)->where('method', $method)->select()->toArray();
        if ($existing) {
            if (count($existing) !== 1 || (int)$existing[0]['is_del'] !== 0 || (int)$existing[0]['type'] !== 1 || (int)$existing[0]['pid'] !== (int)$category['pid']) throw new \RuntimeException('接口登记冲突');
            $result[] = ['id' => $existing[0]['id'], 'created' => false]; continue;
        }
        $id = \think\facade\Db::name('out_interface')->insertGetId([
            'pid' => (int)$category['pid'], 'type' => 1, 'name' => $name, 'describe' => 'OPS现有商品分类标签整理；不操作价格库存SKU',
            'method' => $method, 'url' => $url, 'request_params' => '[]', 'return_params' => '[]',
            'request_example' => '', 'return_example' => '', 'error_code' => '[]', 'is_del' => 0
        ]);
        $result[] = ['id' => $id, 'created' => true];
    }
    return $result;
});
echo json_encode($result, JSON_UNESCAPED_UNICODE), PHP_EOL;
echo "仅登记4个接口，未授予账号权限。请在商城后台核对后为OPS应用授权。", PHP_EOL;
