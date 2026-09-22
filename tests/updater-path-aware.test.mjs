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

test('updater canary control flow remains single-copy and syntactically complete',()=>{
  assert.equal((script.match(/function Invoke-OpenClawCanary/g)||[]).length,1);
  assert.equal((script.match(/function Gates-Pass/g)||[]).length,1);
  assert.match(script,/if\(\$exitCode -eq 0 -and \$output -match '\(\?m\)\^\\s\*TIGERIQ_OPENCLAW_PC_OPERATOR_PASS\\s\*\$'\)\{\$result='PASS';\$reason='PC_OPERATOR_E2E_PASS'\}/);
  assert.match(script,/elseif\(\$exitCode -ne 0\)\{\$reason=\('OPENCLAW_AGENT_EXIT_'\+\$exitCode\)\}/);
  assert.match(script,/elseif\(\$output -match 'TIGERIQ_OPENCLAW_PC_OPERATOR_BLOCKED'\)\{\$reason='AGENT_REPORTED_BLOCKED'\}/);
  assert.doesNotMatch(script,/\n\)\{\$result='PASS';\$reason='PC_OPERATOR_E2E_PASS'\}/);
});

test('updater scheduled task executes the runtime self-updated copy and self-heals drift',()=>{
  const installer=readFileSync(new URL('../scripts/tigeriq-core/install-core-updater.ps1',import.meta.url),'utf8');
  assert.match(installer,/\$runtimeScript='D:\\\\TigerIQ\\Runtime\\CoreUpdater\\update-core-runtime\.ps1'/);
  assert.match(installer,/Copy-Item -LiteralPath \$sourceScript -Destination \$tmp -Force/);
  assert.match(installer,/New-ScheduledTaskAction -Execute \$ps -Argument ".*\$runtimeScript.*"/);
  assert.doesNotMatch(installer,/New-ScheduledTaskAction[^\n]+\$sourceScript/);
  assert.match(script,/function Ensure-UpdaterTaskRuntimeTarget/);
  assert.match(script,/Set-ScheduledTask -TaskName \$updaterTask -Action \$newAction/);
  assert.match(script,/if\(\$impact\.updater\)\{Sync-UpdaterRuntime;\$updaterTaskTarget=Ensure-UpdaterTaskRuntimeTarget\}/);
  assert.match(script,/updaterTaskTarget=\$updaterTaskTarget/);
  assert.match(script,/Restart-UpdaterAfterExit;exit 75/);
});

test('updater retires the stale Supervisor V2 OpenClaw lifecycle owner before reconcile',()=>{
  assert.match(script,/\$legacyAutonomySupervisorTask='TigerIQ Autonomy Supervisor V2'/);
  assert.match(script,/function Retire-LegacyOpenClawLifecycleOwner/);
  assert.match(script,/Stop-ScheduledTask -TaskName \$legacyAutonomySupervisorTask/);
  assert.match(script,/Disable-ScheduledTask -TaskName \$legacyAutonomySupervisorTask/);
  const retire=script.indexOf('$legacyLifecycleRetire=Retire-LegacyOpenClawLifecycleOwner');
  const reconcile=script.indexOf('$openclawReconcile=if($runtimeExists)');
  assert.ok(retire>=0 && reconcile>retire,'legacy lifecycle owner must be retired before OpenClaw reconcile');
  assert.match(script,/legacyLifecycleRetire=\$legacyLifecycleRetire/);
});

test('installer retires stale Supervisor V2 before starting the runtime updater',()=>{
  const installer=readFileSync(new URL('../scripts/tigeriq-core/install-core-updater.ps1',import.meta.url),'utf8');
  assert.match(installer,/\$legacyAutonomySupervisorTask='TigerIQ Autonomy Supervisor V2'/);
  assert.match(installer,/Stop-ScheduledTask -TaskName \$legacyAutonomySupervisorTask/);
  assert.match(installer,/Disable-ScheduledTask -TaskName \$legacyAutonomySupervisorTask/);
  const retire=installer.indexOf('Disable-ScheduledTask -TaskName $legacyAutonomySupervisorTask');
  const start=installer.indexOf('Start-ScheduledTask -TaskName $taskName');
  assert.ok(retire>=0 && start>retire,'legacy Supervisor V2 must be retired before updater starts');
});

test('bootstrap stops the old updater instance before re-registering its task',()=>{
  const installer=readFileSync(new URL('../scripts/tigeriq-core/install-core-updater.ps1',import.meta.url),'utf8');
  const stop=installer.indexOf('Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue');
  const register=installer.indexOf('Register-ScheduledTask -TaskName $taskName');
  const start=installer.indexOf('Start-ScheduledTask -TaskName $taskName');
  assert.ok(stop>=0 && register>stop && start>register,'old updater must be stopped before task action replacement and restart');
});
