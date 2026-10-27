<?php
// Run only inside the supplied Yunzhong PHP runtime. --check does not alter files or DB.
if (PHP_SAPI!=='cli') {http_response_code(404);exit;}
$mode=$argv[1] ?? '--check';$root=$argv[2] ?? '/var/www/html';
try {
    if (PHP_VERSION_ID<70300) throw new RuntimeException('php_version_requires_7_3_or_newer');
    if (!in_array($mode,['--check','--install','--disable'],true)) throw new RuntimeException('unknown_mode');
    if (!is_file($root.'/artisan') || !is_file($root.'/bootstrap/app.php')) throw new RuntimeException('not_laravel_root');
    $public=null;
    foreach ([$root.'/public',$root] as $candidate) {
        if (is_file($candidate.'/index.php') && strpos(file_get_contents($candidate.'/index.php'),'bootstrap')!==false) {$public=$candidate;break;}
    }
    if (!$public) throw new RuntimeException('document_root_not_identified');
    foreach (['Bridge.php','entry.php','config.php'] as $name) {
        exec(escapeshellarg(PHP_BINARY).' -l '.escapeshellarg(__DIR__.'/'.$name).' 2>&1',$lines,$status);
        if ($status!==0) throw new RuntimeException('php_lint_failed');
    }
    if (is_file($root.'/bootstrap/autoload.php')) require $root.'/bootstrap/autoload.php';else require $root.'/vendor/autoload.php';
    $app=require $root.'/bootstrap/app.php';$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
    foreach (['app\\outside\\services\\NotifyService','app\\outside\\modes\\OutsideAppSetting','app\\backend\\modules\\goods\\models\\Goods','app\\backend\\modules\\goods\\models\\GoodsOption','app\\backend\\modules\\goods\\models\\GoodsSpec','app\\backend\\modules\\goods\\models\\GoodsSpecItem'] as $class) if (!class_exists($class)) throw new RuntimeException('required_class_missing');
    // Exercise the same tenant context used by the standalone entry, with read-only model queries.
    \Setting::$uniqueAccountId = \YunShop::app()->uniacid = 1;
    \app\common\models\AccountWechats::setConfig(\app\common\models\AccountWechats::getAccountByUniacid(1));
    $level=(int)(\Setting::get('shop.category')['cat_level'] ?? 2);
    if (!in_array($level,[2,3],true)) throw new RuntimeException('unsupported_category_level');
    $categoryCount=\app\backend\modules\goods\models\Category::uniacid()->where('enabled',1)->where('plugin_id',0)->count();
    $brandCount=\app\backend\modules\goods\models\Brand::uniacid()->count();
    $goods=new \app\backend\modules\goods\models\Goods();
    foreach (['validator','getRawOriginal','hasManyGoodsCategory'] as $method) if (!method_exists($goods,$method)) throw new RuntimeException('required_goods_method_missing');
    if ($mode==='--check') {echo json_encode(['ok'=>true,'mode'=>'check','entry_directory'=>$public,'php'=>PHP_VERSION,'category_level'=>$level,'category_count'=>$categoryCount,'brand_count'=>$brandCount,'message'=>'只读预检通过，未安装、未建表、未创建商品'],JSON_UNESCAPED_UNICODE).PHP_EOL;exit;}
    $target=$root.'/ops-bridge';
    if ($mode==='--disable') {
        if (!is_dir($target)) throw new RuntimeException('not_installed');
        $written=file_put_contents($target.'/config.php',"<?php\nif (!defined('MAINAPIS_OPS_ENTRY')) {http_response_code(404);exit;}\nreturn ['enabled'=>false,'uniacid'=>1];\n");
        if ($written===false) throw new RuntimeException('disable_failed');
        echo "扩展已停用，商品和任务回执保留。\n";exit;
    }
    if (is_dir($target) || is_file($public.'/ops-bridge.php')) throw new RuntimeException('destination_exists_refusing_overwrite');
    if (!Illuminate\Support\Facades\Schema::hasTable('mainapis_ops_receipts')) Illuminate\Support\Facades\Schema::create('mainapis_ops_receipts',function($table){
        $table->bigIncrements('id');$table->unsignedInteger('uniacid');$table->string('app_id',30);$table->string('marker',36);$table->string('payload_hash',64);$table->unsignedBigInteger('goods_id');$table->timestamp('created_at');$table->unique(['uniacid','app_id','marker'],'mainapis_ops_receipt_unique');
    });
    mkdir($target,0755,true);
    foreach (['Bridge.php','config.php','install.php','entry.php'] as $name) if (!copy(__DIR__.'/'.$name,$target.'/'.$name)) throw new RuntimeException('copy_failed');
    if (!copy(__DIR__.'/entry.php',$public.'/ops-bridge.php')) throw new RuntimeException('entry_copy_failed');
    $written=file_put_contents($target.'/config.php',"<?php\nif (!defined('MAINAPIS_OPS_ENTRY')) {http_response_code(404);exit;}\nreturn ['enabled'=>true,'uniacid'=>1];\n");
    if ($written===false) throw new RuntimeException('activation_failed');
    echo "兼容扩展已安装。请确认网站实际根目录为：".$public."；在OPS测试连接后才可发布。\n";
} catch (Throwable $error) {
    fwrite(STDERR,'扩展预检或安装失败：'.($error instanceof RuntimeException?$error->getMessage():get_class($error))."；请勿重复安装或提交商品。\n");exit(1);
}
