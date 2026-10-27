import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {readFile,writeFile,chmod} from 'node:fs/promises';
import {join} from 'node:path';

// Keep the encryption key outside SQLite, in the persistent private data volume.
export async function connectionStore(db,dataDir,scope='tigshop'){
 const tables={yunzhong:'connections_yunzhong',tigshop:'connections','crmeb-pro':'connections_crmeb_pro','crmeb-store':'connections_crmeb_store'};
 const table=tables[scope];if(!table)throw Error('无效连接类型');
 const path=join(dataDir,'connections.key');
 try{await writeFile(path,randomBytes(32),{flag:'wx',mode:0o600});}catch(e){if(e.code!=='EEXIST')throw e;}
 await chmod(path,0o600);
 const key=await readFile(path);if(key.length!==32)throw Error('连接密钥文件损坏');
 db.exec(`CREATE TABLE IF NOT EXISTS ${table}(owner TEXT PRIMARY KEY, encrypted TEXT NOT NULL, updated TEXT NOT NULL)`);
 const aad=owner=>Buffer.from(scope+':'+owner);
 return {
  get(owner){
   const row=db.prepare(`SELECT encrypted FROM ${table} WHERE owner=?`).get(owner);if(!row)return null;
   try{const [iv,tag,data]=row.encrypted.split('.').map(x=>Buffer.from(x,'base64'));const cipher=createDecipheriv('aes-256-gcm',key,iv);cipher.setAAD(aad(owner));cipher.setAuthTag(tag);return JSON.parse(Buffer.concat([cipher.update(data),cipher.final()]).toString());}catch{throw Error('无法解密连接设置，请恢复原 connections.key 文件');}
  },
  set(owner,value){
   const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(aad(owner));
   const data=Buffer.concat([cipher.update(JSON.stringify(value)),cipher.final()]);
   const encrypted=[iv,cipher.getAuthTag(),data].map(x=>x.toString('base64')).join('.');
   db.prepare(`INSERT INTO ${table} VALUES(?,?,?) ON CONFLICT(owner) DO UPDATE SET encrypted=excluded.encrypted,updated=excluded.updated`).run(owner,encrypted,new Date().toISOString());
  }
 };
}
