import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const script=readFileSync(new URL('../scripts/tigeriq-core/update-core-runtime.ps1',import.meta.url),'utf8');

test('updater never relies on Nullable HasValue/Value',()=>{
  assert.doesNotMatch(script,/\.HasValue\b|\.Value\b/);
  assert.match(script,/\$oldPid=if\(\$oldCore\)\{\[int\]\$oldCore\.pid\}else\{\$null\}/);
  assert.match(script,/previousCorePid=\$oldPid/);
});

test('updater ensures node_modules deterministically and fails closed',()=>{
  assert.match(script,/Ensure-NodeModules/);
  assert.match(script,/--ignore-scripts --no-audit --no-fund/);
});

test('updater is path aware for core, web control, coding lane, and OpenClaw',()=>{
  assert.match(script,/function Get-Impact/);
  assert.match(script,/apps\/tigeriq-coding-lane/);
  assert.match(script,/web-control/);
  assert.match(script,/coreRestarted=\$impact\.core/);
  assert.match(script,/webRestarted=\$impact\.web/);
  assert.match(script,/codingRestarted=\$impact\.coding/);
  assert.match(script,/apps\/openclaw-tigeriq-runtime\//);
  assert.match(script,/\$openclawTask='TigerIQ OpenClaw Gateway'/);
  assert.match(script,/function Restart-OpenClawGateway/);
  assert.match(script,/Test-TcpPort '127\.0\.0\.1' 18789/);
  assert.match(script,/openclawRestarted=\$impact\.openclaw/);
  assert.match(script,/OPENCLAW_GATEWAY_HEALTH_FAILED/);
});
