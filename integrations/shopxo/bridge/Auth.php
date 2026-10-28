<?php
namespace MainApis\Shopxo;
class Auth
{
    public static function decode($raw,$config)
    {
        if(strlen($raw)>1600000)throw new \RuntimeException('REQUEST_TOO_LARGE');
        $envelope=json_decode($raw,true);
        if(!is_array($envelope) || !is_string($envelope['request'] ?? null) || !is_string($envelope['sign'] ?? null) || !preg_match('/^[a-f0-9]{64}$/D',$envelope['sign']))throw new \RuntimeException('AUTH_FAILED');
        if(!hash_equals(hash_hmac('sha256',$envelope['request'],$config['appsecret']),$envelope['sign']))throw new \RuntimeException('AUTH_FAILED');
        $json=base64_decode($envelope['request'],true);$request=$json===false?null:json_decode($json,true);
        if(!is_array($request) || ($request['appid'] ?? '')!==$config['appid'] || !is_int($request['timestamp'] ?? null) || abs(time()-$request['timestamp'])>300 || !is_string($request['nonce'] ?? null) || !preg_match('/^[a-f0-9]{32}$/D',$request['nonce']))throw new \RuntimeException('AUTH_FAILED');
        if(!in_array($request['op'] ?? '',['capabilities','lookup','create','detail'],true))throw new \RuntimeException('OP_INVALID');
        return $request;
    }
}
