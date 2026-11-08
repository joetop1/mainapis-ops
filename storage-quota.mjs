import {createHash,randomUUID} from 'node:crypto';
import {uploadImage,readImage,storageDestination,compactImageKey} from './image-storage.mjs';
const digest=b=>createHash('sha256').update(b).digest('hex');
export function storageQuota({db,getPlan,isExempt,clock=()=>Date.now(),fetchImpl=fetch}){
 db.exec("CREATE TABLE IF NOT EXISTS storage_objects(destination TEXT NOT NULL,object_key TEXT NOT NULL,owner TEXT NOT NULL,bytes INTEGER NOT NULL CHECK(bytes>0),state TEXT NOT NULL CHECK(state IN('reserved','stored')),lease TEXT NOT NULL DEFAULT '',lease_until INTEGER NOT NULL DEFAULT 0,created INTEGER NOT NULL,PRIMARY KEY(destination,object_key));CREATE INDEX IF NOT EXISTS storage_objects_owner ON storage_objects(owner)");
 if(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='team_members'").get())db.exec("CREATE TRIGGER IF NOT EXISTS storage_prevent_team_move BEFORE INSERT ON team_members WHEN NOT EXISTS(SELECT 1 FROM team_members WHERE sub=NEW.sub) AND (EXISTS(SELECT 1 FROM storage_objects WHERE owner=NEW.sub) OR EXISTS(SELECT 1 FROM storage_entitlements WHERE owner=NEW.sub AND expires>strftime('%Y-%m-%dT%H:%M:%fZ','now'))) BEGIN SELECT RAISE(ABORT,'个人空间存在OSS图片或有效套餐，请先核对处理，未加入团队且未迁移存储权益'); END;");
 const tx=fn=>{db.exec('BEGIN IMMEDIATE');try{const r=fn();db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}};
 const usage=owner=>db.prepare("SELECT COALESCE(SUM(CASE WHEN state='stored' THEN bytes ELSE 0 END),0) storedBytes,COALESCE(SUM(CASE WHEN state='reserved' THEN bytes ELSE 0 END),0) reservedBytes,COUNT(*) objects FROM storage_objects WHERE owner=?").get(owner);
 const status=owner=>{const plan=getPlan(owner),used=usage(owner),exempt=isExempt(owner);return {...plan,...used,exempt,availableBytes:exempt?null:Math.max(0,plan.limitBytes-used.storedBytes-used.reservedBytes),scope:'tracked_uploads',trafficMetered:false};};
 function access(owner){const s=status(owner);if(!s.exempt&&!s.active)throw Error('OSS套餐未生效，请先兑换开通或续期卡；原有图片不会删除');return s;}
 return {status,assertAccess:access,
  async upload(c,key,image,owner){
   if(key!==compactImageKey(owner,image.bytes,image.ext))throw Error('图片对象路径与工作空间不符');const destination=storageDestination(c),lease=randomUUID(),bytes=image.bytes.length,url=c.publicOrigin+'/'+key;
   const row=tx(()=>{const old=db.prepare('SELECT * FROM storage_objects WHERE destination=? AND object_key=?').get(destination,key);if(old){if(old.owner!==owner||old.bytes!==bytes)throw Error('图片计量记录冲突');if(old.state==='stored')return old;if(old.lease_until>clock())throw Error('同一图片正在处理，请稍后重试');db.prepare('UPDATE storage_objects SET lease=?,lease_until=? WHERE destination=? AND object_key=?').run(lease,clock()+120000,destination,key);return old;}
    const s=access(owner);if(!s.exempt&&s.availableBytes<bytes)throw Error('OSS套餐容量不足，请续费或升级；原有图片保留');db.prepare("INSERT INTO storage_objects VALUES(?,?,?,?,'reserved',?,?,?)").run(destination,key,owner,bytes,lease,clock()+120000,clock());return null;});
   if(row?.state==='stored')return url;
   const finish=()=>tx(()=>{const changed=db.prepare("UPDATE storage_objects SET state='stored',lease='',lease_until=0 WHERE destination=? AND object_key=? AND lease=?").run(destination,key,lease);if(!changed.changes)throw Error('图片容量核对处理中，请稍后重试');});
   try{
    if(row){let read;try{read=await readImage(url,{fetchImpl});}catch{}if(read&&digest(read.bytes)===digest(image.bytes)){finish();return url;}}
    const s=access(owner);if(!s.exempt&&s.storedBytes+s.reservedBytes>s.limitBytes)throw Error('当前套餐容量不足，不能继续新增上传');
    await uploadImage(c,key,image,{fetchImpl});finish();return url;
   }catch(e){db.prepare('UPDATE storage_objects SET lease_until=0 WHERE destination=? AND object_key=? AND lease=?').run(destination,key,lease);throw e;}
  }
 };
}
