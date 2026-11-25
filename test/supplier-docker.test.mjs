import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir,mkdtemp,mkdir,copyFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
test('按镜像COPY规则隔离的货盘解析器可以加载全部本地依赖',async()=>{
 const docker=await readFile(new URL('../Dockerfile',import.meta.url),'utf8');
 const line=docker.split('\n').find(line=>line.startsWith('COPY ')&&line.endsWith(' ./scripts/'));
 assert(line,'镜像必须包含解析器脚本');
 const patterns=line.split(/\s+/).filter(part=>part.startsWith('scripts/'));
 const available=await readdir(new URL('../scripts/',import.meta.url));
 const selected=new Set(patterns.flatMap(pattern=>pattern==='scripts/*.py'?available.filter(name=>name.endsWith('.py')):[pattern.slice('scripts/'.length)]));
 const dir=await mkdtemp(join(tmpdir(),'ops-parser-image-'));
 try{
  await mkdir(join(dir,'scripts'));
  for(const name of selected)await copyFile(new URL('../scripts/'+name,import.meta.url),join(dir,'scripts',name));
  const python=process.env.PYTHON_BIN||'python3';
  execFileSync(python,['-c',"import sys,runpy;sys.path.insert(0,'scripts');runpy.run_path('scripts/parse-supplier-xlsx.py',run_name='supplier_parser_smoke')"],{cwd:dir});
  assert(selected.has('supplier_variant_blocks.py'));
 }finally{await rm(dir,{recursive:true,force:true});}
});
