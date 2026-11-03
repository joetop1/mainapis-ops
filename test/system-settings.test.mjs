import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openStore} from '../core.mjs';
import {systemSettings,systemAdministrator,renderSystemBranding,DEFAULT_SYSTEM_INFO} from '../system-settings.mjs';
export const pixel='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhWQAAAAASUVORK5CYII=';
test('系统管理员必须明确指定，单账号白名单兼容，多账号无隐式提升',()=>{
 assert.equal(systemAdministrator('a',['a']),true);assert.equal(systemAdministrator('b',['a']),false);assert.equal(systemAdministrator('a',['a','b']),false);assert.equal(systemAdministrator('a',['a','b'],'a'),true);assert.equal(systemAdministrator('b',['a','b'],'a'),false);assert.equal(systemAdministrator('a',['a'],''),false);assert.equal(systemAdministrator(null,['a'],'a'),false);
});
test('名称图标同事务保存，摘要地址变化、版本冲突与重启持久化',()=>{
 const dir=mkdtempSync(join(tmpdir(),'ops-branding-')),path=join(dir,'db.sqlite');let db=openStore(path);try{const info=systemSettings(db),old=info.read();assert.equal(old.icon_url,'/favicon.ico');const saved=info.save({...old,name:'我的系统',title:'商品运营系统',icon:{data:pixel},logo:{data:pixel}},'admin');assert.equal(saved.revision,1);assert.match(saved.icon_url,/system-assets\/icon\?v=/);assert.equal(info.asset('icon').mime,'image/png');assert.throws(()=>info.save(old,'admin'),/已被更新/);db.close();db=openStore(path);assert.equal(systemSettings(db).read().name,'我的系统');assert.equal(systemSettings(db).asset('logo').mime,'image/png');}finally{db.close();rmSync(dir,{recursive:true,force:true});}
});
test('图片伪装、SVG、超大图片与空名称拒绝，失败不改原有资产',()=>{
 const db=openStore(':memory:');try{const info=systemSettings(db),initial=info.read(),svg={data:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString('base64')};for(const changes of [{name:''},{icon:svg},{logo:svg,icon:{data:pixel}},{icon:{data:'!'.repeat(100)}},{icon:{data:Buffer.alloc(1024*1024+1).toString('base64')}}]){assert.throws(()=>info.save({...initial,...changes},'admin'));assert.equal(info.read().revision,0);assert.equal(info.asset('icon'),undefined);}
 const huge=Buffer.from(pixel,'base64');huge.writeUInt32BE(99999,16);assert.throws(()=>info.save({...initial,icon:{data:huge.toString('base64')}},'admin'),/尺寸/);
 const stored=info.save({...initial,icon:{data:pixel},logo:{data:pixel}},'admin'),cleared=info.save({...stored,icon:null,logo:null},'admin');assert.equal(cleared.icon_url,'/favicon.ico');assert.equal(cleared.logo_url,'');assert.equal(db.prepare('SELECT COUNT(*) n FROM system_settings_audit').get().n,2);
 }finally{db.close();}
});
test('首屏HTML转义品牌文案及替换符，默认或自定义logo均有稳定DOM节点',()=>{
 const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8'),info={...DEFAULT_SYSTEM_INFO,title:'<script>危险</script> $&',brand:'$`<品牌>',name:'应用"<>',login_heading:'第一行\n第二行',icon_url:'/api/system-assets/icon?v=123',logo_url:'/api/system-assets/logo?v=456'};const rendered=renderSystemBranding(html,info);assert.ok(rendered.includes('<title>&lt;script&gt;危险&lt;/script&gt; $&amp;</title>'));assert.ok(rendered.includes('id="brandName">$`&lt;品牌&gt;'));assert.ok(rendered.includes('第一行\n第二行'));assert.ok(rendered.includes('class="brand-logo" src="/api/system-assets/logo?v=456"'));const normal=renderSystemBranding(html,{...info,logo_url:''});assert.equal((normal.match(/id="brandLogo"/g)||[]).length,1);assert.ok(normal.includes('class="brand-logo hidden"'));
});
test('ICO仅用于站点图标，真实目录边界校验后持久保存',()=>{
 const png=Buffer.from(pixel,'base64'),ico=Buffer.alloc(22+png.length);ico.writeUInt16LE(1,2);ico.writeUInt16LE(1,4);ico[6]=1;ico[7]=1;ico.writeUInt16LE(1,10);ico.writeUInt16LE(32,12);ico.writeUInt32LE(png.length,14);ico.writeUInt32LE(22,18);png.copy(ico,22);const db=openStore(':memory:');try{const info=systemSettings(db),saved=info.save({...info.read(),icon:{data:ico.toString('base64')}},'admin');assert.equal(saved.icon_mime,'image/x-icon');assert.throws(()=>info.save({...saved,logo:{data:ico.toString('base64')}},'admin'),/仅支持/);const corrupt=Buffer.from(ico);corrupt.writeUInt32LE(999999,18);assert.throws(()=>info.save({...saved,icon:{data:corrupt.toString('base64')}},'admin'),/范围/);}finally{db.close();}
});
