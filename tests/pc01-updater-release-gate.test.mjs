import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const source = readFileSync(new URL('../scripts/tigeriq-core/update-core-runtime.ps1', import.meta.url), 'utf8');

it('retains one updater loop and guarded rollout gate', () => {
  expect(source.match(/function Gates-Pass/g)).toHaveLength(1);
  expect(source.match(/function Get-ReleaseApproval/g)).toHaveLength(1);
  expect(source.match(/function Get-Impact/g)).toHaveLength(1);
  expect(source.match(/while\(\$true\)\{/g)).toHaveLength(1);
  expect(source.length).toBeLessThan(65000);
});
it('cannot release on GitHub CI or merge alone', () => {
  const gate = source.indexOf('$releaseApproval=Get-ReleaseApproval $remote $local $impact');
  const refusal = source.indexOf("result='WAIT_RELEASE_APPROVAL'", gate);
  const apply = source.indexOf('Ensure-RuntimeSource $remote', gate);
  expect(gate).toBeGreaterThan(0);
  expect(refusal).toBeGreaterThan(gate);
  expect(apply).toBeGreaterThan(refusal);
  expect(source).toContain("reason='RELEASE_LOCAL_APPROVAL_MISSING'");
  expect(source).toContain("reason='RELEASE_TARGET_MISMATCH'");
  expect(source).toContain("reason='RELEASE_BASELINE_MISMATCH'");
  expect(source).toContain("reason='RELEASE_IMPACT_OUT_OF_SCOPE'");
  expect(source).toContain("reason='RELEASE_COMPONENTS_MISMATCH'");
});
it('records attempt before applying candidate to prevent repeated failed rollout', () => {
  const a = source.indexOf("Save-ReleaseAttempt $releaseApproval.requestId $remote $previousRuntimeSha 'STARTED'");
  const b = source.indexOf('Ensure-RuntimeSource $remote', a);
  expect(a).toBeGreaterThan(0);
  expect(b).toBeGreaterThan(a);
  expect(source).toContain("reason='RELEASE_ATTEMPT_ALREADY_RECORDED'");
  expect(source).toContain("Save-ReleaseAttempt $releaseApproval.requestId $remote $previousRuntimeSha 'COMMITTED'");
  expect(source).toContain("Save-ReleaseAttempt $releaseApproval.requestId $remote $previousRuntimeSha 'ROLLED_BACK'");
});
it('never controls local-only App Chrome in release gate', () => {
  const block = source.slice(source.indexOf('function Get-ReleaseApproval'),source.indexOf('function Gates-Pass'));
  expect(block).not.toMatch(/Start-ScheduledTask|Stop-ScheduledTask|APP Chrome Unified|shell_exec|git reset/);
  expect(source).toContain("reason='APP_CHROME_EXTERNAL_LOCAL_ONLY'");
});
it('parses in real PowerShell where available', () => {
  const available=spawnSync('pwsh',['-NoLogo','-NoProfile','-NonInteractive','-Command','$PSVersionTable.PSVersion.Major'],{encoding:'utf8'});
  if(available.error?.code==='ENOENT') return;
  expect(available.status).toBe(0);
  const command='$errorsFound=$null; [System.Management.Automation.Language.Parser]::ParseFile($args[0],[ref]$null,[ref]$errorsFound)|Out-Null; if($errorsFound.Count -gt 0){$errorsFound|Out-String|Write-Error; exit 1}';
  const path=new URL('../scripts/tigeriq-core/update-core-runtime.ps1',import.meta.url).pathname;
  const parsed=spawnSync('pwsh',['-NoLogo','-NoProfile','-NonInteractive','-Command',command,path],{encoding:'utf8'});
  expect(parsed.status,parsed.stderr||parsed.stdout).toBe(0);
});
