import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {repairSavedImageUrls} from '../local-image-upload.mjs';
const prefix=createHash('sha256').update('alice').digest('hex').slice(0,24);
const long='https://img.example.com/ops/'+prefix+'/'+'x'.repeat(130)+'.png';
const short='https://img.example.com/ops/short.png';
test('保存自动修复主图详情SKU并去重，不转存外链或其他空间图片',async()=>{
 const external='https://supplier.example.com/'+'x'.repeat(150),foreign=long.replace(prefix,'other');
 const p={images:[long,external,foreign,short],detail_images:[long],skus:[{sku:'a',image:long},{sku:'b'}]};const before=JSON.stringify(p),calls=[];
 const result=await repairSavedImageUrls(p,'alice',{getStorage:()=>({publicOrigin:'https://img.example.com'}),upload:async(owner,input)=>{calls.push({owner,...input});return {url:short};}});
 assert.equal(calls.length,1);assert.equal(calls[0].sourceUrl,long);assert.deepEqual(result.images,[short,external,foreign,short]);assert.deepEqual(result.detail_images,[short]);assert.equal(result.skus[0].image,short);assert.equal(JSON.stringify(p),before);
});
test('修复失败阻止保存，未配置存储保持外链原样',async()=>{
 const p={images:[long],skus:[]};
 await assert.rejects(repairSavedImageUrls(p,'alice',{getStorage:()=>({publicOrigin:'https://img.example.com'}),upload:async()=>{throw Error('网络失败');}}),/自动修复失败，商品未保存/);
 assert.deepEqual(await repairSavedImageUrls(p,'alice',{getStorage:()=>null,upload:async()=>assert.fail()}),{...p,detail_images:[]});
});
