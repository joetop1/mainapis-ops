import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {fillMerchant554Images} from '../extensions/1688-collector/merchant-images.js';
const marker='OPS-46499e8b05a944af8f9a418f7d78f2ed';
function fixture(){
 const skus=Array.from({length:64},(_,i)=>({sku:'ALI-'+i,spec:'款式'+i+' / 均码',image:'https://cbu01.alicdn.com/image'+i+'.jpg'}));
 const rows=skus.map((s,i)=>({code:s.sku,detail:{'规格':s.spec},pic:'https://example.com/old.jpg',price:10+i,cost:4.73,stock:100+i,inventory:0,unique:'preserve-'+i}));
 const batch={pic:'',price:0,stock:0};const state={$route:{query:{id:'554'}},formData:{code:marker,store_name:'测试袜子',spec_type:1,is_show:0,attrs:rows},manyFormValidate:[batch,...rows],oneFormBatch:[batch],attrs:[{value:'规格',detail:skus.map(s=>({value:s.spec,pic:''}))}],$set:(row,key,value)=>{row[key]=value;},$forceUpdate:()=>{}};
 return {state,product:{source_url:'https://detail.1688.com/offer/755369163302.html',title:'测试袜子',skus}};
}
function run(state,product){return vm.runInNewContext('('+fillMerchant554Images.toString()+')(product)',{URL,location:{protocol:'https:',hostname:'xlupw.com',pathname:'/admin/product/add_product'},document:{querySelectorAll:()=>[{__vue__:state}]},product});}
test('554补图填表：64个SKU逐编码核对，仅修改pic，不调用保存或网络',()=>{
 const {state,product}=fixture();const protectedData=()=>JSON.stringify(state,(key,value)=>key==='pic'?undefined:value);
 const before=protectedData();const result=run(state,product);assert.equal(result.ok,true);assert.equal(result.count,64);assert.equal(protectedData(),before);
 for(let i=0;i<64;i++){assert.equal(state.manyFormValidate[i+1].pic,product.skus[i].image);assert.equal(state.attrs[0].detail[i].pic,product.skus[i].image);}
 assert.equal(state.oneFormBatch[0].pic,'');
});
test('554补图身份、规格或文件错误时整批拒绝，表单保持原样',()=>{
 for(const change of [
  ({state})=>{state.$route.query.id='555';},
  ({state})=>{state.$route.query.copy='554';},
  ({state})=>{state.formData.code='OTHER';},
  ({state})=>{state.manyFormValidate[64].detail['规格']='不匹配';},
  ({product})=>{product.skus[63].image='http://example.com/a.jpg';},
  ({product})=>{product.skus[63].sku=product.skus[0].sku;},
  ({product})=>{product.source_url='https://detail.1688.com/offer/999.html';}
 ]){
  const f=fixture();change(f);const before=JSON.stringify(f.state);assert.ok(run(f.state,f.product).error);assert.equal(JSON.stringify(f.state),before);
 }
});
