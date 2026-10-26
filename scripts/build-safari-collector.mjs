import {safariCollectorVersion} from '../public/collector-version.js';
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
const root=fileURLToPath(new URL('../',import.meta.url));
const source=join(root,'extensions/1688-collector');
const destination=resolve(process.argv[2]||join(root,'dist/safari-collector'));
await mkdir(destination,{recursive:true});
const manifest=JSON.parse(await readFile(join(source,'manifest.json'),'utf8'));
manifest.name='MainAPIs · Safari 采集助手';
manifest.version=safariCollectorVersion;
const iconSizes=[16,32,48,64,96,128,256,512,1024];
manifest.icons=Object.fromEntries(iconSizes.map(size=>[String(size),`icons/icon-${size}.png`]));
manifest.action.default_icon={'16':'icons/icon-16.png','32':'icons/icon-32.png'};
await mkdir(join(destination,'icons'),{recursive:true});
// Opaque RGB PNGs; reproducible without image libraries or network access.
execFileSync('python3',['-c',`import struct,zlib,pathlib,sys
root=pathlib.Path(sys.argv[1])
def chunk(t,b):
 return struct.pack('>I',len(b))+t+b+struct.pack('>I',zlib.crc32(t+b)&0xffffffff)
for n in [16,32,48,64,96,128,256,512,1024]:
 rows=[]
 for y in range(n):
  row=bytearray([0])
  for x in range(n):
   u,v=x/n,y/n
   # White M and collection tray on a solid green background.
   mark=(.20<u<.29 and .23<v<.65) or (.71<u<.80 and .23<v<.65) or (.29<=u<=.5 and abs(v-(.23+(u-.29)*1.4))<.055) or (.5<u<=.71 and abs(v-(.524-(u-.5)*1.4))<.055) or (.20<u<.80 and .73<v<.80)
   row.extend((245,248,245) if mark else (36,86,66))
  rows.append(bytes(row))
 data=b'\\x89PNG\\r\\n\\x1a\\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',n,n,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(b''.join(rows),9))+chunk(b'IEND',b'')
 (root/('icon-%s.png'%n)).write_bytes(data)
`,join(destination,'icons')]);
manifest.host_permissions=['https://ops.mainapis.com/*','https://detail.1688.com/*'];
await writeFile(join(destination,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
await copyFile(join(source,'version-bridge.js'),join(destination,'version-bridge.js'));
await copyFile(join(source,'collector.js'),join(destination,'collector.js'));
let js=await readFile(join(source,'popup.js'),'utf8');
js=js.replace("import {fillMerchant554Images} from './merchant-images.js';",'const extensionApi=globalThis.browser ?? globalThis.chrome;');
js=js.slice(0,js.indexOf("$('#merchantImagesFile').onchange="));
js=js.replaceAll('chrome.','extensionApi.');
await writeFile(join(destination,'popup.js'),js);
let html=await readFile(join(source,'popup.html'),'utf8');
html=html.replace(/<details><summary>修复已发布商品 554[\s\S]*?<\/details>/,'');
html=html.replace(/试用版 [0-9.]+/,'Safari 测试版 '+safariCollectorVersion);
html=html.replace('等待采集','请先允许此扩展访问 1688 和 OPS；在 Safari 打开商品详情页后点击读取。');
await writeFile(join(destination,'popup.html'),html);
const css=await readFile(join(source,'popup.css'),'utf8');
await writeFile(join(destination,'popup.css'),css+'\n/* Safari sizes its popover from intrinsic document dimensions. Do not clamp to the initial viewport. */html{width:380px;min-width:380px;box-sizing:border-box}body{width:380px;min-width:380px;padding:18px;box-sizing:border-box;overflow-x:hidden}h1{word-break:normal;overflow-wrap:normal}.actions>button{flex:1 1 auto}button{min-height:44px}.actions{flex-wrap:wrap}textarea{font-size:16px}img{max-width:100%}\n');
await copyFile(join(root,'docs/safari-collector.md'),join(destination,'README.md'));
// An explicit file list keeps old build artifacts and credentials out of the upload.
const zip=destination+'.zip';
execFileSync('python3',['-c',`import zipfile,sys,pathlib
root=pathlib.Path(sys.argv[1])
with zipfile.ZipFile(sys.argv[2],'w',zipfile.ZIP_DEFLATED) as z:
 for name in ['manifest.json','version-bridge.js','collector.js','popup.js','popup.html','popup.css','README.md']:
  z.write(root/name,name)
 for icon in sorted((root/'icons').glob('icon-*.png')):
  z.write(icon,icon.relative_to(root))
`,destination,zip]);
console.log(zip);
