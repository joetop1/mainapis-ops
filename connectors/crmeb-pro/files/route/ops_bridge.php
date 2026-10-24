<?php
// Additive route; authentication is performed before any business logic.
use think\facade\Route;

Route::post('ops-bridge/import', function (\think\Request $request) {
    return app()->make(\app\services\ops\OpsProductBridge::class)->handle($request);
});
