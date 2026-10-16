// GH-2293: make the existing standalone Node.js R08 mock suite visible to
// canonical root Vitest CI. This subprocess must NEVER execute a real Apify API.
import {expect, it} from 'vitest';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const suite=fileURLToPath(new URL(
  '../../apps/revenue-lab/apify-website-audit/apify-private-e2e.test.mjs',
  import.meta.url,
));

// Protect the isolated test subprocess even if a future source edit accidentally
// removes a mock fetchFn. This static import is only a network-denial preload,
// never a live API/Actor request. Node 20 (GitHub CI) supports --import.
const offlinePreload='data:text/javascript,'+encodeURIComponent(
  "globalThis.fetch=async()=>{throw new Error('APIFY_NATIVE_OFFLINE_NETWORK_DENIED')};",
);

it('GH-2293 runs all 20 original R08 node:test mock cases natively with network denied',()=>{
  const env={...process.env};
  for(const key of Object.keys(env)){
    if(key.startsWith('APIFY_')||key==='NODE_OPTIONS')delete env[key];
  }
  env.NO_COLOR='1';
  const run=spawnSync(process.execPath,[
    '--import',offlinePreload,'--test',suite,
  ],{
    cwd:fileURLToPath(new URL('../../',import.meta.url)),
    env,input:'',encoding:'utf8',timeout:20000,maxBuffer:1024*1024,
    windowsHide:true,
  });
  expect(run.error?.message).toBeUndefined();
  expect(run.signal).toBeNull();
  expect(run.status,'Native offline R08 node:test failed: '+String(run.stderr||'').slice(0,400)).toBe(0);
  // A successful process without full TAP enumeration is NOT acceptance.
  expect(run.stdout).toMatch(/(?:^|\n)# tests 20(?:\n|$)/);
  expect(run.stdout).toMatch(/(?:^|\n)# pass 20(?:\n|$)/);
  expect(run.stdout).toMatch(/(?:^|\n)# fail 0(?:\n|$)/);
  expect(run.stdout).toMatch(/(?:^|\n)# cancelled 0(?:\n|$)/);
  expect(run.stdout).toMatch(/(?:^|\n)# skipped 0(?:\n|$)/);
  expect(run.stdout).not.toContain('secret-token-value');
},25000);
