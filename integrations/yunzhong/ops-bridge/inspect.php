<?php
// CLI-only, read-only diagnosis. Does not invoke the creation service or any write operation.
if (PHP_SAPI!=='cli') {http_response_code(404);exit;}
$root=$argv[1] ?? '/var/www/html';$marker=$argv[2] ?? '';
try {
    if (!preg_match('/^OPS-[0-9a-f]{32}$/D',$marker)) throw new RuntimeException('invalid_marker');
    if (!is_file($root.'/artisan') || !is_file($root.'/bootstrap/app.php')) throw new RuntimeException('invalid_root');
    if (is_file($root.'/bootstrap/autoload.php')) require $root.'/bootstrap/autoload.php';else require $root.'/vendor/autoload.php';
    $app=require $root.'/bootstrap/app.php';$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
    \Setting::$uniqueAccountId = \YunShop::app()->uniacid = 1;
    \app\common\models\AccountWechats::setConfig(\app\common\models\AccountWechats::getAccountByUniacid(1));
    $connection=Illuminate\Support\Facades\DB::connection();
    $receipts=Illuminate\Support\Facades\DB::table('mainapis_ops_receipts')->where('uniacid',1)->where('marker',$marker)->limit(3)->get(['goods_id']);
    $goods=\app\backend\modules\goods\models\Goods::uniacid()->where('goods_sn',$marker)->limit(3)->get(['id','status']);
    echo json_encode(['marker'=>$marker,'receipt_goods'=>$receipts->toArray(),'matching_goods'=>$goods->toArray()],JSON_UNESCAPED_UNICODE).PHP_EOL;
    $engines=[];
    foreach ([new \app\backend\modules\goods\models\Goods(),new \app\backend\modules\goods\models\GoodsOption(),new \app\backend\modules\goods\models\GoodsSpec(),new \app\backend\modules\goods\models\GoodsSpecItem(),new \app\backend\modules\goods\models\GoodsDispatch()] as $model) {
        $table=$model->getTable();$prefix=$connection->getTablePrefix();$name=$prefix.$table;
        $rows=Illuminate\Support\Facades\DB::select('SELECT ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',[$connection->getDatabaseName(),$name]);
        $engines[]=['model'=>basename(str_replace('\\','/',get_class($model))),'table'=>$table,'prefix'=>$prefix,'engine'=>count($rows)===1?$rows[0]->ENGINE:null];
    }
    echo json_encode(['table_checks'=>$engines],JSON_UNESCAPED_UNICODE).PHP_EOL;
    echo json_encode(['ok'=>true,'readonly'=>true,'message'=>'只读核对完成，未创建或修改商品'],JSON_UNESCAPED_UNICODE).PHP_EOL;
} catch (Throwable $error) {
    // Do not print database exceptions, SQL, connection configuration or credentials.
    fwrite(STDERR,json_encode(['ok'=>false,'readonly'=>true,'error_type'=>get_class($error),'error_file'=>basename($error->getFile()),'error_line'=>$error->getLine()],JSON_UNESCAPED_UNICODE).PHP_EOL);exit(1);
}
