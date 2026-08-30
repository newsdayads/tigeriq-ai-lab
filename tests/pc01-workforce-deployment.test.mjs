import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const install = readFileSync(new URL('../scripts/pc-worker/install-workforce-controller.ps1', import.meta.url), 'utf8');
const audit = readFileSync(new URL('../scripts/pc-worker/audit-workforce-controller.ps1', import.meta.url), 'utf8');
const uninstall = readFileSync(new URL('../scripts/pc-worker/uninstall-workforce-controller.ps1', import.meta.url), 'utf8');

describe('WO-036 PC01 Workforce Controller deployment package', () => {
  it('binds to the explicit PC01 tailnet address and never a wildcard', () => {
    expect(install).toContain("[string]$ControllerHost = '100.97.23.87'");
    expect(install).toContain("$ControllerHost -in @('0.0.0.0','::','127.0.0.1','localhost')");
    expect(install).toContain("-LocalAddress $ControllerHost");
    expect(install).toContain("-RemoteAddress '100.64.0.0/10'");
  });

  it('stores the admin secret outside the repo and never prints its value', () => {
    expect(install).toContain("$SecretsDir = 'F:\\TigerIQ\\Secrets'");
    expect(install).toContain("secret = 'STORED_LOCALLY_REDACTED'");
    expect(install).not.toMatch(/Write-(Host|Output).*workforce-admin\.secret.*ReadAllText/i);
    expect(audit).toContain('secretPresent = Test-Path $SecretPath');
  });

  it('installs an at-startup SYSTEM task with bounded restart and fails closed on dirty repo', () => {
    expect(install).toContain("$principalTask = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest");
    expect(install).toContain('$trigger = New-ScheduledTaskTrigger -AtStartup');
    expect(install).toContain('-RestartCount 10');
    expect(install).toContain("Fail 'REPO_DIRTY'");
    expect(install).toContain('pull --ff-only origin main');
  });

  it('rollback leaves durable Workforce state and credential secret intact', () => {
    expect(uninstall).toContain("Remove-Item -LiteralPath $RunnerPath -Force");
    expect(uninstall).not.toContain('Remove-Item -LiteralPath $SecretPath');
    expect(uninstall).not.toContain('workforce.jsonl');
    expect(uninstall).toContain('workforceStateRetained = $true');
    expect(uninstall).toContain('localCredentialSecretRetained = $true');
  });
});
