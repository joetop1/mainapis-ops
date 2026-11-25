import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {logError} from '../diagnostics.mjs';
test('异常日志保留调用栈并遮蔽凭证与远程URL',()=>{
 const original=console.error,lines=[];console.error=line=>lines.push(line);
 try{logError('test',new Error('token=private-secret password=private-pass https://example.com/?token=private-url'),{request_id:'rid'});}finally{console.error=original;}
 assert.equal(lines.length,1);assert(!lines[0].includes('private-'));const row=JSON.parse(lines[0]);assert.equal(row.request_id,'rid');assert.match(row.stack,/diagnostics.test.mjs/);
});
test('致命异常被记录但仍非零退出，不吞掉未捕获Promise拒绝',()=>{
 const script=`import {observeProcess} from ${JSON.stringify(new URL('../diagnostics.mjs',import.meta.url).href)};observeProcess('test');Promise.reject(new Error('fatal-test'));`;
 const result=spawnSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8'});
 assert.notEqual(result.status,0);assert.match(result.stdout,/process_started/);assert.match(result.stderr,/process_fatal/);
});

test('HTTP异常有请求编号与阶段，查询参数不进入日志，返回受控500',async()=>{
 const {EventEmitter}=await import('node:events');
 const {observeRequest,markPhase}=await import('../diagnostics.mjs');
 const originalLog=console.log,originalError=console.error,lines=[];
 console.log=line=>lines.push(JSON.parse(line));console.error=line=>lines.push(JSON.parse(line));
 try{
  const response=new EventEmitter();response.headers={};response.setHeader=(key,value)=>response.headers[key]=value;
  response.writeHead=status=>response.statusCode=status;
  response.end=body=>{response.body=JSON.parse(body);response.writableFinished=true;response.emit('finish');};
  observeRequest({method:'POST',url:'/api/products/p/publish?token=private-query'},response,async()=>{markPhase('publish_persist');throw Error('database unavailable');});
  await new Promise(setImmediate);
  assert.equal(response.statusCode,500);assert.equal(response.body.request_id,response.headers['X-Request-ID']);
  const error=lines.find(row=>row.event==='request_unhandled'),finish=lines.find(row=>row.event==='request_finished');
  assert.equal(error.request_id,finish.request_id);assert.equal(finish.phase,'publish_persist');assert(finish.elapsed_ms>=0);
  assert(!JSON.stringify(lines).includes('private-query'));
 }finally{console.log=originalLog;console.error=originalError;}
});
