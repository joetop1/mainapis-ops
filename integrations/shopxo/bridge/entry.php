<?php
// MainAPIs-owned PHP-FPM entry. Never include this from ShopXO core files.
ini_set('display_errors','0');
header('Content-Type: application/json; charset=utf-8');header('Cache-Control: no-store');header('X-Content-Type-Options: nosniff');header('X-Mainapis-Shopxo: 0.1.0');
try {
    if(($_SERVER['REQUEST_METHOD'] ?? '')!=='POST'||stripos($_SERVER['CONTENT_TYPE'] ?? '','application/json')!==0)throw new RuntimeException('SIGNED_POST_REQUIRED');
    define('MAINAPIS_SHOPXO',true);$root=is_file(__DIR__.'/mainapis-shopxo/config.php')?__DIR__:dirname(__DIR__);$config=require $root.'/mainapis-shopxo/config.php';
    if(empty($config['enabled']))throw new RuntimeException('DISABLED');
    if(strcasecmp($_SERVER['HTTP_HOST'] ?? '',parse_url($config['origin'],PHP_URL_HOST))!==0)throw new RuntimeException('HOST_MISMATCH');
    require_once $root.'/mainapis-shopxo/Auth.php';
    $input=fopen('php://input','rb');$raw=stream_get_contents($input,1600001);fclose($input);
    $request=\MainApis\Shopxo\Auth::decode($raw,$config);
    require_once $root.'/mainapis-shopxo/Compatibility.php';\MainApis\Shopxo\Compatibility::check($root);\MainApis\Shopxo\Compatibility::boot($root,$config['origin'],__DIR__);
    $db=\think\facade\Db::class;
    $db::name('MainapisShopxoNonces')->where('created_at','<',time()-600)->delete();
    try{$db::name('MainapisShopxoNonces')->insert(['nonce'=>$request['nonce'],'created_at'=>time()]);}catch(Throwable $e){throw new RuntimeException('NONCE_REPLAY');}
    require_once $root.'/mainapis-shopxo/Bridge.php';$bridge=new \MainApis\Shopxo\Bridge($config['appid']);
    switch($request['op']){
        case 'capabilities':$data=$bridge->capabilities();break;
        case 'lookup':$data=$bridge->lookup($request['marker'] ?? null);break;
        case 'detail':$data=$bridge->detail($request['marker'] ?? null,$request['goods_id'] ?? null);break;
        case 'create':$data=$bridge->create($request['product'] ?? null);break;
        default:throw new RuntimeException('OP_INVALID');
    }
    echo json_encode(['code'=>0,'data'=>$data],JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES);
}catch(Throwable $e){http_response_code(400);$code=$e instanceof RuntimeException&&preg_match('/^[A-Z_]{1,60}$/D',$e->getMessage())?$e->getMessage():'BRIDGE_EXECUTION_ERROR';echo json_encode(['code'=>-1,'error_code'=>$code,'msg'=>'独立入口请求未确认；创建结果不明时请核对原任务货号，禁止重复创建']);}
