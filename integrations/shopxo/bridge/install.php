<?php
if(PHP_SAPI!=='cli'){http_response_code(404);exit;}
try{
    $mode=$argv[1] ?? '--check';$root=realpath($argv[2] ?? '');$origin=rtrim($argv[3] ?? '', '/');$u=parse_url($origin);
    if(!in_array($mode,['--check','--install','--credentials','--disable'],true)||!$root||!is_file($root.'/public/core.php')||!is_file($root.'/vendor/autoload.php'))throw new RuntimeException('INVALID_MODE_OR_SHOP_ROOT');
    if(!$u||($u['scheme'] ?? '')!=='https'||empty($u['host'])||isset($u['user'])||isset($u['pass'])||isset($u['query'])||isset($u['fragment'])||!empty($u['path'])||(isset($u['port'])&&$u['port']!==443))throw new RuntimeException('HTTPS_ORIGIN_REQUIRED');
    $public=realpath($argv[4] ?? $root);if(!in_array($public,[$root,$root.'/public'],true)||!is_file($public.'/index.php'))throw new RuntimeException('INVALID_DOCUMENT_ROOT');
    require __DIR__.'/Compatibility.php';\MainApis\Shopxo\Compatibility::check($root);
    $target=$root.'/mainapis-shopxo';
    if($mode==='--credentials'||$mode==='--disable'){
        define('MAINAPIS_SHOPXO',true);$config=require $target.'/config.php';
        if($config['origin']!==$origin)throw new RuntimeException('HOST_MISMATCH');
        if($mode==='--credentials'){echo '仅复制到OPS连接表单，勿发送到聊天或工单。'.PHP_EOL;echo json_encode(['url'=>$config['origin'],'appid'=>$config['appid'],'appsecret'=>$config['appsecret']],JSON_UNESCAPED_SLASHES).PHP_EOL;exit;}
        $config['enabled']=false;if(file_put_contents($target.'/config.php',"<?php\nif(!defined('MAINAPIS_SHOPXO')){http_response_code(404);exit;}\nreturn ".var_export($config,true).";\n",LOCK_EX)===false)throw new RuntimeException('DISABLE_FAILED');echo "扩展已停用，商品和回执保留。\n";exit;
    }
    \MainApis\Shopxo\Compatibility::boot($root,$origin,$public);\MainApis\Shopxo\Compatibility::tables();
    $fields=\app\service\GoodsService::GoodsSpecBaseFields();if($fields!==['price','original_price','buy_min_number','buy_max_number','weight','volume','coding','barcode','inventory_unit','extends'])throw new RuntimeException('SPEC_SCHEMA_UNSUPPORTED');
    require_once __DIR__.'/Bridge.php';$probe=new \MainApis\Shopxo\Bridge('preflight');$formMethod=new ReflectionMethod($probe,'form');$formMethod->setAccessible(true);
    $fixture=['title'=>'预检商品','marker'=>'OPS-'.str_repeat('a',32),'category_id'=>1,'brand_id'=>0,'images'=>['https://example.com/a.jpg'],'content_html'=>'<p>预检</p>','detail_images'=>[],'spec_names'=>['颜色','尺寸'],'image_axis'=>0,'skus'=>[['sku'=>'P1','values'=>['红','M'],'price'=>'12.00','cost'=>'2.00','stock'=>3,'image'=>'https://example.com/a.jpg'],['sku'=>'P2','values'=>['蓝','L'],'price'=>'13.00','cost'=>'3.00','stock'=>4,'image'=>'https://example.com/b.jpg']]];
    $form=$formMethod->invoke($probe,$fixture);$parsed=\app\service\GoodsService::GetFormGoodsSpecificationsParams($form);
    if(($parsed['code'] ?? -1)!==0||array_keys($parsed['data']['title'] ?? [])!==$fixture['spec_names']||count($parsed['data']['data'] ?? [])!==2)throw new RuntimeException('SPEC_PARSE_PREFLIGHT_FAILED');
    $warehouses=\think\facade\Db::name('Warehouse')->where('is_enable',1)->where('is_delete_time',0)->field('id,name')->select()->toArray();if(!$warehouses)throw new RuntimeException('NO_ENABLED_WAREHOUSE');
    if($mode==='--check'){echo json_encode(['ok'=>true,'readonly'=>true,'version'=>APPLICATION_VERSION,'php'=>PHP_VERSION,'warehouses'=>$warehouses,'spec_parser_check'=>true,'message'=>'只读预检通过，未安装、未建表、未创建商品'],JSON_UNESCAPED_UNICODE).PHP_EOL;exit;}
    if(file_exists($target)||file_exists($public.'/mainapis-shopxo.php'))throw new RuntimeException('DESTINATION_EXISTS_STOP');
    foreach(['Auth.php','Bridge.php','Compatibility.php','entry.php'] as $name){$out=[];exec(escapeshellarg(PHP_BINARY).' -l '.escapeshellarg(__DIR__.'/'.$name).' 2>&1',$out,$status);if($status!==0)throw new RuntimeException('PHP_SYNTAX_FAILED');}
    $receipts=\think\facade\Db::name('MainapisShopxoReceipts')->getTable();$nonces=\think\facade\Db::name('MainapisShopxoNonces')->getTable();
    foreach([$receipts,$nonces] as $table){if(!preg_match('/^[a-zA-Z0-9_]+$/D',$table))throw new RuntimeException('TABLE_NAME_INVALID');if(\think\facade\Db::query('SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?',[$table]))throw new RuntimeException('OWN_TABLE_EXISTS_STOP');}
    // Only MainAPIs-owned tables are created, never alter the native schema.
    \think\facade\Db::execute("CREATE TABLE `$receipts` (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,app_id VARCHAR(64) NOT NULL,marker VARCHAR(36) NOT NULL,payload_hash CHAR(64) NOT NULL,goods_id BIGINT UNSIGNED NOT NULL DEFAULT 0,warehouse_id BIGINT UNSIGNED NOT NULL,created_at BIGINT NOT NULL,UNIQUE KEY marker_unique(app_id,marker),UNIQUE KEY global_marker(marker)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    \think\facade\Db::execute("CREATE TABLE `$nonces` (nonce CHAR(32) PRIMARY KEY,created_at BIGINT NOT NULL,KEY ttl(created_at)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    if(!mkdir($target,0755))throw new RuntimeException('OWN_DIRECTORY_FAILED');
    foreach(['Auth.php','Bridge.php','Compatibility.php','reviewed-sources.json'] as $name)if(!copy(__DIR__.'/'.$name,$target.'/'.$name))throw new RuntimeException('OWN_COPY_FAILED');
    $config=['enabled'=>true,'origin'=>$origin,'appid'=>'ops_'.bin2hex(random_bytes(8)),'appsecret'=>bin2hex(random_bytes(32))];
    $file=$target.'/config.php';if(file_put_contents($file,"<?php\nif(!defined('MAINAPIS_SHOPXO')){http_response_code(404);exit;}\nreturn ".var_export($config,true).";\n")===false)throw new RuntimeException('OWN_CONFIG_FAILED');chmod($file,0600);
    $uid=fileowner($root.'/runtime');if(fileowner($file)!==$uid&&!chown($file,$uid))throw new RuntimeException('CONFIG_OWNER_FAILED');
    if(!copy(__DIR__.'/entry.php',$public.'/mainapis-shopxo.php'))throw new RuntimeException('ENTRY_COPY_FAILED');
    echo json_encode(['ok'=>true,'version'=>'0.1.0','message'=>'独立扩展已安装，未创建商品；使用 --credentials 在本机查看密钥后填写OPS。'],JSON_UNESCAPED_UNICODE).PHP_EOL;
}catch(Throwable $e){fwrite(STDERR,json_encode(['ok'=>false,'error_code'=>$e instanceof RuntimeException&&preg_match('/^[A-Z_]{1,60}$/D',$e->getMessage())?$e->getMessage():'INSTALL_CHECK_FAILED','source_file'=>class_exists('MainApis\\Shopxo\\Compatibility',false)?\MainApis\Shopxo\Compatibility::$mismatch:null,'error_type'=>get_class($e),'error_file'=>basename($e->getFile()),'error_line'=>$e->getLine(),'message'=>'预检或安装未确认；如已执行安装，请勿重复安装，先保留输出核对。'],JSON_UNESCAPED_UNICODE).PHP_EOL);exit(1);}
