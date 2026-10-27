<?php
// Updates only the two MainAPIs-owned files. No schema changes or product writes.
if (PHP_SAPI!=='cli') {http_response_code(404);exit;}
$mode=$argv[1] ?? '--check';$root=$argv[2] ?? '/var/www/html';
try {
 if (!in_array($mode,['--check','--apply'],true) || !is_file($root.'/artisan') || !is_file($root.'/ops-bridge/config.php')) throw new RuntimeException('existing_bridge_required');
 require_once __DIR__.'/Compatibility.php';
 \MainApis\OpsBridge\Compatibility::check($root);
 $targets=['Bridge.php'=>'ops-bridge/Bridge.php','MainapisOpsController.php'=>'app/frontend/controllers/MainapisOpsController.php'];
 $reviewed=['Bridge.php'=>'250bb96afe800328aa331ac8e9039c329d3653927dd4f5d93315e5c26b8f5470','MainapisOpsController.php'=>'261ebb9e891ddae7682600f84b03289e1ded34aba1a4a290926727df488a78f4'];
 foreach ($targets as $name=>$relative) {
  $destination=$root.'/'.$relative;$source=__DIR__.'/'.$name;
  if (!is_file($source) || !is_file($destination) || is_link($destination)) throw new RuntimeException('missing_or_linked_owned_file');
  $installed=hash_file('sha256',$destination);$candidate=hash_file('sha256',$source);
  if (!hash_equals($reviewed[$name],$installed) && !hash_equals($candidate,$installed)) throw new RuntimeException('unrecognized_owned_file:'.$name);
  exec(escapeshellarg(PHP_BINARY).' -l '.escapeshellarg($source).' 2>&1',$lines,$status);
  if ($status!==0) throw new RuntimeException('candidate_php_lint_failed');
 }
 if ($mode==='--check') {echo json_encode(['ok'=>true,'mode'=>'check','version'=>'0.2.3','message'=>'更新检查通过，未修改运行文件'],JSON_UNESCAPED_UNICODE).PHP_EOL;exit;}
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
 echo json_encode(['ok'=>true,'mode'=>'apply','version'=>'0.2.3','message'=>'仅更新MainAPIs独立入口文件；未修改商城原文件、表结构或商品。需重载商城容器后验证。'],JSON_UNESCAPED_UNICODE).PHP_EOL;
} catch (Throwable $error) {
 fwrite(STDERR,json_encode(['ok'=>false,'error'=>$error instanceof RuntimeException?$error->getMessage():get_class($error)],JSON_UNESCAPED_UNICODE).PHP_EOL);exit(1);
}
