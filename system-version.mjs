import {readFile,readdir} from 'node:fs/promises';
import {join,relative} from 'node:path';
import {createHash} from 'node:crypto';
// Fingerprint only shipped application files; never read .env, data or credentials.
export async function systemVersion(root){
 const pkg=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
 const files=['package.json',...(await readdir(root)).filter(name=>name.endsWith('.mjs'))];
 async function visit(directory){for(const entry of await readdir(directory,{withFileTypes:true})){const path=join(directory,entry.name);if(entry.isDirectory())await visit(path);else if(entry.isFile())files.push(relative(root,path));}}
 await visit(join(root,'public'));await visit(join(root,'extensions/1688-collector'));
 const hash=createHash('sha256');
 for(const name of files.sort()){const data=await readFile(join(root,name));hash.update(name+'\0'+data.length+'\0');hash.update(data);}
 return {version:pkg.version,build:hash.digest('hex').slice(0,12)};
}
