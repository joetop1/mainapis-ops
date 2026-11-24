#!/usr/bin/env python3
"""Install the narrow classification API, backed up and PHP-linted; never grants permissions."""
import argparse,pathlib,re,subprocess,tempfile,shutil,datetime
p=argparse.ArgumentParser();p.add_argument('--root',required=True);p.add_argument('--php',default='php');p.add_argument('--apply',action='store_true');a=p.parse_args()
root=pathlib.Path(a.root).resolve();controller=root/'app/controller/out/Product.php';route=root/'route/out.php'
c=controller.read_text();r=route.read_text();methods=(pathlib.Path(__file__).resolve().parents[1]/'integrations/crmeb/ops-classification-methods.php.txt').read_text()
endpoints=[('get','ops-classification/catalog','opsClassificationCatalog','OPS分类标签字典'),('get','ops-classification/products','opsClassificationProducts','OPS现有商品列表'),('get','ops-classification/product/:id','opsClassificationDetail','OPS现有商品分类详情'),('post','ops-classification/product/:id','opsClassificationUpdate','OPS仅更新商品分类标签')]
lines=''.join("        Route::%s('%s', 'Product/%s')->option(['real_name' => '%s']);\n"%e for e in endpoints)
if 'OPS_CLASSIFICATION_V1' in c or 'ops-classification/' in r:
 if methods.strip() in c and lines.strip() in r:print('接口已安装，无需重复修改');raise SystemExit()
 raise SystemExit('同名接口存在差异，未修改')
anchor=re.search(r'^\s*public function categoryList\b',c,re.M);ra=re.search(r"^.*Route::get\('category/list'.*$",r,re.M)
if not anchor or not ra or 'AuthTokenMiddleware::class' not in r:raise SystemExit('未找到原有授权路由及控制器，未修改')
checks={'app/services/product/label/StoreProductLabelAuxiliaryServices.php':'function saveLabelRelation','app/services/product/product/StoreProductServices.php':'store_label_id'}
for file,needle in checks.items():
 if needle not in (root/file).read_text():raise SystemExit('商城结构不匹配，未修改')
changes={controller:c[:anchor.start()]+'\n'+methods+c[anchor.start():],route:r[:ra.start()]+lines+r[ra.start():]}
for file,text in changes.items():
 with tempfile.NamedTemporaryFile(suffix='.php',mode='w') as f:
  f.write(text);f.flush();subprocess.run([a.php,'-l',f.name],check=True,capture_output=True)
if not a.apply:print('检查通过；添加 --apply 将备份并安装4个专用接口，不修改商品或授权。');raise SystemExit()
suffix='.bak-ops-classification-'+datetime.datetime.now().strftime('%Y%m%d-%H%M%S-%f')
for file in changes:shutil.copy2(file,str(file)+suffix)
try:
 for file,text in changes.items():file.write_text(text)
except BaseException:
 for file in changes:shutil.copy2(str(file)+suffix,file)
 raise
print('已备份并安装专用接口，沿用原Token及逐接口授权；未修改商品和账号权限。')
