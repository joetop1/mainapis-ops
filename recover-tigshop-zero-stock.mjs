// One specific observed pre-save rejection.
import {openStore} from './core.mjs';
import {connectionStore} from './connection-store.mjs';
import {recoverTigshopZeroStock} from './tigshop-recovery.mjs';
import {join} from 'node:path';
const dir=process.env.DATA_DIR||'/app/data',db=openStore(join(dir,'ops.sqlite'));
try{const store=await connectionStore(db,dir),job=db.prepare('SELECT owner FROM jobs WHERE id=?').get('650b74d9-6d5e-4174-9245-4d45163e3699');if(!job)throw Error('任务不存在');console.log(JSON.stringify(await recoverTigshopZeroStock(db,job.owner,owner=>store.get(owner)),null,2));}finally{db.close();}
