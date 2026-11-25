import {observeProcess} from './diagnostics.mjs';
if(!process.argv.includes('--check'))observeProcess('worker');
import {DatabaseSync} from 'node:sqlite';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
if(process.env.DEMO_MODE==='true'||process.env.OPS_WORKER_PAUSED==='true'){
 if(!process.argv.includes('--check'))setInterval(()=>{},60000);
}else if(process.argv.includes('--check')){
 try{const db=new DatabaseSync(join(process.env.DATA_DIR||join(dirname(fileURLToPath(import.meta.url)),'data'),'ops.sqlite'),{readOnly:true});const row=db.prepare('SELECT owner,heartbeat FROM publication_worker WHERE id=1').get();db.close();process.exitCode=row?.owner&&row.heartbeat>Date.now()-30000?0:1;}catch{process.exitCode=1;}
}else{
 process.env.OPS_PROCESS_ROLE='worker';
 const {startPublicationWorker,closeStore}=await import('./server.mjs');
 const worker=startPublicationWorker();let exiting=false;
 for(const signal of ['SIGTERM','SIGINT'])process.on(signal,async()=>{if(exiting)return;exiting=true;await worker.stop();closeStore();process.exit(0);});
}
