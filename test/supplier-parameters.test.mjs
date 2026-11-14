import test from 'node:test';
import assert from 'node:assert/strict';
import {splitSupplierParameters} from '../public/supplier-parameters.js';

test('货盘合并规格拆成参数，使用方法及续行保留在详情，重量不变',()=>{
 const result=splitSupplierParameters([{name:'重量（千克）',value:'0.05'},{name:'（产品规格）',value:'• 尺寸：5.9×3×12.6厘米 • 香味：香浓椰奶味 • 产品容量：75次以上使用量 • pH值：4.5 - 5.5 • 使用方法：见包装 • 注意：详见说明'}],'原详情');
 assert.deepEqual(result.attributes.map(row=>row.name),['重量（千克）','尺寸','香味','产品容量','pH值']);
 assert.equal(result.description,'原详情\n\n使用方法：见包装\n\n注意：详见说明');
 assert.equal(splitSupplierParameters(result.attributes,result.description).changed,false);
});
test('没有明确字段的内容和非合并字段不拆分',()=>{
 const attributes=[{name:'产品规格',value:'5.9厘米 / 50ml'},{name:'型号',value:'系列：A • 颜色：红'}];
 assert.deepEqual(splitSupplierParameters(attributes),{attributes,description:'',changed:false});
});
