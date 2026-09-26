import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const install = readFileSync(new URL('../scripts/pc-worker/install-workforce-controller.ps1', import.meta.url), 'utf8');
const audit = readFileSync(new URL('../scripts/pc-worker/audit-workforce-controller.ps1', import.meta.url), 'utf8');
const uninstall = readFileSync(new URL('../scripts/pc-worker/uninstall-workforce-controller.ps1', import.meta.url), 'utf8');

describe('WO-036 PC01 Workforce Controller deployment package', () => {
  it('discovers the live tailnet address, binds explicitly and never uses a wildcard', () => {
    expect(install).toContain("[string]$ControllerHost = ''");
    expect(install).toContain("& $tailscale ip -4");
    expect(install).toContain("Test-TailscaleIPv4");
    expect(install).toContain("Fail 'TAILSCALE_IP_AMBIGUOUS'");
    expect(install).toContain("Fail 'TAILSCALE_IP_MISMATCH'");
    expect(install).toContain("-LocalAddress $ControllerHost");
    expect(install).toContain("-RemoteAddress '100.64.0.0/10'");
    expect(install).not.toContain("[string]$ControllerHost = '100.97.23.87'");
    expect(audit).toContain("wildcardListener");
  });

  it('enables tailnet self-pair explicitly without exposing the admin secret', () => {
    expect(install).toContain("TIGERIQ_WORKFORCE_ALLOW_TAILNET_SELF_PAIR = '1'");
    expect(install).toContain("tailnetSelfPair = $true");
    expect(install).toContain("$SecretsDir = 'F:\\TigerIQ\\Secrets'");
    expect(install).toContain("secret = 'STORED_LOCALLY_REDACTED'");
    expect(install).not.toMatch(/Write-(Host|Output).*workforce-admin\.secret.*ReadAllText/i);
    expect(audit).toContain('tailnetSelfPairConfigured');
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
