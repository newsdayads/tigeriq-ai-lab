import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const packageJson=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
const buildConfig=JSON.parse(readFileSync(new URL('../tsconfig.build.json',import.meta.url),'utf8'));

test('#4410 frozen App Chrome server has no repository runtime entrypoint',()=>{
  assert.equal(packageJson.scripts?.['chrome-controller'],undefined);
});

test('#4410 production build excludes only the frozen App Chrome server entrypoint',()=>{
  assert.ok(buildConfig.exclude.includes('apps/chrome-controller/src/server.ts'));
  assert.ok(!buildConfig.exclude.includes('apps/chrome-controller/**'));
});

test('#4410 NV03/NV04 owner coordination entrypoint remains available',()=>{
  assert.equal(
    packageJson.scripts?.['nv0304:owner-cycle'],
    'node dist/apps/chrome-controller/src/nv03-nv04-owner-sidecar.js'
  );
});
