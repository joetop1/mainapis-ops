import {createHash} from 'node:crypto';
export const DEFAULT_SYSTEM_INFO=Object.freeze({name:'商品运营台',brand:'MainAPIs',title:'商品运营台 · MainAPIs',login_heading:'商品整理一次，\n经营更轻松。',description:'从货源资料到商城商品，在一个工作空间里完成整理、审核与发布。'});
export const DEFAULT_ICON=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><rect width="128" height="128" rx="28" fill="#205440"/><path d="M26 94V34h16l22 31 22-31h16v60H86V61L64 90 42 61v33z" fill="#f1f6ed"/></svg>');
export function systemAdministrator(sub,allowed,explicit){const admins=explicit===undefined?(allowed.length===1?allowed:[]):String(explicit).split(',').map(v=>v.trim()).filter(Boolean);return typeof sub==='string'&&!!sub&&admins.includes(sub);}
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function raster(input,slot){
 if(!input||typeof input!=='object'||typeof input.data!=='string'||!input.data.length||input.data.length>1400000||input.data.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(input.data))throw Error('图标文件格式无效或超过1MB');
 const bytes=Buffer.from(input.data,'base64');if(bytes.length>1024*1024||bytes.length<12)throw Error('每张图片须小于1MB');let mime;
 if(bytes.length>=33&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&bytes.toString('ascii',12,16)==='IHDR'){if(!bytes.readUInt32BE(16)||!bytes.readUInt32BE(20)||bytes.readUInt32BE(16)>4096||bytes.readUInt32BE(20)>4096)throw Error('PNG尺寸须为1至4096像素');mime='image/png';}
 else if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255&&bytes.at(-2)===255&&bytes.at(-1)===217)mime='image/jpeg';
 else if(bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'&&bytes.length>=20&&bytes.readUInt32LE(4)+8===bytes.length)mime='image/webp';
 else if(slot==='icon'&&bytes.readUInt32LE(0)===65536){const n=bytes.readUInt16LE(4);if(!n||n>50||bytes.length<6+n*16)throw Error('ICO目录格式无效');for(let i=0;i<n;i++){const at=6+i*16,size=bytes.readUInt32LE(at+8),offset=bytes.readUInt32LE(at+12);if(!size||offset<6+n*16||offset+size>bytes.length)throw Error('ICO图片范围无效');}mime='image/x-icon';}
 if(!mime)throw Error('仅支持PNG、JPEG、WebP；站点图标另支持ICO，不接受SVG或HTML');
 return {mime,bytes,digest:createHash('sha256').update(bytes).digest('hex')};
}
export function systemSettings(db){
 db.exec(`CREATE TABLE IF NOT EXISTS system_settings(id INTEGER PRIMARY KEY CHECK(id=1),data TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS system_assets(slot TEXT PRIMARY KEY CHECK(slot IN ('icon','logo')),mime TEXT NOT NULL,bytes BLOB NOT NULL,digest TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS system_settings_audit(actor TEXT NOT NULL,revision INTEGER NOT NULL,created TEXT NOT NULL);
 INSERT OR IGNORE INTO system_settings(id,data) VALUES(1,'{}');`);
 const read=()=>{const r=db.prepare('SELECT * FROM system_settings WHERE id=1').get();const assets=Object.fromEntries(db.prepare('SELECT slot,mime,digest FROM system_assets').all().map(a=>[a.slot,a]));return {...DEFAULT_SYSTEM_INFO,...JSON.parse(r.data),revision:r.revision,icon_url:assets.icon?'/api/system-assets/icon?v='+assets.icon.digest:'/favicon.ico',logo_url:assets.logo?'/api/system-assets/logo?v='+assets.logo.digest:'',icon_mime:assets.icon?.mime||'image/svg+xml'};};
 const asset=slot=>db.prepare('SELECT * FROM system_assets WHERE slot=?').get(slot);
 const save=(input,actor)=>{
  if(!input||typeof input!=='object'||Array.isArray(input)||!Number.isSafeInteger(input.revision))throw Error('缺少系统设置版本，请刷新');const data={};
  for(const [key,max] of Object.entries({name:50,brand:50,title:100,login_heading:120,description:500})){if(typeof input[key]!=='string'||!input[key].trim()||[...input[key].trim()].length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(input[key])||key!=='login_heading'&&/[\r\n\t]/.test(input[key]))throw Error('系统名称、品牌、标题或登录文案为空、过长或含控制字符');data[key]=input[key].trim();}
  const assets={};for(const slot of ['icon','logo'])if(input[slot]!==undefined)assets[slot]=input[slot]===null?null:raster(input[slot],slot);
  db.exec('BEGIN IMMEDIATE');try{if(db.prepare('SELECT revision FROM system_settings WHERE id=1').get().revision!==input.revision)throw Object.assign(Error('系统设置已被更新，请重新读取后保存'),{httpStatus:409});for(const [slot,value] of Object.entries(assets)){if(value)db.prepare('INSERT INTO system_assets VALUES(?,?,?,?) ON CONFLICT(slot) DO UPDATE SET mime=excluded.mime,bytes=excluded.bytes,digest=excluded.digest').run(slot,value.mime,value.bytes,value.digest);else db.prepare('DELETE FROM system_assets WHERE slot=?').run(slot);}db.prepare('UPDATE system_settings SET data=?,revision=revision+1 WHERE id=1').run(JSON.stringify(data));db.prepare('INSERT INTO system_settings_audit VALUES(?,?,?)').run(actor,input.revision+1,new Date().toISOString());db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}return read();
 };
 return {read,asset,save};
}
export function renderSystemBranding(html,info){
 html=html.replace(/<title>[^<]*<\/title>/,()=>'<title>'+escape(info.title)+'</title>');
 html=html.replace('href="/favicon.ico"',()=>'href="'+escape(info.icon_url)+'"');
 html=html.replace('id="brandName">MainAPIs',()=>'id="brandName">'+escape(info.brand)).replace('id="brandSystemName">商品运营台',()=>'id="brandSystemName">'+escape(info.name));
 html=html.replace('aria-label="商品运营台首页"',()=>'aria-label="'+escape(info.name)+'首页"');
 html=html.replace('id="loginHeading">商品整理一次，<br>经营更轻松。',()=>'id="loginHeading">'+escape(info.login_heading));html=html.replace('id="loginDescription">从货源资料到商城商品，在一个工作空间里完成整理、审核与发布。',()=>'id="loginDescription">'+escape(info.description));
 if(info.logo_url)html=html.replace('<b id="brandMark">m<span>·</span></b>',()=>'<img id="brandLogo" class="brand-logo" src="'+escape(info.logo_url)+'" alt=""><b id="brandMark" class="hidden">m<span>·</span></b>');
 else html=html.replace('<b id="brandMark">','<img id="brandLogo" class="brand-logo hidden" alt=""><b id="brandMark">');
 return html;
}
