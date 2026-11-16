import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

test('OPS session expiry reloads once; an upstream 401 or offline check does not reload',async()=>{
 const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
 let reloads=0,reply={status:401,body:{error:'上游登录失败'}};
 const context=vm.createContext({me:{user:{sub:'test'},csrf:'initial'},location:{reload(){reloads++;}},selectedMalls:{},document:{hidden:false},AbortSignal,fetch:async()=>{
  if(!reply)throw Error('offline');
  return new Response(reply.html??JSON.stringify(reply.body),{status:reply.status,headers:reply.headers});
 }});
 vm.runInContext(source.slice(source.indexOf('let sessionReloading='),source.indexOf('function empty(')),context);
 await assert.rejects(context.api('/api/test'),/上游登录失败/);
 reply={status:403,html:'<!DOCTYPE html><title>Access</title>',headers:{'cf-ray':'abc-SIN'}};
 await assert.rejects(context.api('/api/products/merge-preview','POST',{}),error=>error.responseStatus===403&&error.httpStatus===undefined&&/HTTP 403，Ray ID abc-SIN/.test(error.message));
 reply={status:200,html:'<!DOCTYPE html><title>OPS</title>'};
 await assert.rejects(context.api('/api/products/merge-preview','POST',{}),/非 JSON 响应（HTTP 200）/);
 reply=null;await context.checkSession();assert.equal(reloads,0);
 reply={status:401,body:{code:'OPS_SESSION_EXPIRED',error:'请先登录'}};
 await context.checkSession();
 await assert.rejects(context.api('/api/test'),/请先登录/);
 assert.equal(reloads,1);
});
