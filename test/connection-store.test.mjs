import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openStore} from '../core.mjs';
import {connectionStore} from '../connection-store.mjs';
test('connection secrets persist encrypted, are owner-bound, and key is private',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ops-secrets-')),db=openStore(join(dir,'db'));
 try{
  const store=await connectionStore(db,dir),value={token:'a'.repeat(32),templateId:51};store.set('alice',value);
  const ciphertext=db.prepare('SELECT encrypted FROM connections WHERE owner=?').get('alice').encrypted;
  assert.ok(!ciphertext.includes(value.token));assert.deepEqual(store.get('alice'),value);assert.equal(store.get('bob'),null);
  assert.equal((await stat(join(dir,'connections.key'))).mode&0o777,0o600);
  const again=await connectionStore(db,dir);assert.deepEqual(again.get('alice'),value);
  db.prepare('INSERT INTO connections VALUES(?,?,?)').run('bob',ciphertext,'now');assert.throws(()=>store.get('bob'),/解密/);
 }finally{db.close();await rm(dir,{recursive:true,force:true});}
});
