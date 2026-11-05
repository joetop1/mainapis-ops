import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
test('编辑上传遇到已有上传不释放其保存锁；关闭或切换后不会把旧图写入其他商品',async()=>{
 const save={disabled:true},status={textContent:''},form={querySelector:()=>save,elements:{detail_images:{value:''}}},nodes={productForm:form,localImageStatus:status,editor:{open:true},localMainImages:{},localDetailImages:{}};let resolveUpload;const calls=[];
 class FileReader{readAsDataURL(){this.result='data:image/png;base64,AAA=';this.onload();}}
 const context=vm.createContext({$:s=>nodes[s.slice(1)],FileReader,toast(){},api:()=>new Promise(resolve=>{resolveUpload=resolve;}),imageLinks:()=>[],renderImageGallery:field=>calls.push(field)});
 vm.runInContext('let editorImageBusy=1,editorImageGeneration=1;',context);vm.runInContext(source.slice(source.indexOf('async function uploadEditorImages('),source.indexOf('for(const field of Object.keys(imageFields))')),context);
 await context.uploadEditorImages([{size:1,name:'a.png'}],'detail_images');assert.equal(save.disabled,true);assert.equal(vm.runInContext('editorImageBusy',context),1);
 vm.runInContext('editorImageBusy=0',context);const pending=context.uploadEditorImages([{size:1,name:'a.png'}],'detail_images');await Promise.resolve();await Promise.resolve();vm.runInContext('editorImageGeneration=2;editorImageBusy=0',context);resolveUpload({url:'https://images.example.com/a.png'});await pending;assert.equal(form.elements.detail_images.value,'');assert.deepEqual(calls,[]);
});
