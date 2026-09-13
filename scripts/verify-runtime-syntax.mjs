import {readdirSync,readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
import {Script} from 'node:vm';

let checked=0;
function walk(dir) {
  for(const entry of readdirSync(dir,{withFileTypes:true})) {
    const path=join(dir,entry.name);
    if(entry.isDirectory()){walk(path);continue;}
    if(/\.(mjs|js)$/.test(path)){
      const r=spawnSync(process.execPath,['--check',path],{encoding:'utf8'});
      if(r.status!==0)throw new Error(path+'\n'+r.stdout+r.stderr);
      checked++;
    }
    if(path.endsWith('.html')){
      const html=readFileSync(path,'utf8');
      for(const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
        if(/\bsrc\s*=/.test(m[1])||!m[2].trim())continue;
        new Script(m[2],{filename:path});checked++;
      }
    }
  }
}
for(const dir of ['apps','api','scripts','src','public'])walk(dir);
console.log(JSON.stringify({check:'runtime-syntax',checked,sha:process.env.TESTED_SHA||null}));
