import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const script=readFileSync(new URL('../scripts/tigeriq-core/update-core-runtime.ps1',import.meta.url),'utf8');
const canary=readFileSync(new URL('../apps/openclaw-tigeriq-runtime/canary.mjs',import.meta.url),'utf8');
const zeroTouch=readFileSync(new URL('../scripts/tigeriq-core/appchrome-zero-touch.ps1',import.meta.url),'utf8');
const psVerify=readFileSync(new URL('../scripts/verify-powershell.ps1',import.meta.url),'utf8');
const bootstrapWatchdog=readFileSync(new URL('../scripts/tigeriq-core/bootstrap-watchdog.ps1',import.meta.url),'utf8');

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

test('updater uses a bounded OpenClaw startup window that covers observed PC01 latency',()=>{
  const timeout=Number(script.match(/\$openclawGatewayStartupTimeoutSec=(\d+)/)?.[1]);
  assert.ok(Number.isFinite(timeout) && timeout>=100 && timeout<=120);
  assert.match(script,/AddSeconds\(\$openclawGatewayStartupTimeoutSec\)/);
  const restartBody=script.slice(script.indexOf('function Restart-OpenClawGateway'),script.indexOf('function Reconcile-OpenClawRuntime'));
  assert.doesNotMatch(restartBody,/AddSeconds\(45\)/);
});

test('updater runs one sanitized deterministic OpenClaw canary per installed SHA and plugin tree',()=>{
  assert.match(script,/TIGERIQ_OPENCLAW_CANARY_V2/);
  assert.match(script,/function Invoke-OpenClawCanary/);
  assert.match(script,/\$openclawCanaryScript=\(Join-Path \$runtimeRepo 'apps\\openclaw-tigeriq-runtime\\canary\.mjs'\)/);
  assert.match(script,/& node \$openclawCanaryScript/);
  assert.match(script,/TIGERIQ_OPENCLAW_CANARY_EXEC_V1/);
  assert.match(script,/PC_OPERATOR_E2E_PASS/);
  assert.match(script,/rawOutputPublished=false/);
  assert.match(script,/\$previous\.installedSha -eq \$installedSha/);
  assert.match(script,/\$previous\.treeSha -eq \$treeSha/);
  assert.match(script,/openclawCanary=\$openclawCanary/);
  assert.match(script,/reported=\$reported/);
  assert.match(script,/if\(-not \$previousReported\)/);
  assert.doesNotMatch(script,/openclaw\.cmd[^\n]*\sagent\b|--agent\b|--timeout 90/);

  assert.match(canary,/runtimeAction = executeRuntimeAction/);
  assert.match(canary,/runtimeAction\(\{ action: 'core_status' \}\)/);
  assert.match(canary,/action: 'task_status', taskName: GATEWAY_TASK/);
  assert.match(canary,/action: 'tcp_probe', host: '127\.0\.0\.1', port: 18789/);
  assert.match(canary,/action: 'shell_exec'/);
  assert.match(canary,/action: 'file_write'/);
  assert.match(canary,/action: 'file_read'/);
  assert.match(canary,/TIGERIQ_OPENCLAW_CANARY_EXEC_V1/);
  assert.match(canary,/PC_OPERATOR_E2E_PASS/);
});

test('OpenClaw plugin manifest advances runtime tree for post-bootstrap canary rearm',()=>{
  const plugin=JSON.parse(readFileSync(new URL('../apps/openclaw-tigeriq-runtime/openclaw.plugin.json',import.meta.url),'utf8'));
  assert.equal(plugin.id,'tigeriq-runtime');
  assert.equal(plugin.version,'0.2.1');
  assert.deepEqual(plugin.contracts?.tools,['tigeriq_runtime','tigeriq_pc']);
});

test('updater rearms exactly one OpenClaw canary when policy generation changes',()=>{
  assert.match(script,/\$openclawCanaryPolicyGeneration='20260922_DETERMINISTIC_CANARY_2'/);
  assert.match(script,/\('policyGeneration='\+\$openclawCanaryPolicyGeneration\)/);
  assert.equal((script.match(/PSObject\.Properties\.Name -contains 'policyGeneration'/g)||[]).length,2);
  assert.equal((script.match(/\[string\]\$previous\.policyGeneration -eq \$openclawCanaryPolicyGeneration/g)||[]).length,2);
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
  const reconcile=script.indexOf("$openclawReconcile=@{action='skip';reason='runtime_missing'}");
  assert.ok(recovery>=0 && reconcile>recovery,'APP Chrome recovery must run before OpenClaw reconcile/canary gating');
});

test('updater deterministic canary control flow remains single-copy and fail-closed',()=>{
  assert.equal((script.match(/function Invoke-OpenClawCanary/g)||[]).length,1);
  assert.equal((script.match(/function Gates-Pass/g)||[]).length,1);
  assert.match(script,/ConvertFrom-Json -ErrorAction Stop/);
  assert.match(script,/DETERMINISTIC_CANARY_INVALID_SCHEMA/);
  assert.match(script,/DETERMINISTIC_CANARY_INVALID_OUTPUT/);
  assert.match(script,/DETERMINISTIC_CANARY_BLOCKED/);
  assert.match(script,/OPENCLAW_CANARY_EXIT_/);
  assert.doesNotMatch(script,/OPENCLAW_AGENT_EXIT_|AGENT_REPORTED_BLOCKED|UNEXPECTED_AGENT_REPLY/);
});

test('updater scheduled task executes the runtime self-updated copy and self-heals drift',()=>{
  const installer=readFileSync(new URL('../scripts/tigeriq-core/install-core-updater.ps1',import.meta.url),'utf8');
  assert.match(installer,/\$runtimeScript='D:\\TigerIQ\\Runtime\\CoreUpdater\\update-core-runtime\.ps1'/);
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
  const reconcile=script.indexOf("$openclawReconcile=@{action='skip';reason='runtime_missing'}");
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

test('updater performs bounded reconcile for TigerIQ Live Status Bridge without creating or reconfiguring it',()=>{
  assert.match(script,/\$liveStatusBridgeTask='TigerIQ Live Status Bridge'/);
  assert.doesNotMatch(script,/New-ScheduledTask\s+-TaskName\s+\$liveStatusBridgeTask/);
  assert.doesNotMatch(script,/Register-ScheduledTask\s+-TaskName\s+\$liveStatusBridgeTask/);
  assert.doesNotMatch(script,/Set-ScheduledTask\s+-TaskName\s+\$liveStatusBridgeTask/);
  assert.match(script,/TASK_ABSENT/);
  assert.match(script,/TASK_NOT_FOUND/);
  assert.match(script,/Start-ScheduledTask -TaskName \$liveStatusBridgeTask/);
  assert.match(script,/liveStatusBridgeReconcile=\$liveStatusBridgeReconcile/);
  assert.match(script,/stateName -ne 'Running'/);
  assert.match(script,/function Invoke-LiveStatusBridgeReconcile/);
  const steadyStateReconcile=script.indexOf('$liveStatusBridgeReconcile=Invoke-LiveStatusBridgeReconcile');
  const noChange=script.indexOf("if($runtimeExists -and $local -eq $remote)");
  assert.ok(steadyStateReconcile>=0 && noChange>steadyStateReconcile,'Live Status Bridge reconcile must run before NO_CHANGE');
  assert.equal((script.match(/\$liveStatusBridgeReconcile=Invoke-LiveStatusBridgeReconcile/g)||[]).length,1);
  assert.match(script,/result='NO_CHANGE'[^\n]+liveStatusBridgeReconcile=\$liveStatusBridgeReconcile/);
});

test('bootstrap stops the old updater instance before re-registering its task',()=>{
  const installer=readFileSync(new URL('../scripts/tigeriq-core/install-core-updater.ps1',import.meta.url),'utf8');
  const stop=installer.indexOf('Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue');
  const register=installer.indexOf('Register-ScheduledTask -TaskName $taskName');
  const start=installer.indexOf('Start-ScheduledTask -TaskName $taskName');
  assert.ok(stop>=0 && register>stop && start>register,'old updater must be stopped before task action replacement and restart');
});


test('runtime updater structural gate prevents swallowed duplicate control loops',()=>{
  assert.ok(script.length<60000,`updater unexpectedly large: ${script.length}`);
  assert.equal((script.match(/function Invoke-LiveStatusBridgeReconcile/g)||[]).length,1);
  assert.equal((script.match(/function Gates-Pass/g)||[]).length,1);
  assert.equal((script.match(/function Invoke-AppChromeZeroTouchHelper/g)||[]).length,1);
  assert.equal((script.match(/while\(\$true\)/g)||[]).length,1);
  assert.match(script,/\$appChromeZeroTouchScript=\(Join-Path \$runtimeRepo 'scripts\\tigeriq-core\\appchrome-zero-touch\.ps1'\)/);
  const helper=script.indexOf('$appChromeInstall=Invoke-AppChromeZeroTouchHelper');
  const noChange=script.indexOf("if($runtimeExists -and $local -eq $remote)");
  assert.ok(helper>=0&&noChange>helper,'zero-touch helper must run before Core NO_CHANGE');
  assert.match(script,/result='NO_CHANGE'[^\n]+appChromeInstall=\$appChromeInstall/);
});

test('required PowerShell syntax gate includes TigerIQ Core runtime scripts',()=>{
  assert.match(psVerify,/Join-Path \$PSScriptRoot 'tigeriq-core'/);
  assert.match(psVerify,/Get-ChildItem[^\n]+-Filter '\*\.ps1' -File/);
});

test('modular App Chrome zero-touch helper accepts only explicit Owner+Vy authorization',()=>{
  assert.match(zeroTouch,/TIGERIQ_APP_CHROME_INSTALL_REQUEST_V1/);
  assert.match(zeroTouch,/OWNER_DIRECT/);
  assert.match(zeroTouch,/APP_CHROME_DEPLOY_AUTHORIZED/);
  assert.match(zeroTouch,/MUTATION_OWNER/);
  assert.match(zeroTouch,/VY_OWNER_AUTHORIZED/);
  assert.match(zeroTouch,/ZERO_TOUCH_DEPLOY/);
  assert.match(zeroTouch,/TARGET_HEAD/);
  assert.match(zeroTouch,/PACKAGE_ARTIFACT_ID/);
  assert.match(zeroTouch,/PACKAGE_ARTIFACT_NAME/);
  const resolve=zeroTouch.slice(zeroTouch.indexOf('function Resolve-Request'),zeroTouch.indexOf('function Assert-Authorization'));
  assert.ok(resolve.indexOf('Discover-AuthorizedRequest')<resolve.indexOf('Read-RequestFile'),'current GitHub Owner authorization must outrank stale State request');
});

test('modular App Chrome zero-touch helper verifies provenance and exact-head gates before install',()=>{
  assert.match(zeroTouch,/actions\/artifacts\//);
  assert.match(zeroTouch,/Chrome Controller Package/);
  assert.match(zeroTouch,/APPCHROME_ARTIFACT_HEAD_MISMATCH/);
  assert.match(zeroTouch,/CI/);
  assert.match(zeroTouch,/WO-014 Queue Hygiene/);
  assert.match(zeroTouch,/WO-012\/013 Vercel Online Verify/);
  assert.match(zeroTouch,/gh run download/);
  assert.match(zeroTouch,/Install-ApprovedArtifact\.ps1/);
  assert.match(zeroTouch,/APPCHROME_DOWNLOADED_HEAD_MISMATCH/);
  const verify=zeroTouch.indexOf('$verified=Verify-Artifact $req');
  const install=zeroTouch.indexOf('& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $installer');
  assert.ok(verify>=0&&install>verify,'artifact provenance and gates must precede canonical installer');
});

test('modular App Chrome zero-touch helper waits for safe boundary, rolls back, and verifies live provenance',()=>{
  assert.match(zeroTouch,/function Wait-SafeBoundary/);
  assert.match(zeroTouch,/APPCHROME_SAFE_BOUNDARY_TIMEOUT/);
  assert.match(zeroTouch,/lastHeartbeat\.uiBusy/);
  assert.match(zeroTouch,/lastHeartbeat\.stopVisible/);
  assert.match(zeroTouch,/\/api\/pause/);
  assert.match(zeroTouch,/function Wait-ExactHead/);
  assert.match(zeroTouch,/provenanceVerified/);
  assert.match(zeroTouch,/externalWorkAutopilot/);
  assert.match(zeroTouch,/selfRun/);
  assert.match(zeroTouch,/githubSelfRun/);
  assert.match(zeroTouch,/active-deploy\.json/);
  assert.match(zeroTouch,/Start-Unified-AppChrome\.ps1/);
  assert.match(zeroTouch,/APP_CHROME_ZERO_TOUCH_INSTALL=PASS/);
  assert.match(zeroTouch,/APP_CHROME_ZERO_TOUCH_INSTALL=BLOCKED/);
  assert.match(zeroTouch,/\$req=\$null;\$paused=\$false;\$rollback=\$null/);
});

test('modular App Chrome zero-touch activation is idempotent and RDC-free',()=>{
  assert.match(zeroTouch,/TIGERIQ_APP_CHROME_INSTALL_RESULT_V1/);
  assert.match(zeroTouch,/already_installed/);
  assert.match(zeroTouch,/RDC_USED=false/);
  assert.doesNotMatch(zeroTouch,/Remote_Desktop_Commander|mcp\.desktopcommander|execute_command/);
});


test('OpenClaw degradation never blocks unrelated updater/Core/App Chrome rollout',()=>{
  assert.doesNotMatch(script,/if\(\$impact\.updater -or \$impact\.openclaw\)/);
  assert.match(script,/if\(\$impact\.openclaw\)\{/);
  assert.match(script,/OPENCLAW_DEGRADED_NONBLOCKING/);
  const pre=script.slice(script.indexOf("$openclawReconcile=@{action='skip';reason='runtime_missing'}"),script.indexOf("if($runtimeExists -and $local -eq $remote)"));
  assert.doesNotMatch(pre,/OPENCLAW_CANARY_BLOCKED[^\n]+continue/);
  const update=script.slice(script.indexOf('$coreHealth=$oldCore'),script.indexOf("$newCore=HealthInfo"));
  assert.match(update,/if\(\$impact\.openclaw\)\{/);
  assert.match(update,/OPENCLAW_FUNCTIONAL_CANARY_FAILED/);
});

test('bootstrap watchdog independently self-heals updater OpenClaw and App Chrome with bounded recovery',()=>{
  assert.match(script,/\$bootstrapWatchdogTask='TigerIQ Bootstrap Watchdog'/);
  assert.match(script,/function Ensure-BootstrapWatchdogTask/);
  assert.match(script,/Register-ScheduledTask -TaskName \$bootstrapWatchdogTask/);
  assert.match(script,/RestartCount 999/);
  assert.match(script,/bootstrapWatchdog=\$bootstrapWatchdog/);
  assert.match(bootstrapWatchdog,/TigerIQ Core Runtime Updater/);
  assert.match(bootstrapWatchdog,/TigerIQ OpenClaw Gateway/);
  assert.match(bootstrapWatchdog,/TigerIQ APP Chrome Unified/);
  assert.match(bootstrapWatchdog,/FailureThreshold=2/);
  assert.match(bootstrapWatchdog,/CooldownSeconds=300/);
  assert.match(bootstrapWatchdog,/Test-Tcp \(\[int\]\$p\)/);
  assert.match(bootstrapWatchdog,/Start-ScheduledTask -TaskName \$t\.task/);
  assert.match(bootstrapWatchdog,/BOUNDED_SELF_HEAL/);
  assert.doesNotMatch(bootstrapWatchdog,/git\s|gh\s|credential|Vercel|Production|browser\.chatgpt|WORKER=/i);
});

test('bootstrap watchdog detects a running-but-stale updater and only cleans exact updater processes',()=>{
  assert.match(bootstrapWatchdog,/TIGERIQ_BOOTSTRAP_WATCHDOG_V2/);
  assert.match(bootstrapWatchdog,/core-runtime-updater\.json/);
  assert.match(bootstrapWatchdog,/UpdaterStaleSeconds=240/);
  assert.match(bootstrapWatchdog,/UPDATER_HEARTBEAT_STALE/);
  assert.match(bootstrapWatchdog,/function Stop-ExactUpdaterProcesses/);
  assert.match(bootstrapWatchdog,/Get-CimInstance Win32_Process/);
  assert.match(bootstrapWatchdog,/\[regex\]::Escape\(\$updaterRuntime\)/);
  assert.match(bootstrapWatchdog,/Stop-Process -Id \(\[int\]\$p\.ProcessId\) -Force/);
  assert.match(bootstrapWatchdog,/STALE_UPDATER_SELF_HEAL/);
  assert.match(bootstrapWatchdog,/heartbeatAgeSec=\$heartbeat\.ageSec/);
  assert.doesNotMatch(bootstrapWatchdog,/Stop-Process[^\n]+Where-Object[^\n]*powershell/i);
});

test('updater task uses StopExisting so a stale scheduled instance cannot block a fresh start',()=>{
  const installer=readFileSync(new URL('../scripts/tigeriq-core/install-core-updater.ps1',import.meta.url),'utf8');
  assert.match(installer,/MultipleInstances StopExisting/);
  const target=script.slice(script.indexOf('function Ensure-UpdaterTaskRuntimeTarget'),script.indexOf('function Ensure-BootstrapWatchdogTask'));
  assert.match(target,/MultipleInstances StopExisting/);
  assert.match(target,/Settings\.MultipleInstances/);
  assert.match(target,/previousMultipleInstances=\$multiple/);
});

test('runtime watchdog includes OpenClaw and App Chrome transport but does not make them global update gates',()=>{
  assert.match(script,/function Ensure-OpenClawHealth/);
  assert.match(script,/function Ensure-AppChromeTransportHealth/);
  const watchdog=script.slice(script.indexOf('function Runtime-Watchdog'),script.indexOf('function Get-Impact'));
  assert.match(watchdog,/Ensure-OpenClawHealth/);
  assert.match(watchdog,/Ensure-AppChromeTransportHealth/);
  assert.match(watchdog,/8798/);
  assert.match(watchdog,/8799/);
  assert.match(watchdog,/18789/);
});
