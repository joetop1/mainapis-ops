<?php
// MainAPIs OPS compatibility entry v1; install as a separate ops-bridge.php.
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
try {
    if (!in_array($_SERVER['REQUEST_METHOD'] ?? '', ['GET','POST'], true)) throw new \RuntimeException('请求方法无效');
    if ((int)($_SERVER['CONTENT_LENGTH'] ?? 0)>2000000) throw new \RuntimeException('请求过大');
    $root=is_file(__DIR__.'/artisan')?__DIR__:dirname(__DIR__);
    define('MAINAPIS_OPS_ENTRY',true);
    $config=require $root.'/ops-bridge/config.php';
    if (empty($config['enabled'])) throw new \RuntimeException('扩展未启用');
    if (is_file($root.'/bootstrap/autoload.php')) require $root.'/bootstrap/autoload.php';
    else require $root.'/vendor/autoload.php';
    $app=require $root.'/bootstrap/app.php';
    $request=\Illuminate\Http\Request::capture();$app->instance('request',$request);
    $kernel=$app->make(\Illuminate\Contracts\Http\Kernel::class);$kernel->bootstrap();
    require_once $root.'/ops-bridge/Bridge.php';
    if ($request->method()==='POST') {
        if (stripos($request->header('Content-Type',''),'application/json')!==0) throw new \RuntimeException('请使用JSON');
        $input=json_decode($request->getContent(),true,64,JSON_THROW_ON_ERROR);
        if (!is_array($input) || !empty($_GET)) throw new \RuntimeException('请求数据无效');
    } else $input=$_GET;
    $bridge=new \MainApis\OpsBridge\Bridge();$bridge->authorize($input,$config);
    $operation=$input['op'] ?? '';
    if ($request->method()==='GET' && $operation==='capabilities') $data=$bridge->capabilities();
    elseif ($request->method()==='GET' && $operation==='lookup') $data=$bridge->lookup($input['marker'] ?? '');
    elseif ($request->method()==='GET' && $operation==='detail') $data=$bridge->detail($input['marker'] ?? '',$input['goods_id'] ?? '');
    elseif ($request->method()==='POST' && $operation==='create' && is_array($input['product'] ?? null)) $data=$bridge->create($input['product']);
    else throw new \RuntimeException('接口操作无效');
    echo json_encode(['result'=>1,'msg'=>'成功','data'=>$data],JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES);
} catch (\Throwable $error) {
    // No raw framework/database exception, stack, APP_Secret or request data in responses/logs.
    http_response_code(400);
    echo json_encode(['result'=>0,'msg'=>'兼容扩展未完成请求，请检查安装、签名、配置或商品字段；写入失败后须先核对任务编码。','data'=>[]],JSON_UNESCAPED_UNICODE);
}
