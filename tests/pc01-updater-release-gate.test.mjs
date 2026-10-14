import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const updaterUrl=new URL('../scripts/tigeriq-core/update-core-runtime.ps1',import.meta.url);
const guardUrl=new URL('../scripts/tigeriq-core/pc01-release-guard.ps1',import.meta.url);
const source=readFileSync(updaterUrl,'utf8');
const guard=readFileSync(guardUrl,'utf8');

it('preserves single updater loop and small isolated release gate',()=>{
  expect(source.match(/function Gates-Pass/g)).toHaveLength(1);
  expect(source.match(/function Get-Impact/g)).toHaveLength(1);
  expect(source.match(/while\(\$true\)\{/g)).toHaveLength(1);
  expect(guard.match(/function Get-ReleaseApproval/g)).toHaveLength(1);
  expect(guard.match(/function Save-ReleaseAttempt/g)).toHaveLength(1);
  expect(source.length).toBeLessThan(62000);
});
it('fails closed when local release guard or approval is missing',()=>{
  const guardLoad=source.indexOf('. $releaseGuardScript');
  const gate=source.indexOf('$releaseApproval=Get-ReleaseApproval $remote $local $impact');
  const refuse=source.indexOf("result='WAIT_RELEASE_APPROVAL'",gate);
  const apply=source.indexOf('Ensure-RuntimeSource $remote',gate);
  expect(source).toContain("releaseGateReason='RELEASE_GUARD_SCRIPT_MISSING'");
  expect(guardLoad).toBeGreaterThan(0);
  expect(gate).toBeGreaterThan(guardLoad);
  expect(refuse).toBeGreaterThan(gate);
  expect(apply).toBeGreaterThan(refuse);
  for(const reason of ['RELEASE_LOCAL_APPROVAL_MISSING','RELEASE_TARGET_MISMATCH','RELEASE_BASELINE_MISMATCH','RELEASE_IMPACT_OUT_OF_SCOPE','RELEASE_COMPONENTS_MISMATCH']){
    expect(guard).toContain("reason='"+reason+"'");
  }
});
it('preserves baseline and one-shot receipt before source mutation',()=>{
  const guardStart=source.indexOf("Save-ReleaseAttempt $releaseApproval.requestId $remote $local 'STARTED'");
  const baseline=source.indexOf('$previousRuntimeSha=$local',guardStart);
  const apply=source.indexOf('Ensure-RuntimeSource $remote',baseline);
  expect(guardStart).toBeGreaterThan(0);
  expect(baseline).toBeGreaterThan(guardStart);
  expect(apply).toBeGreaterThan(baseline);
  expect(guard).toContain("reason='RELEASE_ATTEMPT_ALREADY_RECORDED'");
  expect(source).toContain("Save-ReleaseAttempt $releaseApproval.requestId $remote $previousRuntimeSha 'COMMITTED'");
  expect(source).toContain("Save-ReleaseAttempt $releaseApproval.requestId $remote $previousRuntimeSha 'ROLLED_BACK'");
});
it('keeps existing App Chrome outside the release guard',()=>{
  expect(guard).not.toMatch(/Start-ScheduledTask|Stop-ScheduledTask|APP Chrome Unified|shell_exec|git reset/);
  expect(source).toContain("reason='APP_CHROME_EXTERNAL_LOCAL_ONLY'");
});
it('PowerShell parses both installed and helper files on supported CI runners',()=>{
  const available=spawnSync('pwsh',['-NoLogo','-NoProfile','-NonInteractive','-Command','$PSVersionTable.PSVersion.Major'],{encoding:'utf8'});
  if(available.error?.code==='ENOENT')return;
  expect(available.status).toBe(0);
  for(const url of [updaterUrl,guardUrl]){
    const escaped=fileURLToPath(url).replaceAll("'","''");
    const command="$errorsFound=$null; [System.Management.Automation.Language.Parser]::ParseFile('"+escaped+"',[ref]$null,[ref]$errorsFound)|Out-Null; if($errorsFound.Count -gt 0){$errorsFound|Out-String|Write-Error; exit 1}";
    const parsed=spawnSync('pwsh',['-NoLogo','-NoProfile','-NonInteractive','-Command',command],{encoding:'utf8'});
    expect(parsed.status,parsed.stderr||parsed.stdout).toBe(0);
  }
});

it('never imports an unapproved watchdog source into protected execution before local approval',()=>{
  expect(source).toContain("$bootstrapWatchdogRuntime='C:\\ProgramData\\TigerIQCoreRelease\\BootstrapWatchdog\\bootstrap-watchdog.ps1'");
  expect(source).toContain("reason='PROTECTED_WATCHDOG_BOOTSTRAP_MISSING'");
  const startup=source.indexOf('$bootstrapWatchdog=if(Test-Path -LiteralPath $runtimeRepo){Ensure-BootstrapWatchdogTask}');
  const approved=source.indexOf('$releaseApproval=Get-ReleaseApproval');
  const refresh=source.indexOf('Ensure-BootstrapWatchdogTask -AllowSourceRefresh');
  expect(startup).toBeGreaterThan(0);
  expect(approved).toBeGreaterThan(startup);
  expect(refresh).toBeGreaterThan(approved);
  expect(source).toContain('if($AllowSourceRefresh){');
});

it('maps all five explicit release-maintenance script paths to Updater impact',()=>{
  const impact=source.match(/\$updater=\[bool\]\(@\(\$paths\|Where-Object\{[^\n]+/);
  expect(impact?.[0]||'').toContain('scripts/tigeriq-core/pc01-release-guard.ps1');
  for(const pathname of ['scripts/tigeriq-core/update-core-runtime.ps1','scripts/tigeriq-core/pc01-release-preflight.mjs','scripts/tigeriq-core/bootstrap-watchdog.ps1','scripts/tigeriq-core/install-core-updater.ps1']){
    expect(impact?.[0]||'').toContain(pathname);
  }
});

it('V2 maps Owner display-only and Web Control changes to Core without weakening legacy gates',()=>{
  const fn=source.slice(source.indexOf('function Get-Impact('),source.indexOf('function Restart-UpdaterAfterExit('));
  expect(fn).toContain("-or $web");
  expect(fn).toContain("apps/shared/owner-(interaction-v6|one-tap-approval)");
  expect(fn).toContain("apps/dashboard/src/bcct.mjs");
  expect(fn).toContain("public/(work-center(-visual)?|work-ui)");
  expect(fn).toContain("scripts/package-bcct-runtime.mjs");
});


it('recognizes the real five-profile RDC 0.2.52 pool without falsely patching its supervisor',()=>{
  const begin=source.indexOf('function Get-RemoteDesktopExternalPool(){');
  const end=source.indexOf('function Reconcile-RemoteDesktopGuard(){',begin);
  expect(begin).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(begin);
  const probe=source.slice(begin,end);
  expect(probe).toContain('rdc-pool-supervisor.ps1');
  expect(probe).toContain('rdc-pool-worker.ps1');
  expect(probe).toContain('@wonderwhy-er/desktop-commander@0');
  expect(probe).toContain('2\\.52');
  expect(probe).toContain('RDC01.*RDC02.*RDC03.*RDC04.*RDC05');
  expect(probe).toContain("reason='RDC_PINNED_FIVE_PROFILE_POOL'");
  expect(probe).toContain("guardVerification='NOT_APPLICABLE_TO_EXTERNAL_POOL'");
  expect(probe).not.toContain('Stop-ScheduledTask');
  expect(probe).not.toContain('Start-ScheduledTask');
  const entry=source.slice(end,end+290);
  expect(entry).toContain('Get-RemoteDesktopExternalPool');
  expect(entry).toContain('if($externalPool){return $externalPool}');
  // Any unrecognized/altered launcher falls through to the old fail-closed path.
  expect(entry).toContain('remoteDesktopGuardInstaller');
});


it('five 0.2.52 RDC tasks are validated independently; legacy pooled task may stay disabled',()=>{
  const begin=source.indexOf('function Get-RemoteDesktopExternalPool(){');
  const end=source.indexOf('function Reconcile-RemoteDesktopGuard(){',begin);
  const probe=source.slice(begin,end);
  expect(probe).not.toContain('Get-ScheduledTask -TaskName $remoteDesktopTask');
  for(const number of ['01','02','03','04','05']){
    expect(probe).toContain('TigerIQ RDC'+number+' Remote');
  }
  expect(probe).toContain('foreach($name in $taskNames)');
  expect(probe).toContain("if([string]$task.State -ne 'Running')");
  expect(probe).toContain("reason='RDC_PINNED_FIVE_PROFILE_POOL'");
  expect(probe).toContain("guardVerification='NOT_APPLICABLE_TO_EXTERNAL_POOL'");
  expect(probe).not.toMatch(/\b(?:Stop|Start|Restart)-ScheduledTask\b/);
});

it('RDC partial/drifted external pool never falls back to legacy installer or touches sessions',()=>{
  const begin=source.indexOf('function Get-RemoteDesktopExternalPool(){');
  const end=source.indexOf('function Reconcile-RemoteDesktopGuard(){',begin);
  const probe=source.slice(begin,end);
  const entry=source.slice(end,end+260);
  expect(probe).toContain("if($existing.Count -eq 0 -and $present.Count -eq 0){return $null}");
  for(const reason of [
    'RDC_EXTERNAL_POOL_INCOMPLETE',
    'RDC_EXTERNAL_POOL_LAUNCHER_DRIFT',
    'RDC_EXTERNAL_POOL_SOURCE_DRIFT',
    'RDC_EXTERNAL_POOL_TASK_NOT_RUNNING',
    'RDC_EXTERNAL_POOL_READ_ERROR',
  ]) expect(probe).toContain(reason);
  expect(entry).toContain('if($externalPool){return $externalPool}');
  expect(entry).toContain('remoteDesktopGuardInstaller');
  expect(probe).not.toMatch(/(?:Copy-Item|Set-Content|Remove-Item|Start-Process|Stop-Process)/);
});
