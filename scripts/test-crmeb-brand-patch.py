import contextlib, io, pathlib, runpy, sys, tempfile, unittest
from unittest.mock import patch
SCRIPT=pathlib.Path(__file__).with_name('patch-crmeb-brand-readonly.py')
class PatchTest(unittest.TestCase):
 def fixture(self,root):
  files={'app/controller/out/Product.php':"<?php\nclass Product {\n public function categoryList() {}\n}\n",'route/out.php':"<?php\nRoute::group(function () {\n Route::get('category/list', 'Product/categoryList');\n})->middleware(AuthTokenMiddleware::class, true);\n",'app/services/product/brand/StoreBrandServices.php':'<?php\nclass StoreBrandServices { public function cascaderList($type = 1) {} }'}
  for name,text in files.items():p=root/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(text)
  return files
 def execute(self,root,apply=False,lint_error=None):
  args=[str(SCRIPT),'--root',str(root)]+(['--apply'] if apply else [])
  with patch.object(sys,'argv',args),patch('subprocess.run',side_effect=lint_error),contextlib.redirect_stdout(io.StringIO()):runpy.run_path(str(SCRIPT),run_name='__main__')
 def test_dry_run_apply_backup_and_idempotence(self):
  with tempfile.TemporaryDirectory() as d:
   root=pathlib.Path(d);files=self.fixture(root);self.execute(root)
   for name,text in files.items():self.assertEqual((root/name).read_text(),text)
   self.execute(root,True)
   self.assertIn('cascaderList(0)',(root/'app/controller/out/Product.php').read_text())
   route=(root/'route/out.php').read_text();self.assertLess(route.index("'brand/list'"),route.index("'category/list'"));self.assertIn('AuthTokenMiddleware::class',route)
   self.assertEqual(len(list(root.rglob('*.bak-ops-brands-*'))),2)
   with self.assertRaises(SystemExit) as result:self.execute(root,True)
   self.assertEqual(result.exception.code,0)
 def test_lint_failure_never_changes_originals(self):
  with tempfile.TemporaryDirectory() as d:
   root=pathlib.Path(d);files=self.fixture(root)
   with self.assertRaises(RuntimeError):self.execute(root,True,RuntimeError('PHP lint failed'))
   for name,text in files.items():self.assertEqual((root/name).read_text(),text)
 def test_missing_auth_middleware_refuses_patch(self):
  with tempfile.TemporaryDirectory() as d:
   root=pathlib.Path(d);self.fixture(root);route=root/'route/out.php';route.write_text(route.read_text().replace('AuthTokenMiddleware::class','OtherMiddleware::class'))
   with self.assertRaises(SystemExit):self.execute(root,True)
if __name__=='__main__':unittest.main()
