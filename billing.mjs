import {randomUUID,randomBytes,createHash} from 'node:crypto';
const MAX_POINTS=1_000_000_000_000;
function points(value){if(!Number.isSafeInteger(value)||value<=0||value>1_000_000_000)throw Error('点数须为1至1000000000的整数');return value;}
function text(value,name,max=200){if(typeof value!=='string'||!value.trim()||value.length>max||/[\u0000-\u001f]/.test(value))throw Error(name+'无效');return value.trim();}
export function billingStore(db,{legacyOwners=[],clock=()=>new Date().toISOString()}={}){
 db.exec(`CREATE TABLE IF NOT EXISTS billing_settings(id INTEGER PRIMARY KEY CHECK(id=1),enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN(0,1)));
 INSERT OR IGNORE INTO billing_settings(id,enabled) VALUES(1,0);
 CREATE TABLE IF NOT EXISTS billing_accounts(owner TEXT PRIMARY KEY,available INTEGER NOT NULL DEFAULT 0 CHECK(available>=0 AND available<=1000000000000),frozen INTEGER NOT NULL DEFAULT 0 CHECK(frozen>=0 AND frozen<=1000000000000),exempt INTEGER NOT NULL DEFAULT 0 CHECK(exempt IN(0,1)));
 CREATE TABLE IF NOT EXISTS billing_ledger(id TEXT PRIMARY KEY,owner TEXT NOT NULL REFERENCES billing_accounts(owner),actor TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN('credit','hold','settle','release','refund')),points INTEGER NOT NULL CHECK(points>0),available_delta INTEGER NOT NULL,frozen_delta INTEGER NOT NULL,available_after INTEGER NOT NULL,frozen_after INTEGER NOT NULL,request_key TEXT NOT NULL UNIQUE,reference TEXT NOT NULL,reason TEXT NOT NULL,created TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS billing_ledger_owner ON billing_ledger(owner,created);
 CREATE TABLE IF NOT EXISTS billing_holds(id TEXT PRIMARY KEY,owner TEXT NOT NULL REFERENCES billing_accounts(owner),points INTEGER NOT NULL,actor TEXT NOT NULL,reference TEXT NOT NULL,rate_snapshot TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN('held','settled','released','refunded')),created TEXT NOT NULL,UNIQUE(owner,reference));
 CREATE TABLE IF NOT EXISTS billing_card_batches(id TEXT PRIMARY KEY,actor TEXT NOT NULL,label TEXT NOT NULL,points INTEGER NOT NULL,quantity INTEGER NOT NULL,expires TEXT NOT NULL,request_key TEXT NOT NULL UNIQUE,created TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS billing_cards(id TEXT PRIMARY KEY,batch_id TEXT NOT NULL REFERENCES billing_card_batches(id),digest TEXT NOT NULL UNIQUE,suffix TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'active' CHECK(state IN('active','redeemed','revoked')),owner TEXT NOT NULL DEFAULT '',redeemer TEXT NOT NULL DEFAULT '',redeemed TEXT NOT NULL DEFAULT '',ledger_id TEXT NOT NULL DEFAULT '');
 CREATE TABLE IF NOT EXISTS billing_card_events(actor TEXT NOT NULL,object_id TEXT NOT NULL,action TEXT NOT NULL,reason TEXT NOT NULL,created TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS billing_redemption_attempts(actor TEXT NOT NULL,created INTEGER NOT NULL);
 CREATE INDEX IF NOT EXISTS billing_redemption_actor ON billing_redemption_attempts(actor,created);
 CREATE TABLE IF NOT EXISTS billing_migrations(name TEXT PRIMARY KEY);
 CREATE TRIGGER IF NOT EXISTS billing_ledger_no_update BEFORE UPDATE ON billing_ledger BEGIN SELECT RAISE(ABORT,'账本流水不可修改'); END;
 CREATE TRIGGER IF NOT EXISTS billing_ledger_no_delete BEFORE DELETE ON billing_ledger BEGIN SELECT RAISE(ABORT,'账本流水不可删除'); END;`);
 if(!db.prepare("SELECT 1 FROM billing_migrations WHERE name='legacy-exempt-v1'").get()){
  db.exec('BEGIN IMMEDIATE');try{for(const owner of legacyOwners)db.prepare('INSERT INTO billing_accounts(owner,exempt) VALUES(?,1) ON CONFLICT(owner) DO UPDATE SET exempt=1').run(owner);db.prepare("INSERT INTO billing_migrations VALUES('legacy-exempt-v1')").run();db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
 }
 const account=owner=>db.prepare('SELECT * FROM billing_accounts WHERE owner=?').get(owner)||{owner,available:0,frozen:0,exempt:0};
 function change({owner,actor,kind,amount,available,frozen,key,reference='',reason}){
  text(owner,'工作空间');text(actor,'操作者');text(key,'请求编号');text(reference||'-','业务编号');text(reason,'原因',300);points(amount);
  const old=db.prepare('SELECT * FROM billing_ledger WHERE request_key=?').get(key);
  if(old){if(old.owner!==owner||old.actor!==actor||old.kind!==kind||old.points!==amount||old.reference!==reference||old.reason!==reason)throw Error('请求编号已用于不同账务操作');return {id:old.id,duplicate:true};}
  db.prepare('INSERT OR IGNORE INTO billing_accounts(owner) VALUES(?)').run(owner);const a=account(owner);
  if(!Number.isSafeInteger(a.available+available)||!Number.isSafeInteger(a.frozen+frozen)||a.available+available<0||a.frozen+frozen<0||a.available+a.frozen+available+frozen>MAX_POINTS)throw Error('可用点数不足或超出钱包上限');
  db.prepare('UPDATE billing_accounts SET available=available+?,frozen=frozen+? WHERE owner=?').run(available,frozen,owner);const next=account(owner),id=randomUUID();
  db.prepare('INSERT INTO billing_ledger VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,owner,actor,kind,amount,available,frozen,next.available,next.frozen,key,reference,reason,clock());return {id,duplicate:false};
 }
 const transaction=fn=>{db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}};
 return {
  view(owner,page=1){text(owner,'工作空间');page=Math.max(1,Math.min(100000,Math.trunc(Number(page))||1));const a=account(owner);return {account:{...a,exempt:!!a.exempt},enabled:!!db.prepare('SELECT enabled FROM billing_settings WHERE id=1').get().enabled,page,pageSize:20,total:db.prepare('SELECT COUNT(*) n FROM billing_ledger WHERE owner=?').get(owner).n,entries:db.prepare('SELECT * FROM billing_ledger WHERE owner=? ORDER BY created DESC,rowid DESC LIMIT 20 OFFSET ?').all(owner,(page-1)*20)};},
  mintCards({actor,label,amount,quantity,expires='',key}){
   text(actor,'操作者');text(label,'批次名称',80);text(key,'请求编号');points(amount);if(!Number.isSafeInteger(quantity)||quantity<1||quantity>200)throw Error('每批生成1至200张');
   if(expires&&(!Number.isFinite(Date.parse(expires))||Date.parse(expires)<=Date.parse(clock())||Date.parse(expires)>Date.parse(clock())+366*86400000))throw Error('卡密有效期须在未来一年内');
   return transaction(()=>{const old=db.prepare('SELECT * FROM billing_card_batches WHERE request_key=?').get(key);if(old){if(old.actor!==actor||old.label!==label||old.points!==amount||old.quantity!==quantity||old.expires!==expires)throw Error('生成请求编号与原批次冲突');return {id:old.id,duplicate:true,codes:[]};}
    const id=randomUUID(),created=clock(),codes=[];db.prepare('INSERT INTO billing_card_batches VALUES(?,?,?,?,?,?,?,?)').run(id,actor,label,amount,quantity,expires,key,created);
    for(let i=0;i<quantity;i++){const raw='OPS'+randomBytes(20).toString('hex').toUpperCase(),code='OPS-'+raw.slice(3).match(/.{8}/g).join('-');db.prepare('INSERT INTO billing_cards(id,batch_id,digest,suffix) VALUES(?,?,?,?)').run(randomUUID(),id,createHash('sha256').update(raw).digest('hex'),raw.slice(-8));codes.push(code);}
    db.prepare('INSERT INTO billing_card_events VALUES(?,?,?,?,?)').run(actor,id,'mint',label,created);return {id,duplicate:false,codes};});
  },
  cardBatches(page=1){page=Math.max(1,Math.min(100000,Math.trunc(Number(page))||1));return {page,pageSize:20,total:db.prepare('SELECT COUNT(*) n FROM billing_card_batches').get().n,items:db.prepare("SELECT b.*,SUM(c.state='redeemed') redeemed,SUM(c.state='revoked') revoked,SUM(c.state='active' AND (b.expires='' OR b.expires>?)) usable FROM billing_card_batches b JOIN billing_cards c ON c.batch_id=b.id GROUP BY b.id ORDER BY b.created DESC,b.rowid DESC LIMIT 20 OFFSET ?").all(clock(),(page-1)*20)};},
  cardDetails(batchId,page=1){text(batchId,'批次编号');page=Math.max(1,Math.min(100000,Math.trunc(Number(page))||1));const batch=db.prepare('SELECT * FROM billing_card_batches WHERE id=?').get(batchId);if(!batch)throw Error('批次不存在');const items=db.prepare('SELECT id,suffix,state,owner,redeemer,redeemed FROM billing_cards WHERE batch_id=? ORDER BY rowid LIMIT 20 OFFSET ?').all(batchId,(page-1)*20).map(c=>({...c,state:c.state==='active'&&batch.expires&&Date.parse(batch.expires)<=Date.parse(clock())?'expired':c.state}));return {batch,items,page,pageSize:20,total:batch.quantity};},
  revokeCards({actor,batchId,reason}){text(actor,'操作者');text(batchId,'批次编号');text(reason,'作废原因',300);return transaction(()=>{if(!db.prepare('SELECT 1 FROM billing_card_batches WHERE id=?').get(batchId))throw Error('批次不存在');const result=db.prepare("UPDATE billing_cards SET state='revoked' WHERE batch_id=? AND state='active'").run(batchId);if(result.changes)db.prepare('INSERT INTO billing_card_events VALUES(?,?,?,?,?)').run(actor,batchId,'revoke',reason,clock());return {ok:true,revoked:result.changes};});},
  redeemCard({owner,actor,code}){
   text(owner,'工作空间');text(actor,'操作者');
   transaction(()=>{const time=Date.parse(clock());db.prepare('DELETE FROM billing_redemption_attempts WHERE created<?').run(time-86400000);if(db.prepare('SELECT COUNT(*) n FROM billing_redemption_attempts WHERE actor=? AND created>?').get(actor,time-600000).n>=10)throw Object.assign(Error('兑换尝试过多，请10分钟后重试'),{httpStatus:429});db.prepare('INSERT INTO billing_redemption_attempts VALUES(?,?)').run(actor,time);});
   const raw=typeof code==='string'&&code.length<=100?code.replace(/[-\s]/g,'').toUpperCase():'';if(!/^OPS[A-F0-9]{40}$/.test(raw))throw Error('卡密无效、已过期、已作废或已被使用');
   const digest=createHash('sha256').update(raw).digest('hex');
   return transaction(()=>{const card=db.prepare('SELECT c.*,b.points,b.expires FROM billing_cards c JOIN billing_card_batches b ON b.id=c.batch_id WHERE digest=?').get(digest);if(card?.state==='redeemed'&&card.owner===owner)return {ok:true,duplicate:true,amount:card.points,ledgerId:card.ledger_id};
    if(!card||card.state!=='active'||card.expires&&Date.parse(card.expires)<=Date.parse(clock()))throw Error('卡密无效、已过期、已作废或已被使用');
    const result=change({owner,actor,kind:'credit',amount:card.points,available:card.points,frozen:0,key:'card:'+card.id,reference:card.batch_id,reason:'卡密兑换 · 尾号'+card.suffix});
    db.prepare("UPDATE billing_cards SET state='redeemed',owner=?,redeemer=?,redeemed=?,ledger_id=? WHERE id=? AND state='active'").run(owner,actor,clock(),result.id,card.id);db.prepare('INSERT INTO billing_card_events VALUES(?,?,?,?,?)').run(actor,card.id,'redeem','兑换到 '+owner,clock());return {ok:true,duplicate:false,amount:card.points,ledgerId:result.id};});
  },
  receipt(key){text(key,'请求编号');return db.prepare('SELECT id,owner,actor,kind,points,reason,request_key FROM billing_ledger WHERE request_key=?').get(key)||null;},
  credit({owner,actor,amount,key,reason}){points(amount);return transaction(()=>change({owner,actor,kind:'credit',amount,available:amount,frozen:0,key,reason}));},
  reserve({id,owner,actor,amount,reference,rate}){
   text(id,'冻结编号');text(reference,'业务编号');points(amount);const snapshot=JSON.stringify(rate);if(!snapshot||snapshot.length>4096)throw Error('价格快照无效');
   return transaction(()=>{const old=db.prepare('SELECT * FROM billing_holds WHERE id=?').get(id);if(old){if(old.owner!==owner||old.actor!==actor||old.points!==amount||old.reference!==reference||old.rate_snapshot!==snapshot)throw Error('冻结编号与原任务冲突');return {id,duplicate:true,state:old.state};}
    change({owner,actor,kind:'hold',amount,available:-amount,frozen:amount,key:'hold:'+id,reference,reason:'任务预冻结'});db.prepare("INSERT INTO billing_holds VALUES(?,?,?,?,?,?,'held',?)").run(id,owner,amount,actor,reference,snapshot,clock());return {id,state:'held'};});
  },
  finish({id,owner,actor,action,reason}){
   if(!['settle','release','refund'].includes(action))throw Error('结算操作无效');text(reason,'原因',300);
   return transaction(()=>{const h=db.prepare('SELECT * FROM billing_holds WHERE id=? AND owner=?').get(id,owner);if(!h)throw Error('冻结记录不存在或不属于当前空间');const target={settle:'settled',release:'released',refund:'refunded'}[action];if(h.state===target)return {id,duplicate:true,state:h.state};if(action==='refund'?h.state!=='settled':h.state!=='held')throw Error('账务状态冲突，未重复结算或退款');
    change({owner,actor,kind:action,amount:h.points,available:action==='settle'?0:h.points,frozen:action==='refund'?0:-h.points,key:action+':'+id,reference:h.reference,reason});db.prepare('UPDATE billing_holds SET state=? WHERE id=?').run(target,id);return {id,state:target};});
  }
 };
}
