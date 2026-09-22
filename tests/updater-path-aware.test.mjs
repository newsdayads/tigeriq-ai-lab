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
  assert.match(script,/TIGERIQ_OPENCLAW_RUNTIME_V1/);
  assert.match(script,/HEAD:apps\/openclaw-tigeriq-runtime/);
  assert.match(script,/function Reconcile-OpenClawRuntime/);
  assert.match(script,/openclawReconcile=\$openclawReconcile/);
});

test('updater emits one sanitized OpenClaw typed-tool canary per installed SHA and plugin tree',()=>{
  assert.match(script,/TIGERIQ_OPENCLAW_CANARY_V2/);
  assert.match(script,/function Invoke-OpenClawCanary/);
  assert.match(script,/\$openclawAgent='operator-local'/);
  assert.match(script,/Use only tigeriq_runtime\. Call core_status exactly once\./);
  assert.match(script,/TIGERIQ_OPENCLAW_PC_OPERATOR_PASS/);
  assert.match(script,/rawOutputPublished=false/);
  assert.match(script,/actions=core_status,shell_exec,file_write,file_read/);
  assert.match(script,/pcShellCommand=Write-Output TIGERIQ_PC_SHELL_OK/);
  assert.match(script,/openclaw-pc-operator-canary\\.txt/);
  assert.match(script,/PC_OPERATOR_E2E_PASS/);
  assert.match(script,/\$previous\.installedSha -eq \$installedSha/);
  assert.match(script,/\$previous\.treeSha -eq \$treeSha/);
  assert.match(script,/--timeout 90/);
  assert.match(script,/openclawCanary=\$openclawCanary/);
  assert.match(script,/reported=\$reported/);
  assert.match(script,/if\(-not \$previousReported\)/);
});
