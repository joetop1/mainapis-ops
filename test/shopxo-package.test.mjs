import test from 'node:test';
import assert from 'node:assert/strict';
import {gunzipSync} from 'node:zlib';
import {readFile} from 'node:fs/promises';
import {createShopxoPackage} from '../shopxo-package.mjs';
test('ShopXO下载包仅含独立扩展、预检指纹及说明，不含密钥或商城源码',async()=>{
 const directory=new URL('../integrations/shopxo/bridge/',import.meta.url).pathname,r=await createShopxoPackage(directory),tar=gunzipSync(r.bytes),names=[];
 assert.equal(r.version,'0.1.0');for(let pos=0;tar[pos];){const header=tar.subarray(pos,pos+512),name=header.subarray(0,100).toString().split('\0')[0],size=parseInt(header.subarray(124,136).toString(),8);names.push(name);assert.deepEqual(tar.subarray(pos+512,pos+512+size),await readFile(directory+name));pos+=512+Math.ceil(size/512)*512;}
 assert.deepEqual(names.sort(),['Auth.php','Bridge.php','Compatibility.php','reviewed-sources.json','entry.php','install.php','INSTALL.md'].sort());assert.equal(names.includes('config.php'),false);
});
