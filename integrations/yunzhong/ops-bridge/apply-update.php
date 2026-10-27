<?php
// Updates only the two MainAPIs-owned files. No schema changes or product writes.
if (PHP_SAPI!=='cli') {http_response_code(404);exit;}
$mode=$argv[1] ?? '--check';$root=$argv[2] ?? '/var/www/html';
try {
 if (!in_array($mode,['--check','--apply'],true) || !is_file($root.'/artisan') || !is_file($root.'/ops-bridge/config.php')) throw new RuntimeException('existing_bridge_required');
 require_once __DIR__.'/Compatibility.php';
 \MainApis\OpsBridge\Compatibility::check($root);
 $targets=['Bridge.php'=>'ops-bridge/Bridge.php','MainapisOpsController.php'=>'app/frontend/controllers/MainapisOpsController.php'];
 $reviewed=['Bridge.php'=>['250bb96afe800328aa331ac8e9039c329d3653927dd4f5d93315e5c26b8f5470','ea42479dfb1fb1d0db528e02a4a29d3cc4bcbc9c123d25cc2b28f94cbf9fd81e'],'MainapisOpsController.php'=>['261ebb9e891ddae7682600f84b03289e1ded34aba1a4a290926727df488a78f4','81e3fa8fc08a5beeee28fadb3d2eee4235a0c528c5d23a98bb0a63ad3ca8d878']];
 foreach ($targets as $name=>$relative) {
  $destination=$root.'/'.$relative;$source=__DIR__.'/'.$name;
  if (!is_file($source) || !is_file($destination) || is_link($destination)) throw new RuntimeException('missing_or_linked_owned_file');
  $installed=hash_file('sha256',$destination);$candidate=hash_file('sha256',$source);
  if (!in_array($installed,$reviewed[$name],true) && !hash_equals($candidate,$installed)) throw new RuntimeException('unrecognized_owned_file:'.$name);
  exec(escapeshellarg(PHP_BINARY).' -l '.escapeshellarg($source).' 2>&1',$lines,$status);
  if ($status!==0) throw new RuntimeException('candidate_php_lint_failed');
 }
 // Verify request replacement and finally restoration using the actual installed framework, without creating models.
 if (is_file($root.'/bootstrap/autoload.php')) require $root.'/bootstrap/autoload.php';else require $root.'/vendor/autoload.php';
 $app=require $root.'/bootstrap/app.php';$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
 $previous=$app->make('request');
 $probe=Illuminate\Http\Request::create('/','POST',[],[],[],['CONTENT_TYPE'=>'application/json'],json_encode(['op'=>'mainapis-probe','nonce'=>'probe']));
 $app->instance('request',$probe);Illuminate\Support\Facades\Facade::clearResolvedInstance('request');
 try {
  $json=clone $probe->json();$form=clone $probe->request;
  try {
   $probe->replace(['goods'=>['goods_sn'=>'OPS-probe'],'widgets'=>['option'=>['has_option'=>1]]]);
   if (request()->input('goods.goods_sn')!=='OPS-probe' || $probe->goods['goods_sn']!=='OPS-probe') throw new RuntimeException('request_context_probe_failed');
   throw new RuntimeException('expected_mainapis_probe');
  } catch (RuntimeException $expected) {
   if ($expected->getMessage()!=='expected_mainapis_probe') throw $expected;
  } finally {$probe->setJson($json);$probe->request=$form;}
  if (request()->input('op')!=='mainapis-probe' || request()->input('goods')!==null) throw new RuntimeException('request_restore_probe_failed');
 } finally {$app->instance('request',$previous);Illuminate\Support\Facades\Facade::clearResolvedInstance('request');}
 if ($mode==='--check') {echo json_encode(['ok'=>true,'mode'=>'check','version'=>'0.2.4','request_context_check'=>true,'message'=>'更新检查通过，未修改运行文件'],JSON_UNESCAPED_UNICODE).PHP_EOL;exit;}
 foreach ($targets as $name=>$relative) {
  $destination=$root.'/'.$relative;
  if (hash_equals(hash_file('sha256',$destination),hash_file('sha256',__DIR__.'/'.$name))) continue;
  $backup=$root.'/ops-bridge/'.str_replace('.php','.backup-'.date('YmdHis').'-'.bin2hex(random_bytes(3)).'.php',$name);
  if (!copy($destination,$backup)) throw new RuntimeException('owned_backup_failed');
  $temp=tempnam(dirname($destination),'.mainapis-update-');
  if ($temp===false || file_put_contents($temp,file_get_contents(__DIR__.'/'.$name),LOCK_EX)===false) throw new RuntimeException('owned_file_write_failed');
  chmod($temp,0644);
  if (!rename($temp,$destination)) throw new RuntimeException('owned_file_replace_failed');
 }
 echo json_encode(['ok'=>true,'mode'=>'apply','version'=>'0.2.4','request_context_check'=>true,'message'=>'仅更新MainAPIs独立入口文件；未修改商城原文件、表结构或商品。需重载商城容器后验证。'],JSON_UNESCAPED_UNICODE).PHP_EOL;
} catch (Throwable $error) {
 fwrite(STDERR,json_encode(['ok'=>false,'error'=>$error instanceof RuntimeException && in_array($error->getFile(),[__FILE__,__DIR__.'/Compatibility.php'],true)?$error->getMessage():get_class($error)],JSON_UNESCAPED_UNICODE).PHP_EOL);exit(1);
}
