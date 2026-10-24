import test from 'node:test';
import assert from 'node:assert/strict';
import {parseOfficialExport} from '../official-export.mjs';
import {validateProduct,assertPublishable} from '../core.mjs';
const headers=['序号','商品标题','宝贝ID','宝贝链接','图片地址','价格','代发价','销量','评论数','月成交笔数','月代销','发货时间','上架时间','类目','标签'];
const values=['1','gentmuben条纹多款男士商务条纹多款组合专用丝袜西装丝袜','755369163302','https://detail.1688.com/offer/755369163302.html?fromkv=cbuPcPlugin:others','https://cbu01.alicdn.com/img/ibank/O1CN01gADh8G26V599xz4WR_!!2216510437666-0-cib.310x310.jpg','3.98','4.98','74538','92','1077','877','48小时','2023-12-13 01:26:00','商务袜','48小时发货'];
test('官方导出样例：去跟踪、保留参考价、不把供应商销量标签当商城字段',()=>{
 const p=validateProduct(parseOfficialExport('\uFEFF'+headers.join('\t')+'\r\n'+values.join('\t'))[0]);
 assert.equal(p.source_url,'https://detail.1688.com/offer/755369163302.html');assert.equal(p.sourcing.purchase_price,'3.98');assert.equal(p.sourcing.dropship_price,'4.98');assert.equal(p.sourcing.supplier_sales,'74538');assert.equal(p.sourcing.category,'商务袜');assert.equal(p.category,'');assert.deepEqual(p.tag_ids,[]);assert.equal(p.virtual_sales,0);assert.deepEqual(p.skus,[]);assert.throws(()=>assertPublishable(p));
 assert.equal(parseOfficialExport(headers.join(' ')+'\n'+values.join('\t'))[0].title,values[1]);
});
test('CSV 支持引号、逗号、换行和空列；列错位、错误ID与超量拒绝',()=>{
 const p=parseOfficialExport('商品标题,宝贝ID,价格,代发价\n"袜子,黑色\n两件装",123,3.98,');assert.equal(p[0].title,'袜子,黑色\n两件装');assert.equal(p[0].sourcing.dropship_price,'');
 assert.equal(parseOfficialExport('商品标题\t宝贝ID\t代发价\n袜子\t123\t')[0].sourcing.dropship_price,'');
 assert.throws(()=>parseOfficialExport('标题\n无'));assert.throws(()=>parseOfficialExport('商品标题,宝贝ID\n袜子,123,多一列'));assert.throws(()=>parseOfficialExport('商品标题,宝贝ID\n"未闭合,123'));
 assert.throws(()=>parseOfficialExport('商品标题,宝贝ID,宝贝链接\n袜子,123,https://detail.1688.com/offer/456.html'));
 assert.throws(()=>parseOfficialExport('商品标题,宝贝ID\n'+Array(101).fill('袜子,123').join('\n')));
});
