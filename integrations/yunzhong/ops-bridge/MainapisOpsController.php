<?php
namespace app\frontend\controllers;

// MainAPIs-owned Swoole adapter 0.2.4. Never bootstrap Laravel again inside a worker.
class MainapisOpsController extends \app\common\components\BaseController
{
    // This isolated endpoint authenticates every operation itself with the scoped API application's HMAC.
    public function preAction() {}

    public function index()
    {
        $authorized=false;
        try {
            $request=request();
            if (!in_array($request->method(),['GET','POST'],true)) throw new \RuntimeException('method_not_allowed');
            if ((string)$request->query('i')!=='1' || $request->query('route')!=='mainapis-ops.index') throw new \RuntimeException('invalid_route');
            $query=$request->query();
            unset($query['i'],$query['route']);
            if ($request->method()==='POST') {
                if ($query || stripos($request->header('Content-Type',''),'application/json')!==0) throw new \RuntimeException('invalid_body');
                $raw=$request->getContent();
                if (strlen($raw)>2000000) throw new \RuntimeException('body_too_large');
                $input=json_decode($raw,true,64,JSON_THROW_ON_ERROR);
            } else $input=$query;
            if (!is_array($input)) throw new \RuntimeException('invalid_input');
            $allowed=['op','app_id','sign_type','ver','sign','timestamp','nonce','marker','goods_id','product'];
            if (array_diff(array_keys($input),$allowed)) throw new \RuntimeException('unexpected_input');
            $root=base_path();
            if (!defined('MAINAPIS_OPS_ENTRY')) define('MAINAPIS_OPS_ENTRY',true);
            $config=require $root.'/ops-bridge/config.php';
            require_once $root.'/ops-bridge/Compatibility.php';
            \MainApis\OpsBridge\Compatibility::check($root);
            require_once $root.'/ops-bridge/Bridge.php';
            $bridge=new \MainApis\OpsBridge\Bridge();$bridge->authorize($input,$config);$authorized=true;
            $op=$input['op'] ?? '';
            if ($request->method()==='GET' && $op==='capabilities') $data=$bridge->capabilities();
            elseif ($request->method()==='GET' && $op==='lookup') $data=$bridge->lookup($input['marker'] ?? '');
            elseif ($request->method()==='GET' && $op==='check_absent') $data=$bridge->checkAbsent($input['marker'] ?? '');
            elseif ($request->method()==='GET' && $op==='detail') $data=$bridge->detail($input['marker'] ?? '',$input['goods_id'] ?? '');
            elseif ($request->method()==='POST' && $op==='create' && is_array($input['product'] ?? null)) $data=$bridge->create($input['product']);
            else throw new \RuntimeException('invalid_operation');
            $body=['result'=>1,'msg'=>'成功','data'=>$data];$status=200;
        } catch (\Throwable $error) {
            $body=['result'=>0,'msg'=>'独立入口已响应；请核对签名、配置或商品字段，创建结果不明时勿重建。','data'=>[]];$status=400;
            if ($authorized) {
                // Only authenticated callers receive fixed diagnostic codes and source location, never raw exceptions or SQL.
                $codes=['未找到商品表的事务元数据，未执行创建'=>'TABLE_METADATA_MISSING','商品表不支持事务'=>'NON_TRANSACTIONAL_TABLE','商品与回执未使用同一写入连接，禁止创建'=>'WRITE_CONNECTION_MISMATCH','商城创建服务校验失败'=>'GOODS_VALIDATION_FAILED'];
                $body['data']=['error_code'=>$codes[$error->getMessage()] ?? 'BRIDGE_EXECUTION_ERROR','error_file'=>basename($error->getFile()),'error_line'=>$error->getLine()];
            }
        }
        return response()->json($body,$status,['Cache-Control'=>'no-store','X-Content-Type-Options'=>'nosniff','X-Mainapis-Bridge'=>'0.2.4']);
    }
}
