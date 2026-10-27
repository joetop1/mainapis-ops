<?php
namespace MainApis\OpsBridge;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use app\outside\modes\OutsideAppSetting;
use app\outside\services\NotifyService;
use app\common\models\AccountWechats;
use app\backend\modules\goods\models\Goods;
use app\backend\modules\goods\models\GoodsOption;
use app\backend\modules\goods\models\GoodsSpec;
use app\backend\modules\goods\models\GoodsSpecItem;
use app\backend\modules\goods\models\Category;
use app\backend\modules\goods\models\Brand;

// Additive compatibility entry. Does not override any original controller or route.
final class Bridge
{
    const CONTRACT = 'mainapis-yunzhong-2';
    private $appId;
    private $uniacid;
    private $table = 'mainapis_ops_receipts';

    public function authorize(array $input, array $config)
    {
        if (empty($config['enabled'])) throw new \RuntimeException('扩展未启用');
        if (!isset($input['app_id']) || !preg_match('/^[0-9]{1,30}$/D', (string)$input['app_id'])) throw new \RuntimeException('鉴权失败');
        $this->uniacid = (int)$config['uniacid'];
        if ($this->uniacid !== 1) throw new \RuntimeException('此扩展仅配置了商城1');
        $setting = OutsideAppSetting::where('uniacid', $this->uniacid)->where('app_id', (string)$input['app_id'])->first();
        if (!$setting || !$setting->is_open || ($input['sign_type'] ?? '') !== 'SHA256') throw new \RuntimeException('鉴权失败');
        // Always verify, independent of the original sign_required switch semantics.
        $message = (new NotifyService($input, $setting))->toQueryString($input);
        $expected = hash_hmac('sha256', $message, $setting->app_secret);
        if (!is_string($input['sign'] ?? null) || !hash_equals($expected, $input['sign'])) throw new \RuntimeException('鉴权失败');
        if (!isset($input['timestamp']) || !preg_match('/^[0-9]{10}$/D',(string)$input['timestamp']) || abs(time()-(int)$input['timestamp'])>300 || !preg_match('/^[0-9a-f]{32}$/D',(string)($input['nonce'] ?? ''))) throw new \RuntimeException('请求已过期');
        $this->appId = (string)$setting->app_id;
        \Setting::$uniqueAccountId = \YunShop::app()->uniacid = $this->uniacid;
        AccountWechats::setConfig(AccountWechats::getAccountByUniacid($this->uniacid));
        if (!Schema::hasTable($this->table)) throw new \RuntimeException('兼容扩展尚未安装数据表');
    }

    public function capabilities()
    {
        $level = (int)(\Setting::get('shop.category')['cat_level'] ?? 2);
        if (!in_array($level, [2,3], true)) throw new \RuntimeException('暂不支持当前分类层级');
        return ['contract'=>self::CONTRACT, 'bridgeVersion'=>'0.2.0', 'categoryLevel'=>$level,
            'categories'=>Category::uniacid()->where('enabled',1)->where('plugin_id',0)->select(['id','name','parent_id','level'])->limit(5001)->get()->toArray(),
            'brands'=>Brand::uniacid()->select(['id','name'])->limit(5001)->get()->toArray(),
            'features'=>['atomic_create','marker_receipt','text_detail','sku','full_detail']];
    }

    private function receiptQuery($marker)
    {
        return DB::table($this->table)->where('uniacid',$this->uniacid)->where('app_id',$this->appId)->where('marker',$marker);
    }

    public function lookup($marker)
    {
        $this->checkMarker($marker);
        $receipt=$this->receiptQuery($marker)->first();
        if (!$receipt) return ['found'=>false];
        return ['found'=>true,'product'=>$this->readProduct($receipt)];
    }

    public function detail($marker, $id)
    {
        $this->checkMarker($marker);
        $receipt=$this->receiptQuery($marker)->where('goods_id',(int)$id)->first();
        if (!$receipt) throw new \RuntimeException('商品不属于该任务');
        return $this->readProduct($receipt);
    }

    private function checkMarker($marker)
    {
        if (!is_string($marker) || !preg_match('/^OPS-[0-9a-f]{32}$/D',$marker)) throw new \RuntimeException('任务编码无效');
    }

    private function checkPlan(array $plan)
    {
        $this->checkMarker($plan['marker'] ?? null);
        $base=$plan['base'] ?? []; $options=$plan['options'] ?? []; $ids=$plan['category_ids'] ?? [];
        $level=(int)(\Setting::get('shop.category')['cat_level'] ?? 2);
        if (!in_array($level,[2,3],true) || count($ids)!==$level) throw new \RuntimeException('分类层级与商城不符');
        $parent=0;
        foreach ($ids as $id) {
            if (!is_int($id) || $id<1 || !Category::uniacid()->where('id',$id)->where('parent_id',$parent)->where('enabled',1)->where('plugin_id',0)->exists()) throw new \RuntimeException('分类路径无效');
            $parent=$id;
        }
        if (!is_string($base['title'] ?? null) || trim($base['title'])==='' || mb_strlen($base['title'])>100 || (int)($base['status'] ?? -1)!==0 || ($base['goods_sn'] ?? '')!==$plan['marker']) throw new \RuntimeException('商品标题、状态或任务编码无效');
        if (!is_string($plan['content_html'] ?? null) || strlen($plan['content_html'])>1000000) throw new \RuntimeException('商品详情内容无效');
        preg_match_all('/<[^>]*>/',$plan['content_html'],$tags);
        foreach ($tags[0] as $tag) {
            if (in_array($tag,['<p>','</p>','<br>'],true)) continue;
            if (!preg_match('/^<img src="([^"]+)" alt="">$/D',$tag,$matches)) throw new \RuntimeException('详情标签不支持');
            $this->checkImage(html_entity_decode($matches[1],ENT_QUOTES,'UTF-8'));
        }
        $this->checkImage($base['thumb'] ?? '');
        if (!is_array($base['thumb_url'] ?? null) || count($base['thumb_url'])<1 || count($base['thumb_url'])>30) throw new \RuntimeException('主图数量无效');
        if ($base['thumb_url'][0]!==$base['thumb']) throw new \RuntimeException('首图不匹配');
        foreach ($base['thumb_url'] as $url) $this->checkImage($url);
        foreach (['price','market_price','cost_price','dispatch_price'] as $key) $this->checkAmount($base[$key] ?? null);
        if (!is_int($base['stock'] ?? null) || $base['stock']<0 || $base['stock']>2147483647) throw new \RuntimeException('总库存无效');
        $brand=(int)($base['brand_id'] ?? 0);
        if ($brand && !Brand::uniacid()->where('id',$brand)->exists()) throw new \RuntimeException('品牌不存在');
        if (!is_array($options['specs'] ?? null) || count($options['specs'])<1 || count($options['specs'])>5 || !is_array($options['option'] ?? null) || count($options['option'])<1 || count($options['option'])>100) throw new \RuntimeException('规格数量无效');
        $values=[];$dimensions=[];
        foreach ($options['specs'] as $dimension=>$spec) {
            if (!preg_match('/^SC[0-9]+$/D',(string)($spec['id'] ?? '')) || !is_string($spec['title'] ?? null) || trim($spec['title'])==='') throw new \RuntimeException('规格ID或名称无效');
            if (!is_array($spec['spec_item'] ?? null) || count($spec['spec_item'])<1 || count($spec['spec_item'])>100) throw new \RuntimeException('规格值数量无效');
            foreach ($spec['spec_item'] as $item) {
                $id=$item['id'] ?? '';
                if (!is_string($id) || !preg_match('/^SV[0-9]+X[0-9]+$/D',$id) || isset($values[$id]) || !is_string($item['title'] ?? null) || trim($item['title'])==='') throw new \RuntimeException('规格值ID或名称无效');
                $values[$id]=$dimension;
            }
            $dimensions[]=$dimension;
        }
        $codes=[];$combos=[];$stock=0;
        foreach ($options['option'] as $row) {
            if (!preg_match('/^SP[0-9]+$/D',(string)($row['id'] ?? '')) || !is_string($row['goods_sn'] ?? null) || !preg_match('/^[A-Za-z0-9_.-]{1,64}$/D',$row['goods_sn']) || isset($codes[$row['goods_sn']])) throw new \RuntimeException('SKU编号无效');
            $codes[$row['goods_sn']]=true;
            $combo=explode('_',$row['specs'] ?? '');
            if (count($combo)!==count($dimensions) || isset($combos[$row['specs']])) throw new \RuntimeException('SKU组合无效');
            foreach ($combo as $dimension=>$id) if (!isset($values[$id]) || $values[$id]!==$dimension) throw new \RuntimeException('SKU规格值不匹配');
            $combos[$row['specs']]=true;
            foreach (['product_price','cost_price','market_price'] as $key) $this->checkAmount($row[$key] ?? null);
            if (!is_int($row['stock'] ?? null) || $row['stock']<0 || $row['stock']>2147483647) throw new \RuntimeException('SKU库存无效');
            $stock+=$row['stock'];$this->checkImage($row['thumb'] ?? '');
        }
        if ($stock!==$base['stock']) throw new \RuntimeException('SKU与总库存不一致');
    }

    private function checkAmount($value)
    {
        if (!is_string($value) || !preg_match('/^[0-9]{1,8}(\.[0-9]{1,2})?$/D',$value)) throw new \RuntimeException('金额格式无效');
    }
    private function checkImage($url)
    {
        if (!is_string($url) || !filter_var($url,FILTER_VALIDATE_URL) || strtolower(parse_url($url,PHP_URL_SCHEME) ?: '')!=='https' || parse_url($url,PHP_URL_USER)!==null || parse_url($url,PHP_URL_PASS)!==null || preg_match('/[\x00-\x20]/',$url)) throw new \RuntimeException('图片地址无效');
    }

    public function create(array $plan)
    {
        $this->checkPlan($plan);
        // Validate lower-level transaction support without accepting SQL or identifiers from the request.
        $connection=DB::connection();$database=$connection->getDatabaseName();
        foreach ([new Goods(),new GoodsOption(),new GoodsSpec(),new GoodsSpecItem(),new \app\backend\modules\goods\models\GoodsDispatch()] as $model) {
            $table=$connection->getTablePrefix().$model->getTable();
            $rows=DB::select('SELECT ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',[$database,$table]);
            if (count($rows)!==1 || strcasecmp($rows[0]->ENGINE,'InnoDB')!==0) throw new \RuntimeException('商品表不支持事务');
        }
        $hash=hash('sha256',json_encode($plan));
        return DB::transaction(function () use ($plan,$hash) {
            $receipt=$this->receiptQuery($plan['marker'])->lockForUpdate()->first();
            if ($receipt) {
                if (!hash_equals($receipt->payload_hash,$hash)) throw new \RuntimeException('任务已存在且内容不同，禁止重新创建');
                return $this->readProduct($receipt);
            }
            // Persist receipt and full product atomically; unique tenant/app/marker protects concurrent requests.
            DB::table($this->table)->insert(['uniacid'=>$this->uniacid,'app_id'=>$this->appId,'marker'=>$plan['marker'],'payload_hash'=>$hash,'goods_id'=>0,'created_at'=>date('Y-m-d H:i:s')]);
            $base=$plan['base'];
            $fields=array_intersect_key($base,array_flip(['title','alias','brand_id','thumb','cost_price','market_price','price','sku','stock','goods_sn','product_sn']));
            $fields=array_merge($fields,['thumb_url'=>$base['thumb_url'],'content'=>$plan['content_html'],'type'=>1,'status'=>0,'virtual_sales'=>0,'is_deleted'=>0,'comment_num'=>0,'is_plugin'=>0,'plugin_id'=>0,'reduce_stock_method'=>0,'weight'=>0,'video_image'=>'','goods_video'=>'','category'=>[array_map(function($id){return ['id'=>$id];},$plan['category_ids'])],'category_to_option'=>[]]);
            $widgets=['dispatch'=>['dispatch_type'=>1,'dispatch_price'=>$base['dispatch_price'],'dispatch_type_ids'=>[1],'is_cod'=>0],'commission'=>['is_commission'=>1],'area_dividend'=>['is_dividend'=>1],'team_dividend'=>['is_dividend'=>1],'merchant'=>['is_open_bonus_center'=>1,'is_open_bonus_staff'=>1],'param'=>[],'option'=>array_merge($plan['options'],['has_option'=>1])];
            $request=\Illuminate\Http\Request::create('/','POST',['goods'=>$fields,'widgets'=>$widgets]);
            // Run the existing creation service and observers; emit the final create event after specification consistency repair.
            $service=new class($request,1) extends \app\backend\modules\goods\services\CreateGoodsService {
                public function afterSaving() {}
                public function finishEvent() {parent::afterSaving();}
            };
            $result=$service->create();
            if (($result['status'] ?? -1)!==1) throw new \RuntimeException('商城创建服务校验失败');
            $goods=$service->goods_model;
            // Vendor 2.3.700 accumulates content IDs across dimensions. Only normalize this newly-created product's dimension lists.
            foreach (GoodsSpec::where('uniacid',$this->uniacid)->where('goods_id',$goods->id)->get() as $spec) {
                $ids=GoodsSpecItem::where('uniacid',$this->uniacid)->where('specid',$spec->id)->orderBy('display_order')->pluck('id')->all();
                $spec->content=serialize($ids);if (!$spec->save()) throw new \RuntimeException('规格值列表保存失败');
            }
            $service->finishEvent();
            $this->receiptQuery($plan['marker'])->update(['goods_id'=>$goods->id]);
            return $this->readProduct($this->receiptQuery($plan['marker'])->first());
        });
    }

    private function readProduct($receipt)
    {
        $goods=Goods::uniacid()->where('id',$receipt->goods_id)->first();
        if (!$goods || $goods->goods_sn!==$receipt->marker) throw new \RuntimeException('任务对应商品不存在或货号不匹配');
        $specs=GoodsSpec::where('uniacid',$this->uniacid)->where('goods_id',$goods->id)->orderBy('display_order')->with('hasManySpecsItem')->get();
        $valueMap=[];$names=[];
        foreach ($specs as $spec) {
            $names[]=$spec->title;$ids=[];
            foreach ($spec->hasManySpecsItem as $item) {$ids[]=(int)$item->id;$valueMap[(string)$item->id]=$item->title;}
            $stored=@unserialize($spec->getAttributes()['content'] ?? '',['allowed_classes'=>false]);
            if (!is_array($stored)) throw new \RuntimeException('规格列表格式无效');
            $stored=array_map('intval',$stored);sort($ids);sort($stored);
            if ($ids!==$stored) throw new \RuntimeException('规格值列表不一致');
        }
        $skus=[];
        foreach (GoodsOption::where('uniacid',$this->uniacid)->where('goods_id',$goods->id)->orderBy('display_order')->get() as $option) {
            $values=[];foreach(explode('_',$option->specs) as $id) { if (!isset($valueMap[$id])) throw new \RuntimeException('SKU规格值缺失');$values[]=$valueMap[$id]; }
            $skus[]=['sku'=>$option->goods_sn,'price'=>(string)$option->product_price,'cost'=>(string)$option->cost_price,'stock'=>(int)$option->stock,'image'=>yz_tomedia($option->thumb),'spec_values'=>$values];
        }
        $gallery=@unserialize(($goods->getAttributes()['thumb_url'] ?? ''),['allowed_classes'=>false]);
        if (!is_array($gallery)) throw new \RuntimeException('主图列表格式无效');
        $dispatch=\app\backend\modules\goods\models\GoodsDispatch::where('goods_id',$goods->id)->first();
        return ['price'=>(string)$goods->price,'cost_price'=>(string)$goods->cost_price,'stock'=>(int)$goods->stock,'dispatch_type'=>$dispatch?(int)$dispatch->dispatch_type:null,'dispatch_price'=>$dispatch?(string)$dispatch->dispatch_price:null,'id'=>(string)$goods->id,'marker'=>$goods->goods_sn,'status'=>(int)$goods->status,'title'=>$goods->title,'brand_id'=>(int)$goods->brand_id,'category_paths'=>$goods->hasManyGoodsCategory()->get()->map(function($row){return array_map('intval',explode(',',$row->category_ids));})->values()->all(),'images'=>array_map('yz_tomedia',$gallery),'content_html'=>(string)$goods->content,'spec_names'=>$names,'skus'=>$skus];
    }
}
