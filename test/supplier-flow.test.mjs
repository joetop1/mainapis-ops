import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {openStore,validateProduct} from '../core.mjs';
import {teamPermission} from '../teams.mjs';
test('货盘接口会话CSRF与空间隔离，编辑保留可信来源信息，审核仍要求图片SKU分类',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ops-supplier-flow-'));Object.assign(process.env,{DATA_DIR:dir,APP_ORIGIN:'https://ops.mainapis.com',DEMO_MODE:'false'});const {handler,closeStore}=await import('../server.mjs'),db=openStore(join(dir,'ops.sqlite'));
 for(const sub of ['alice','bob'])db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(sub,JSON.stringify({user:{sub},csrf:'csrf'}),Date.now()+60000);
 const call=async(path,method='GET',body={},sub='alice',csrf='csrf')=>{const req=Readable.from(method==='GET'?[]:[Buffer.from(JSON.stringify(body))]);Object.assign(req,{url:path,method,headers:{...(sub?{cookie:'ops_session='+sub}:{}),origin:'https://ops.mainapis.com','x-csrf-token':csrf,'content-type':'application/json'}});const res={status:200,setHeader(){},writeHead(s){this.status=s;},end(v){this.body=v;}};await handler(req,res);return {status:res.status,data:JSON.parse(res.body)};};
 try{
  const batch='12345678-1234-1234-1234-123456789abc';db.prepare('INSERT INTO supplier_batches(id,owner,supplier,filename,data,created) VALUES(?,?,?,?,?,?)').run(batch,'alice','供应商','报价.xlsx',JSON.stringify({products:[],assets:[]}),Date.now());
  assert.equal((await call('/api/supplier-imports/'+batch,'GET',{},'')).status,401);assert.equal((await call('/api/supplier-imports/'+batch,'GET',{},'bob')).status,400);assert.equal((await call('/api/supplier-imports/'+batch)).status,200);assert.equal((await call('/api/supplier-imports/'+batch,'DELETE',{},'alice','wrong')).status,403);assert.equal(teamPermission('editor','/api/supplier-imports','POST'),true);
  const metadata={supplier:'原供应商',filename:'原报价.xlsx'},source='supplier:'+'a'.repeat(64),product=validateProduct({source_url:source,title:'原商品',images:[],skus:[]},{supplier:metadata});db.prepare("INSERT INTO products VALUES(?,?,?,?,'draft',1,'now','now')").run('product','alice',source,JSON.stringify(product));
  assert.equal((await call('/api/products/product/approve','POST',{revision:1})).status,400);const changed=await call('/api/products/product','PUT',{...product,title:'新标题',supplier_import:{supplier:'伪造供应商'},revision:1});assert.equal(changed.status,200);const saved=JSON.parse(db.prepare('SELECT data FROM products WHERE id=?').get('product').data);assert.equal(saved.title,'新标题');assert.deepEqual(saved.supplier_import,metadata);
  assert.equal((await call('/api/products','POST',product)).status,400);assert.equal((await call('/api/supplier-imports/'+batch,'DELETE')).status,200);
 }finally{db.close();closeStore();await rm(dir,{recursive:true,force:true});}
});
