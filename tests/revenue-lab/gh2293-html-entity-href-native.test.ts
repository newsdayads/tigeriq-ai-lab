// GH-2293: canonical CI must execute the standalone real-loopback HTTP audit regression.
// No private Apify actor, token, production endpoint, or paid API is accessed.
import {expect, it} from 'vitest';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const suite=fileURLToPath(new URL(
  '../../apps/revenue-lab/apify-website-audit/audit.test.mjs',
  import.meta.url,
));

it('GH-2293 executes bounded HTTP audit regressions against exact source',()=>{
  const env: Record<string, string | undefined>={...process.env, NO_COLOR:'1'};
  for(const key of Object.keys(env)){
    if(key.startsWith('APIFY_')||key==='NODE_OPTIONS') delete env[key];
  }
  const run=spawnSync(process.execPath,['--test',suite],{
    cwd:fileURLToPath(new URL('../../',import.meta.url)),
    env,input:'',encoding:'utf8',timeout:45000,maxBuffer:2*1024*1024,
    windowsHide:true,
  });
  expect(run.error?.message).toBeUndefined();
  expect(run.signal).toBeNull();
  expect(run.status,'Native bounded HTTP audit test failed: '+String(run.stderr||'').slice(0,700)+' '+String(run.stdout||'').slice(-1400)).toBe(0);
  expect(run.stdout).toMatch(/(?:^|\n)(?:#|ℹ) fail 0(?:\n|$)/);
  expect(run.stdout).toMatch(/(?:^|\n)(?:#|ℹ) cancelled 0(?:\n|$)/);
},50000);
