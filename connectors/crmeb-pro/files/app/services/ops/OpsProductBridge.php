<?php
declare(strict_types=1);

namespace app\services\ops;

use app\services\product\product\StoreProductServices;
use app\services\product\sku\StoreProductAttrServices;
use crmeb\services\UploadService;
use think\facade\Db;

/** Internal create-only adapter for the inspected CRMEB Pro 4.3 schema. */
class OpsProductBridge
{
    public function handle(\think\Request $request)
    {
        $cfg = config('ops_bridge', []);
        $token = (string)($cfg['token'] ?? '');
        if (empty($cfg['enabled']) || strlen($token) < 32) {
            return json(['error' => 'OPS bridge disabled'], 503);
        }
        if (!hash_equals($token, (string)$request->header('X-Ops-Bridge-Token', ''))) {
            return json(['error' => 'Unauthorized'], 401);
        }
        $raw = $request->getContent();
        if (strlen($raw) > 2 * 1024 * 1024) return json(['error' => 'Payload too large'], 413);
        try {
            $b = json_decode($raw, true, 64, JSON_THROW_ON_ERROR);
            if (!is_array($b) || ($b['action'] ?? '') !== 'publish_draft' || ($b['target'] ?? '') !== 'crmeb-pro') throw new \RuntimeException('只接受 CRMEB 会员商城下架入库任务');
            $job = (string)($b['job_id'] ?? '');
            if (!preg_match('/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/D', $job)) throw new \RuntimeException('任务 ID 无效');
            $p = $b['product'] ?? null;
            self::validateProduct($p);
            $hash = hash('sha256', json_encode($p, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
            $dir = app()->getRootPath() . 'ops_bridge_state/';
            if (!is_dir($dir) && !mkdir($dir, 0700, true) && !is_dir($dir)) throw new \RuntimeException('无法建立连接器任务目录');
            $locks = [];
            foreach (['job-' . $job, 'source-' . hash('sha256', $p['source_url'])] as $key) {
                $lock = fopen($dir . $key . '.lock', 'c');
                if (!$lock || !flock($lock, LOCK_EX | LOCK_NB)) {
                    if ($lock) fclose($lock);
                    foreach ($locks as $held) { flock($held, LOCK_UN); fclose($held); }
                    return json(['error' => 'Task or source is running; verify execution before retrying'], 409);
                }
                $locks[] = $lock;
            }
            try {
                return $this->execute($b, $p, $hash, $dir . $job . '.json', $cfg);
            } finally {
                foreach ($locks as $held) { flock($held, LOCK_UN); fclose($held); }
            }
        } catch (\Throwable $e) {
            // No save was attempted on this outer validation/configuration path.
            return json(['status' => 'failed', 'message' => '入库前校验失败：' . mb_substr($e->getMessage(), 0, 200)]);
        }
    }

    protected function execute(array $b, array $p, string $hash, string $journal, array $cfg)
    {
        $previous = is_file($journal) ? json_decode((string)file_get_contents($journal), true) : null;
        if (is_file($journal) && !is_array($previous)) return json(['error' => 'Task receipt is corrupt; manual verification required'], 503);
        if ($previous && ($previous['hash'] ?? '') !== $hash) return json(['error' => 'Job payload conflict'], 409);
        if (($previous['status'] ?? '') === 'succeeded') {
            // Replays report the recorded ID without updating a manually edited product.
            return json(['status' => 'succeeded', 'remote_id' => (string)$previous['remote_id'], 'message' => '重复任务：返回原商品 ID，未再次写入']);
        }
        if ($previous && in_array($previous['status'] ?? '', ['saving', 'unknown'], true)) {
            return json(['error' => 'Previous save outcome requires manual verification'], 409);
        }
        $query = fn() => Db::name('store_product')->where('soure_link', $p['source_url'])->where('is_del', 0);
        if ($query()->find()) return json(['status' => 'failed', 'message' => '该来源商品已经存在，已停止；不会覆盖原有商品']);
        $categoryIds = $cfg['category_map'][$p['category']] ?? null;
        $categoryIds = is_numeric($categoryIds) ? [(int)$categoryIds] : $categoryIds;
        if (!is_array($categoryIds) || !$categoryIds) throw new \RuntimeException('当前分类未配置商城分类 ID 映射');
        foreach ($categoryIds as $id) {
            if (!is_int($id) || $id <= 0 || !Db::name('store_product_category')->where('id', $id)->where('type', 0)->find()) throw new \RuntimeException('分类 ID 不存在或不是平台分类');
        }
        $shippingId = (int)($cfg['shipping_template_id'] ?? 0);
        if ($shippingId <= 0 || !Db::name('shipping_templates')->where('id', $shippingId)->find()) throw new \RuntimeException('请配置有效的商城运费模板 ID');
        $adminId = (int)($cfg['admin_id'] ?? 0);
        if ($adminId <= 0 || !Db::name('system_admin')->where('id', $adminId)->find()) throw new \RuntimeException('请配置有效的平台管理员 ID 用于操作记录');
        $start = microtime(true);
        $images = [];
        foreach ($p['images'] as $url) {
            if (microtime(true) - $start > 35) throw new \RuntimeException('图片转存超时，尚未保存商品');
            $images[] = $this->copyImage($url, $cfg['image_hosts'] ?? []);
        }
        $data = self::buildPayload($p, $images, $categoryIds, $shippingId);
        // Recheck immediately before save. Ordinary editor imports do not share this lock.
        if ($query()->find()) return json(['status' => 'failed', 'message' => '该来源商品已经存在，已停止']);
        $record = ['hash' => $hash, 'job_id' => $b['job_id'], 'source_url' => $p['source_url'], 'status' => 'saving', 'updated' => date(DATE_ATOM)];
        $this->writeJournal($journal, $record); // Never begin save without durable task state.
        try {
            $remoteId = Db::transaction(function () use ($data, $query, $adminId) {
                // Product service already owns SKU validation and inventory side effects.
                // A second check in the database transaction narrows concurrent editor races.
                if ($query()->lock(true)->find()) throw new \RuntimeException('来源商品在保存前已存在');
                app()->make(StoreProductServices::class)->saveData(0, $data, 0, 0, $adminId, 'OPS 下架入库');
                $saved = $query()->find();
                if (!$saved || (int)$saved['is_show'] !== 0 || ($saved['code'] ?? '') !== $data['code']) throw new \RuntimeException('保存结果未通过下架状态核验');
                return (int)$saved['id'];
            });
        } catch (\Throwable $e) {
            // Do not claim failure is safe to retry when the original service may have side effects.
            $record['status'] = 'unknown';
            try { $this->writeJournal($journal, $record); } catch (\Throwable $ignored) {}
            return json(['error' => 'Save outcome requires verification in CRMEB; do not resubmit'], 503);
        }
        $record['status'] = 'succeeded'; $record['remote_id'] = $remoteId;
        try { $this->writeJournal($journal, $record); } catch (\Throwable $e) {
            return json(['error' => 'Product saved but receipt persistence failed; verify before resubmitting'], 503);
        }
        try {
            app()->make(StoreProductServices::class)->cacheTag()->clear();
            app()->make(StoreProductAttrServices::class)->cacheTag()->clear();
        } catch (\Throwable $ignored) {
            // Saving already succeeded. Cache invalidation must not turn it into retryable failure.
        }
        return json(['status' => 'succeeded', 'remote_id' => (string)$remoteId, 'message' => '已保存为下架商品，请到商城仓库检查']);
    }

    protected function writeJournal(string $path, array $data): void
    {
        $tmp = $path . '.' . bin2hex(random_bytes(8)) . '.tmp';
        if (file_put_contents($tmp, json_encode($data, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR), LOCK_EX) === false || !rename($tmp, $path)) {
            @unlink($tmp); throw new \RuntimeException('无法持久化任务状态');
        }
        @chmod($path, 0600);
    }

    public static function validateProduct($p): void
    {
        if (!is_array($p)) throw new \RuntimeException('缺少商品资料');
        if (!preg_match('~^https://detail\.1688\.com/offer/[0-9]+\.html$~D', (string)($p['source_url'] ?? ''))) throw new \RuntimeException('来源链接格式错误');
        if (!is_string($p['title'] ?? null) || trim($p['title']) === '' || mb_strlen($p['title']) > 200) throw new \RuntimeException('商品标题为空或过长');
        if (!is_string($p['category'] ?? null) || trim($p['category']) === '') throw new \RuntimeException('分类为空');
        if (!is_array($p['images'] ?? null) || count($p['images']) < 1 || count($p['images']) > 10) throw new \RuntimeException('首版连接器要求 1–10 张图片');
        if (!is_array($p['skus'] ?? null) || count($p['skus']) < 1 || count($p['skus']) > 100) throw new \RuntimeException('首版连接器要求 1–100 个 SKU');
        if (!is_string($p['description'] ?? '') || mb_strlen($p['description'] ?? '') > 50000) throw new \RuntimeException('商品详情格式错误');
        $codes = []; $specs = [];
        foreach ($p['skus'] as $s) {
            if (!is_array($s) || !is_string($s['sku'] ?? null) || !preg_match('/^[A-Za-z0-9_.-]{1,64}$/D', $s['sku'])) throw new \RuntimeException('SKU 编码只能为 1–64 位字母、数字、点、短横线、下划线');
            foreach (['price', 'cost', 'stock'] as $key) if (!isset($s[$key]) || !is_numeric($s[$key]) || !is_finite((float)$s[$key]) || $s[$key] < 0) throw new \RuntimeException('SKU 数值无效');
            if ($s['price'] <= 0 || $s['price'] > 99999999 || $s['cost'] > 99999999 || floor((float)$s['stock']) != $s['stock'] || $s['stock'] > 2147483647) throw new \RuntimeException('SKU 售价或库存超出范围');
            $spec = trim((string)($s['spec'] ?? ''));
            if (count($p['skus']) > 1 && ($spec === '' || mb_strlen($spec) > 100 || preg_match('/[,;=]/u', $spec))) throw new \RuntimeException('多规格名称不能为空、不能超过 100 字或包含英文逗号、分号、等号');
            if (isset($codes[$s['sku']]) || (count($p['skus']) > 1 && isset($specs[$spec]))) throw new \RuntimeException('SKU 编码或规格名称重复');
            $codes[$s['sku']] = true; $specs[$spec] = true;
        }
    }

    public static function buildPayload(array $p, array $images, array $categoryIds, int $shippingId): array
    {
        self::validateProduct($p);
        $data = json_decode((string)file_get_contents(__DIR__ . '/product-defaults.json'), true, 64, JSON_THROW_ON_ERROR);
        $multi = count($p['skus']) > 1;
        $description = nl2br(htmlspecialchars($p['description'] ?? '', ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'));
        foreach ($images as $image) $description .= '<p><img src="' . htmlspecialchars($image, ENT_QUOTES, 'UTF-8') . '" alt=""></p>';
        $data = array_replace($data, ['store_name' => $p['title'], 'store_info' => mb_substr(strip_tags($p['description'] ?? ''), 0, 100), 'cate_id' => $categoryIds, 'slider_image' => $images,
            'description' => $description, 'soure_link' => $p['source_url'], 'spec_type' => $multi ? 1 : 0, 'freight' => 3, 'temp_id' => $shippingId,
            'delivery_type' => [1], 'is_show' => 0, 'is_copy' => 0, 'auto_on_time' => 0, 'auto_off_time' => 0,
            'product_clear' => ['is_general_product'], 'code' => 'OPS-' . substr(hash('sha256', $p['source_url']), 0, 20)]);
        $attrs = []; $values = [];
        foreach ($p['skus'] as $s) {
            $value = $multi ? trim($s['spec']) : '默认'; $values[] = ['value' => $value, 'pic' => ''];
            $attrs[] = ['attr_arr' => [$value], 'detail' => ['规格' => $value], 'price' => (float)$s['price'], 'cost' => (float)$s['cost'],
                'stock' => (int)$s['stock'], 'pic' => $images[0], 'ot_price' => (float)$s['price'], 'code' => $s['sku'], 'bar_code' => '',
                'weight' => 0, 'volume' => 0, 'is_show' => 1, 'is_default_select' => 0, 'is_virtual' => 0,
                'brokerage' => 0, 'brokerage_two' => 0, 'vip_price' => 0, 'vip_proportion' => 0, 'unique' => ''];
        }
        $data['items'] = [['value' => '规格', 'detail' => $values]];
        $data['attrs'] = $multi ? $attrs : [];
        $data['attr'] = $multi ? [] : $attrs[0];
        return $data;
    }

    protected function copyImage(string $url, array $hosts): string
    {
        $u = parse_url($url);
        if (!$u || ($u['scheme'] ?? '') !== 'https' || !in_array(strtolower($u['host'] ?? ''), $hosts, true) || isset($u['user']) || isset($u['pass']) || (isset($u['port']) && $u['port'] !== 443)) throw new \RuntimeException('图片域名不在连接器允许名单中');
        $host = strtolower($u['host']); $ips = gethostbynamel($host);
        if (!$ips) throw new \RuntimeException('图片域名解析失败');
        foreach ($ips as $ip) if (!filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE)) throw new \RuntimeException('禁止下载非公网图片');
        $content = ''; $ch = curl_init($url);
        curl_setopt_array($ch, [CURLOPT_FOLLOWLOCATION => false, CURLOPT_RETURNTRANSFER => false,
            CURLOPT_CONNECTTIMEOUT => 3, CURLOPT_TIMEOUT => 8, CURLOPT_SSL_VERIFYPEER => true, CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_RESOLVE => [$host . ':443:' . $ips[0]], CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
            CURLOPT_WRITEFUNCTION => function ($ch, $chunk) use (&$content) {if (strlen($content) + strlen($chunk) > 8 * 1024 * 1024) return 0; $content .= $chunk; return strlen($chunk);}]);
        $ok = curl_exec($ch); $status = curl_getinfo($ch, CURLINFO_HTTP_CODE); curl_close($ch);
        if ($ok === false || $status !== 200) throw new \RuntimeException('图片下载失败或图片超过 8 MB');
        $info = @getimagesizefromstring($content);
        $types = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp', 'image/gif' => 'gif'];
        if (!$info || !isset($types[$info['mime']]) || $info[0] * $info[1] > 40000000) throw new \RuntimeException('图片格式或尺寸不支持');
        $name = hash('sha256', $content) . '.' . $types[$info['mime']];
        $upload = UploadService::init(sys_config('upload_type', 1));
        if ($upload->to('attach/ops/' . date('Y/m/d'))->validate()->setAuthThumb(false)->stream($content, $name) === false) throw new \RuntimeException('商城图片存储失败');
        $path = (string)($upload->getUploadInfo()['dir'] ?? '');
        if ($path === '') throw new \RuntimeException('商城未返回图片地址');
        if (str_starts_with($path, '//')) $path = 'https:' . $path;
        if (!preg_match('~^https?://~', $path)) $path = rtrim((string)sys_config('site_url'), '/') . '/' . ltrim($path, '/');
        if (!str_starts_with($path, 'https://')) throw new \RuntimeException('请将商城 site_url 和图片存储配置为 HTTPS');
        return $path;
    }
}
