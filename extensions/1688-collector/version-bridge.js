// Only report public build metadata. Never expose credentials or accept page commands.
(()=>{
 const api=globalThis.browser??globalThis.chrome;
 if(location.origin!=='https://ops.mainapis.com')return;
 window.addEventListener('message',event=>{
  if(event.source!==window||event.origin!==location.origin||event.data?.type!=='mainapis:collector:query')return;
  const nonce=event.data.nonce;if(typeof nonce!=='string'||nonce.length>100)return;
  const manifest=api.runtime.getManifest();
  window.postMessage({type:'mainapis:collector:version',nonce,version:manifest.version,channel:manifest.name.includes('Safari')?'safari':'chromium'},location.origin);
 });
})();
