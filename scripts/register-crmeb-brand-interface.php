<?php
// Run from the intended CRMEB PHP project root. Registers metadata only; grants no permissions.
$root = getcwd();
if (!is_file($root . '/think') || !is_file($root . '/vendor/autoload.php')) {
    fwrite(STDERR, "请先 cd 到 CRMEB PHP 项目根目录，未修改\n"); exit(1);
}
require $root . '/vendor/autoload.php';
(new \think\App())->initialize();
if (!method_exists(\app\controller\out\Product::class, 'opsBrandList')) {
    fwrite(STDERR, "未找到 opsBrandList，请先安装只读品牌接口，未修改\n"); exit(1);
}
$result = \think\facade\Db::transaction(function () {
    // Serialize registration using the existing category-list row; derive its real parent ID.
    $category = \think\facade\Db::name('out_interface')
        ->where('url', '/category/list')->where('method', 'get')->where('is_del', 0)
        ->lock(true)->find();
    if (!$category || (int)$category['pid'] <= 0) throw new \RuntimeException('未找到商品分类列表的权限分组，未修改');
    $existing = \think\facade\Db::name('out_interface')
        ->where('url', '/brand/list')->where('method', 'get')->select()->toArray();
    if ($existing) {
        if (count($existing) !== 1 || (int)$existing[0]['is_del'] !== 0 || (int)$existing[0]['type'] !== 1) {
            throw new \RuntimeException('品牌接口登记存在冲突，请人工核对，未修改');
        }
        return ['id' => (int)$existing[0]['id'], 'created' => false];
    }
    $id = \think\facade\Db::name('out_interface')->insertGetId([
        'pid' => (int)$category['pid'], 'type' => 1, 'name' => '品牌列表（OPS只读）',
        'describe' => '读取全部设为显示的品牌，包含未关联商品的品牌；只读',
        'method' => 'get', 'url' => '/brand/list', 'request_params' => '[]',
        'return_params' => '[]', 'request_example' => '', 'return_example' => '',
        'error_code' => '[]', 'is_del' => 0
    ]);
    return ['id' => (int)$id, 'created' => true];
});
echo json_encode($result, JSON_UNESCAPED_UNICODE), PHP_EOL;
echo "接口已登记。请刷新商城后台对外接口授权，勾选『品牌列表（OPS只读）』并保存。未修改任何账号的既有权限。", PHP_EOL;
