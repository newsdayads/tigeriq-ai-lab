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
  assert.match(script,/Use only tigeriq_runtime and tigeriq_pc\./);
  assert.match(script,/action=task_status taskName=TigerIQ OpenClaw Gateway/);
  assert.match(script,/action=tcp_probe host=127\.0\.0\.1 port=18789/);
  assert.match(script,/action=shell_exec shell=cmd cwd=D:\\\\TigerIQ command=D:\\\\OpenClaw\\npm-global\\openclaw\.cmd --version/);
  assert.match(script,/action=file_write path=D:\\\\TigerIQ\\State\\openclaw-pc-operator-canary\.txt/);
  assert.match(script,/TIGERIQ_OPENCLAW_PC_OPERATOR_PASS/);
  assert.match(script,/PC_OPERATOR_E2E_PASS/);
  assert.match(script,/rawOutputPublished=false/);
  assert.match(script,/\$previous\.installedSha -eq \$installedSha/);
  assert.match(script,/\$previous\.treeSha -eq \$treeSha/);
  assert.match(script,/--timeout 90/);
  assert.match(script,/openclawCanary=\$openclawCanary/);
  assert.match(script,/reported=\$reported/);
  assert.match(script,/if\(-not \$previousReported\)/);
  assert.doesNotMatch(script,/^\)\{\$result=/m);
});


test('updater restores owner-resumed APP Chrome before OpenClaw acceptance gating',()=>{
  assert.match(script,/OWNER_RUNTIME_RESUME=true/);
  assert.match(script,/function Invoke-AppChromeOwnerResume/);
  assert.match(script,/\/api\/resume/);
  assert.match(script,/\/api\/workers\/NV02\/unblock/);
  assert.match(script,/\/api\/start-all/);
  assert.match(script,/TIGERIQ_APP_CHROME_RUNTIME_RECOVERY_V1/);
  assert.match(script,/NV02_RUNTIME_RESUMED/);
  const recovery=script.indexOf('$appChromeRecovery=Invoke-AppChromeOwnerResume');
  const reconcile=script.indexOf('$openclawReconcile=if($runtimeExists)');
  assert.ok(recovery>=0 && reconcile>recovery,'APP Chrome recovery must run before OpenClaw reconcile/canary gating');
});
