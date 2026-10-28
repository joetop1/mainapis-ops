<?php
namespace MainApis\Shopxo;
use think\facade\Db;
use app\service\GoodsService;
use app\service\WarehouseGoodsService;
use app\service\ResourcesService;
class Bridge
{
    public const VERSION='0.1.0';
    private $appid;
    public function __construct($appid){$this->appid=$appid;}
    private function receipt($marker){return Db::name('MainapisShopxoReceipts')->where('app_id',$this->appid)->where('marker',$marker);}
    private function marker($value){if(!is_string($value)||!preg_match('/^OPS-[a-f0-9]{32}$/D',$value))throw new \RuntimeException('MARKER_INVALID');return $value;}
    private function ok($result){if(!is_array($result)||($result['code'] ?? -1)!==0)throw new \RuntimeException('NATIVE_SERVICE_REJECTED');return $result['data'] ?? null;}
    private function image($url){$u=is_string($url)?parse_url($url):false;if(!$u||($u['scheme'] ?? '')!=='https'||empty($u['host'])||isset($u['user'])||isset($u['pass'])||strlen($url)>250||preg_match('/[\x00-\x20\\\\]/',$url))throw new \RuntimeException('IMAGE_INVALID');return $url;}
    public function capabilities()
    {
        Compatibility::tables();
        return ['contract'=>'mainapis-shopxo-1','bridgeVersion'=>self::VERSION,'shopVersion'=>'6.9.2','features'=>['marker_receipt','warehouse_inventory','full_detail'],
            'categories'=>array_map(function($r){return ['id'=>(int)$r['id'],'parent_id'=>(int)$r['pid'],'name'=>$r['name']];},Db::name('GoodsCategory')->where('is_enable',1)->field('id,pid,name')->order('id asc')->limit(5001)->select()->toArray()),
            'brands'=>array_map(function($r){return ['id'=>(int)$r['id'],'name'=>$r['name']];},Db::name('Brand')->where('is_enable',1)->field('id,name')->order('id asc')->limit(5001)->select()->toArray()),
            'warehouses'=>array_map(function($r){return ['id'=>(int)$r['id'],'name'=>$r['name']];},Db::name('Warehouse')->where('is_enable',1)->where('is_delete_time',0)->field('id,name')->order('id asc')->limit(5001)->select()->toArray())];
    }
    public function lookup($marker)
    {
        $marker=$this->marker($marker);$row=$this->receipt($marker)->find();
        if(!$row)return ['found'=>false,'pending'=>Db::name('Goods')->where('coding',$marker)->count()>0];
        if(empty($row['goods_id']))return ['found'=>false,'pending'=>true];
        return ['found'=>true,'product'=>$this->read($row)];
    }
    public function detail($marker,$id)
    {
        $row=$this->receipt($this->marker($marker))->find();if(!$row||!is_int($id)||$id<1)throw new \RuntimeException('RECEIPT_MISMATCH');
        if(empty($row['goods_id'])){if(Db::name('Goods')->where('coding',$marker)->count()!==1||!Db::name('Goods')->where('id',$id)->where('coding',$marker)->find())throw new \RuntimeException('RECEIPT_MISMATCH');$this->receipt($marker)->where('goods_id',0)->update(['goods_id'=>$id]);$row=$this->receipt($marker)->find();}
        if((int)$row['goods_id']!==$id)throw new \RuntimeException('RECEIPT_MISMATCH');return $this->read($row);
    }
    private function validate($p)
    {
        if(!is_array($p))throw new \RuntimeException('PRODUCT_INVALID');$this->marker($p['marker'] ?? null);
        if(!is_string($p['title'] ?? null)||mb_strlen($p['title'])<2||mb_strlen($p['title'])>160)throw new \RuntimeException('TITLE_INVALID');
        foreach(['category_id','warehouse_id'] as $field)if(!is_int($p[$field] ?? null)||$p[$field]<1)throw new \RuntimeException('CATALOG_INVALID');
        if(!is_int($p['brand_id'] ?? null)||$p['brand_id']<0)throw new \RuntimeException('CATALOG_INVALID');
        if(!Db::name('GoodsCategory')->where('id',$p['category_id'])->where('is_enable',1)->find()||!Db::name('Warehouse')->where('id',$p['warehouse_id'])->where('is_enable',1)->where('is_delete_time',0)->find()||($p['brand_id']&&!Db::name('Brand')->where('id',$p['brand_id'])->where('is_enable',1)->find()))throw new \RuntimeException('CATALOG_UNAVAILABLE');
        if(!is_array($p['images'] ?? null)||count($p['images'])<1||count($p['images'])>30||!is_array($p['detail_images'] ?? null)||count($p['detail_images'])>100)throw new \RuntimeException('IMAGE_INVALID');foreach(array_merge($p['images'],$p['detail_images']) as $url)$this->image($url);
        if(!is_string($p['content_html'] ?? null)||strlen($p['content_html'])>500000)throw new \RuntimeException('DETAIL_INVALID');
        if(strpos(preg_replace('/<[^>]*>/','',$p['content_html']),'<')!==false)throw new \RuntimeException('DETAIL_INVALID');
        preg_match_all('/<[^>]*>/',$p['content_html'],$tags);
        foreach($tags[0] as $tag){if(in_array($tag,['<p>','</p>','<br>'],true))continue;if(!preg_match('/^<img src="([^"]+)" alt="">$/D',$tag,$match))throw new \RuntimeException('DETAIL_INVALID');$this->image(htmlspecialchars_decode($match[1],ENT_QUOTES));}
        if(!is_array($p['spec_names'] ?? null)||count($p['spec_names'])<1||count($p['spec_names'])>5||count(array_unique($p['spec_names']))!==count($p['spec_names']))throw new \RuntimeException('SPEC_INVALID');
        foreach($p['spec_names'] as $name)if(!is_string($name)||mb_strlen($name)<1||mb_strlen($name)>30)throw new \RuntimeException('SPEC_INVALID');
        if(!is_int($p['image_axis'] ?? null)||$p['image_axis']<0||$p['image_axis']>=count($p['spec_names'])||!is_array($p['skus'] ?? null)||count($p['skus'])<1||count($p['skus'])>100)throw new \RuntimeException('SKU_INVALID');
        $codes=[];$keys=[];$total=0;$images=[];
        foreach($p['skus'] as $s){
            if(!is_array($s)||!is_string($s['sku'] ?? null)||!preg_match('/^[A-Za-z0-9_.-]{1,64}$/D',$s['sku'])||isset($codes[$s['sku']])||!is_array($s['values'] ?? null)||count($s['values'])!==count($p['spec_names']))throw new \RuntimeException('SKU_INVALID');$codes[$s['sku']]=true;
            foreach($s['values'] as $value)if(!is_string($value)||mb_strlen($value)<1||mb_strlen($value)>60||strpos($value,'{|}')!==false)throw new \RuntimeException('SPEC_INVALID');
            $key=implode('',$s['values']);if(isset($keys[$key]))throw new \RuntimeException('SPEC_AMBIGUOUS');$keys[$key]=true;
            foreach(['price','cost'] as $field)if(!is_string($s[$field] ?? null)||!preg_match('/^\d{1,8}\.\d{2}$/D',$s[$field])||($field==='price'&&(float)$s[$field]<=0))throw new \RuntimeException('AMOUNT_INVALID');
            if(!is_int($s['stock'] ?? null)||$s['stock']<0)throw new \RuntimeException('STOCK_INVALID');$total+=$s['stock'];if($total>2147483647)throw new \RuntimeException('STOCK_INVALID');
            $this->image($s['image'] ?? null);$v=$s['values'][$p['image_axis']];if(isset($images[$v])&&$images[$v]!==$s['image'])throw new \RuntimeException('SPEC_IMAGE_UNSUPPORTED');$images[$v]=$s['image'];
        }
    }
    private function form($p)
    {
        $f=['title'=>$p['title'],'coding'=>$p['marker'],'category_id'=>[$p['category_id']],'brand_id'=>$p['brand_id'],'inventory_unit'=>'件','is_shelves'=>0,'is_deduction_inventory'=>0,'site_type'=>0,'images'=>$p['images'][0],'photo'=>$p['images'],'content_web'=>$p['content_html']];
        foreach($p['spec_names'] as $i=>$name){$f['specifications_name_'.$i]=$name;$f['specifications_value_'.$i]=array_column(array_column($p['skus'],'values'),$i);}
        foreach(GoodsService::GoodsSpecBaseFields() as $field){$f['specifications_'.$field]=[];foreach($p['skus'] as $s){$values=['price'=>$s['price'],'original_price'=>$s['price'],'buy_min_number'=>1,'buy_max_number'=>0,'weight'=>0,'volume'=>0,'coding'=>$s['sku'],'barcode'=>'','inventory_unit'=>'件','extends'=>json_encode(['mainapis'=>['cost'=>$s['cost'],'image'=>$s['image']]],JSON_UNESCAPED_SLASHES|JSON_UNESCAPED_UNICODE)];if(!array_key_exists($field,$values))throw new \RuntimeException('SPEC_SCHEMA_UNSUPPORTED');$f['specifications_'.$field][]=$values[$field];}}
        $images=[];foreach($p['skus'] as $s)$images[$s['values'][$p['image_axis']]]=$s['image'];$f['spec_images_name']=array_keys($images);$f['spec_images']=array_values($images);
        foreach($p['detail_images'] as $i=>$url){$f['content_app_images_'.$i]=$url;$f['content_app_content_'.$i]='';}
        return $f;
    }
    public function create($p)
    {
        $this->validate($p);Compatibility::tables();$marker=$p['marker'];$hash=hash('sha256',json_encode($p));
        $row=$this->receipt($marker)->find();if($row){if(!hash_equals($row['payload_hash'],$hash))throw new \RuntimeException('PAYLOAD_CHANGED');if(empty($row['goods_id']))throw new \RuntimeException('PENDING_RECEIPT');return $this->read($row);}
        if(Db::name('Goods')->where('coding',$marker)->count())throw new \RuntimeException('MARKER_EXISTS');
        $required=GoodsService::GoodsBaseFieldsRequiredConfigData([$p['category_id']]);if(!empty($required['brand_id'])&&!$p['brand_id'])throw new \RuntimeException('CATEGORY_REQUIRED_FIELDS_UNSUPPORTED');foreach(['simple_desc','spec_desc','approval_number','approval_number_expire','batch_number','batch_number_expire','model','produce_company','produce_region'] as $field)if(!empty($required[$field]))throw new \RuntimeException('CATEGORY_REQUIRED_FIELDS_UNSUPPORTED');
        $this->ok(\app\service\GoodsParamsService::GoodsParamsTemplateSaveCheck(['category_ids'=>[$p['category_id']],'parameter_value'=>[]]));
        $form=$this->form($p);$parsed=$this->ok(GoodsService::GetFormGoodsSpecificationsParams($form));
        if(count($parsed['data'] ?? [])!==count($p['skus'])||array_keys($parsed['title'] ?? [])!==$p['spec_names'])throw new \RuntimeException('SPEC_PARSE_MISMATCH');
        // A durable receipt is reserved before calling native services. Any uncertain result stays locked,
        // including third-party hook failures; it can never trigger an automatic second create.
        try{Db::name('MainapisShopxoReceipts')->insert(['app_id'=>$this->appid,'marker'=>$marker,'payload_hash'=>$hash,'goods_id'=>0,'warehouse_id'=>$p['warehouse_id'],'created_at'=>time()]);}catch(\Throwable $e){throw new \RuntimeException('PENDING_RECEIPT');}
        Db::startTrans();
        try {
            $result=$this->ok(GoodsService::GoodsSave($form));$id=(int)($result['goods_id'] ?? 0);if($id<1)throw new \RuntimeException('CREATE_ID_MISSING');
            $this->ok(WarehouseGoodsService::WarehouseGoodsAdd(['warehouse_id'=>$p['warehouse_id'],'goods_id'=>$id]));
            $wg=Db::name('WarehouseGoods')->where('warehouse_id',$p['warehouse_id'])->where('goods_id',$id)->find();if(!$wg)throw new \RuntimeException('WAREHOUSE_GOODS_MISSING');
            $inventory=$this->ok(WarehouseGoodsService::WarehouseGoodsInventoryData(['id'=>$wg['id']]));$stocks=[];$specs=[];$md5=[];
            foreach($inventory['spec'] ?? [] as $spec){$matched=null;foreach($p['skus'] as $s)if(hash_equals(md5(implode('',$s['values'])),$spec['md5_key'])){$matched=$s;break;}if(!$matched)throw new \RuntimeException('WAREHOUSE_SPEC_MISMATCH');$stocks[]=$matched['stock'];$specs[]=$spec['spec'];$md5[]=$spec['md5_key'];}
            if(count($stocks)!==count($p['skus']))throw new \RuntimeException('WAREHOUSE_SPEC_MISMATCH');
            $this->ok(WarehouseGoodsService::WarehouseGoodsInventorySave(['id'=>$wg['id'],'specifications_inventory'=>$stocks,'specifications_spec'=>$specs,'specifications_md5_key'=>$md5]));
            $this->receipt($marker)->update(['goods_id'=>$id]);$actual=$this->read($this->receipt($marker)->find());Db::commit();return $actual;
        }catch(\Throwable $e){Db::rollback();throw new \RuntimeException('CREATE_UNCONFIRMED');}
    }
    private function read($row)
    {
        $row=(array)$row;if(($row['app_id'] ?? '')!==$this->appid||empty($row['goods_id']))throw new \RuntimeException('RECEIPT_MISMATCH');
        $g=Db::name('Goods')->where('id',(int)$row['goods_id'])->where('coding',$this->marker($row['marker']))->where('is_delete_time',0)->find();if(!$g)throw new \RuntimeException('GOODS_MISSING');
        $types=Db::name('GoodsSpecType')->where('goods_id',$g['id'])->order('id asc')->select()->toArray();$names=array_column($types,'name');$skus=[];
        foreach(Db::name('GoodsSpecBase')->where('goods_id',$g['id'])->order('id asc')->select()->toArray() as $s){$meta=json_decode($s['extends'] ?? '',true)['mainapis'] ?? [];$values=Db::name('GoodsSpecValue')->where('goods_id',$g['id'])->where('goods_spec_base_id',$s['id'])->order('id asc')->column('value');
            $stock=(int)Db::name('WarehouseGoodsSpec')->where('goods_id',$g['id'])->where('warehouse_id',(int)$row['warehouse_id'])->where('md5_key',md5(implode('',$values)))->sum('inventory');
            $nativeImages=[];foreach($types as $i=>$type)foreach(json_decode($type['value'],true) ?: [] as $v)if(($v['name'] ?? null)===($values[$i] ?? null)&&!empty($v['images']))$nativeImages[]=ResourcesService::AttachmentPathViewHandle($v['images']);$nativeImages=array_values(array_unique($nativeImages));
            // The reference cost is stored in the native extensible spec JSON, not a fictitious cost column.
            $skus[]=['sku'=>$s['coding'],'values'=>$values,'price'=>(string)$s['price'],'cost'=>$meta['cost'] ?? null,'stock'=>(int)$s['inventory'],'warehouse_stock'=>$stock,'image'=>count($nativeImages)===1?$nativeImages[0]:null];
        }
        $categories=Db::name('GoodsCategoryJoin')->where('goods_id',$g['id'])->column('category_id');
        return ['id'=>(string)$g['id'],'marker'=>$g['coding'],'status'=>(int)$g['is_shelves'],'title'=>$g['title'],'stock'=>(int)$g['inventory'],'cover'=>ResourcesService::AttachmentPathViewHandle($g['images']),'detail_images'=>array_map(function($url){return ResourcesService::AttachmentPathViewHandle($url);},Db::name('GoodsContentApp')->where('goods_id',$g['id'])->order('id asc')->column('images')),'category_id'=>count($categories)===1?(int)$categories[0]:0,'brand_id'=>(int)$g['brand_id'],'warehouse_id'=>(int)$row['warehouse_id'],'images'=>array_map(function($url){return ResourcesService::AttachmentPathViewHandle($url);},Db::name('GoodsPhoto')->where('goods_id',$g['id'])->order('id asc')->column('images')),'content_html'=>ResourcesService::ContentStaticReplace($g['content_web'],'get'),'spec_names'=>$names,'skus'=>$skus];
    }
}
