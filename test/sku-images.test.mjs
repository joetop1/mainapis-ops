import test from 'node:test';
import assert from 'node:assert/strict';
import {matchSkuImages} from '../public/sku-images.js';
const source='https://detail.1688.com/offer/123.html';
test('已有商品按来源和SKU补图片，不依赖行序，不接收错商品或重复编码',()=>{
 const product={source_url:source+'?from=plugin',skus:[{sku:'B',image:'https://example.com/b.jpg',price:0},{sku:'A',image:'https://example.com/a.jpg',price:0}]};
 assert.deepEqual(matchSkuImages(source,['A','B'],product),[{sku:'B',image:'https://example.com/b.jpg'},{sku:'A',image:'https://example.com/a.jpg'}]);
 assert.throws(()=>matchSkuImages(source,['A','B'],{...product,source_url:source.replace('123','456')}));
 assert.throws(()=>matchSkuImages(source,['A'],product));
 assert.throws(()=>matchSkuImages(source,['A','B'],{...product,skus:[product.skus[0],product.skus[0]]}));
 assert.throws(()=>matchSkuImages(source,['A'],{source_url:source,skus:[{sku:'A',image:'javascript:alert(1)'}]}));
});
