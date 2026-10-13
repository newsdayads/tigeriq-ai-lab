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
  expect(source.length).toBeLessThan(60000);
});
it('classifies protected release-controller files as updater impacts, not unrelated Core files',()=>{
  for(const file of ['scripts/tigeriq-core/update-core-runtime.ps1',
    'scripts/tigeriq-core/pc01-release-guard.ps1',
    'scripts/tigeriq-core/pc01-release-preflight.mjs',
    'scripts/tigeriq-core/bootstrap-watchdog.ps1',
    'scripts/tigeriq-core/install-core-updater.ps1']){
    expect(source).toContain("'"+file+"'");
  }
  expect(source).toContain('Where-Object{$_ -in $updaterFiles}');
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
