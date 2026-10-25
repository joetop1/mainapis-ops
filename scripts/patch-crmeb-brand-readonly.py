#!/usr/bin/env python3
"""Add a read-only brand endpoint inside existing outapi token-authenticated routes."""
import argparse, pathlib, re, subprocess, tempfile, shutil, datetime
parser=argparse.ArgumentParser()
parser.add_argument('--root',required=True)
parser.add_argument('--apply',action='store_true')
args=parser.parse_args()
root=pathlib.Path(args.root).resolve()
controller=root/'app/controller/out/Product.php'
route=root/'route/out.php'
service=root/'app/services/product/brand/StoreBrandServices.php'
source=service.read_text()
if not re.search(r'function\s+cascaderList\s*\(',source):
    raise SystemExit('未找到已核对的 cascaderList 方法，未修改')
method='''    // OPS read-only brand list; protected by the existing outapi token middleware.
    public function opsBrandList()
    {
        $services = app()->make(\\app\\services\\product\\brand\\StoreBrandServices::class);
        return app('json')->success($services->cascaderList(0));
    }

'''
route_line="        Route::get('brand/list', 'Product/opsBrandList')->option(['real_name' => 'OPS只读品牌列表']);\n"
c=controller.read_text();r=route.read_text()
if 'AuthTokenMiddleware::class' not in r:raise SystemExit('未找到原有 Token 中间件，未修改')
if 'opsBrandList' in c or "'brand/list'" in r or '"brand/list"' in r:
    if method.strip() in c and route_line.strip() in r:
        print('只读品牌接口已安装，无需重复修改');raise SystemExit(0)
    raise SystemExit('已存在同名方法或路由，请人工检查，未修改')
match=re.search(r'^\s*public function categoryList\b',c,re.M)
route_match=re.search(r"^.*Route::get\('category/list'.*$",r,re.M)
if not match or not route_match:raise SystemExit('未找到预期分类接口锚点，未修改')
c=c[:match.start()]+'\n'+method+c[match.start():]
r=r[:route_match.start()]+route_line+r[route_match.start():]
changes={controller:c,route:r}
# Parse candidate PHP before either original file is touched.
for path,text in changes.items():
    with tempfile.NamedTemporaryFile(suffix='.php',mode='w',encoding='utf-8') as f:
        f.write(text);f.flush()
        subprocess.run(['php','-l',f.name],check=True,capture_output=True)
if not args.apply:
    print('检查通过，将仅修改：\n'+str(controller)+'\n'+str(route)+'\n添加 --apply 才会备份并写入。')
else:
    suffix='.bak-ops-brands-'+datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
    for path in changes:shutil.copy2(path,str(path)+suffix)
    try:
        for path,text in changes.items():path.write_text(text)
    except BaseException:
        for path in changes:shutil.copy2(str(path)+suffix,path)
        raise
    print('已备份并添加只读接口 GET /outapi/brand/list；沿用原 Token 鉴权，未修改商品数据。')
