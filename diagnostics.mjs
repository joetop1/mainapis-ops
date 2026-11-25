import {AsyncLocalStorage} from 'node:async_hooks';
const requests=new AsyncLocalStorage();
export function markPhase(phase){const context=requests.getStore();if(context)context.phase=phase;}
import {randomUUID} from 'node:crypto';
import {errorMonitor} from 'node:events';
export function logError(event,error,context={}){
 const clean=value=>String(value??'').replace(/https?:\/\/[^\s)]+/g,'[remote URL]').replace(/(bearer\s+|(?:token|secret|password|authorization|api[_-]?key)["'\s:=]+)[^\s,"'}]+/gi,'$1[redacted]').slice(0,12000);
 console.error(JSON.stringify({event,...requests.getStore(),...context,name:clean(error?.name||'Error'),message:clean(error?.message||error),stack:clean(error?.stack)}));
}
export function observeProcess(role){
 const boot_id=randomUUID();console.log(JSON.stringify({event:'process_started',role,boot_id,pid:process.pid,node:process.version}));
 // Monitor without suppressing Node's default fatal exception behavior.
 process.on('uncaughtExceptionMonitor',(error,origin)=>logError('process_fatal',error,{role,boot_id,origin}));
}
export function observeRequest(req,res,handle){
 const request_id=randomUUID(),start=performance.now(),path=new URL(req.url,'http://localhost').pathname;
 res.setHeader('X-Request-ID',request_id);
 const context={request_id,path,phase:'request'};
 const report=event=>console.log(JSON.stringify({event,...context,method:req.method,status:res.statusCode,elapsed_ms:Math.round(performance.now()-start)}));
 res.once('finish',()=>report('request_finished'));res.once('close',()=>{if(!res.writableFinished)report('request_aborted');});
 res.on(errorMonitor,error=>logError('response_error',error,{request_id,path}));
 requests.run(context,()=>Promise.resolve().then(()=>handle(req,res))).catch(error=>{logError('request_unhandled',error,{request_id,path});if(!res.headersSent&&!res.destroyed){res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'服务处理失败，请凭请求编号核对',request_id}));}else res.destroy();});
}
