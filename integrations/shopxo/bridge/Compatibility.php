<?php
namespace MainApis\Shopxo;
class Compatibility
{
    public static $mismatch=null;
    public static function check($root)
    {
        $manifest=json_decode(file_get_contents(__DIR__.'/reviewed-sources.json'),true);
        foreach($manifest['files'] as $path=>$hash) {
            if(!is_file($root.'/'.$path) || !hash_equals($hash,hash('sha256',str_replace("\r\n","\n",file_get_contents($root.'/'.$path))))){self::$mismatch=$path;throw new \RuntimeException('SOURCE_VERSION_MISMATCH');}
        }
        if(PHP_VERSION_ID<80002)throw new \RuntimeException('PHP_VERSION_UNSUPPORTED');
    }
    public static function boot($root,$origin,$publicRoot=null)
    {
        $host=parse_url($origin,PHP_URL_HOST);
        if(!$host || parse_url($origin,PHP_URL_SCHEME)!=='https')throw new \RuntimeException('ORIGIN_INVALID');
        $_SERVER['HTTP_HOST']=$host;$_SERVER['HTTPS']='on';$_SERVER['SERVER_PORT']=443;$_SERVER['SCRIPT_NAME']='/index.php';
        $_SERVER['HTTP_X_REQUESTED_WITH']='XMLHttpRequest';
        if(($publicRoot===null||$publicRoot===$root)&&!defined('IS_ROOT_ACCESS'))define('IS_ROOT_ACCESS',true);
        require_once $root.'/public/core.php';require_once $root.'/vendor/autoload.php';
        $app=new \think\App($root.'/');$app->initialize();
        if(!defined('APPLICATION_VERSION') || APPLICATION_VERSION!=='v6.9.2')throw new \RuntimeException('VERSION_UNSUPPORTED');
        return $app;
    }
    public static function tables()
    {
        $names=['Goods','GoodsCategoryJoin','GoodsSpecType','GoodsSpecValue','GoodsSpecBase','GoodsPhoto','GoodsContentApp','GoodsParams','Warehouse','WarehouseGoods','WarehouseGoodsSpec'];
        foreach($names as $name) {
            $table=\think\facade\Db::name($name)->getTable();
            $rows=\think\facade\Db::query('SELECT ENGINE AS bridge_engine FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?',[$table]);
            $metadata=isset($rows[0])?array_change_key_case((array)$rows[0],CASE_LOWER):[];
            if(count($rows)!==1 || strcasecmp($metadata['bridge_engine'] ?? '', 'InnoDB')!==0)throw new \RuntimeException('TABLE_ENGINE_UNSUPPORTED');
        }
    }
}
