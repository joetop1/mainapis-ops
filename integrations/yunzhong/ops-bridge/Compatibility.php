<?php
namespace MainApis\OpsBridge;
final class Compatibility {
 public static function check($root) {
  $manifest=json_decode(file_get_contents(__DIR__.'/reviewed-sources.json'),true);
  if (!is_array($manifest) || count($manifest)<10) throw new \RuntimeException('source_manifest_missing');
  foreach ($manifest as $path=>$hash) if (!is_file($root.'/'.$path) || !hash_equals($hash,hash_file('sha256',$root.'/'.$path))) throw new \RuntimeException('source_changed:'.$path);
 }
}
