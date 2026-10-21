import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const script = readFileSync(
  new URL('../apps/openclaw-tigeriq-runtime/Install-PaperclipWslBroker.ps1', import.meta.url), 'utf8',
);

// GH-2054: source-only contract tests; do not interact with PC01 or restart tasks.
describe('Paperclip R07 installer: preserve a healthy owned broker on repeat invocation', () => {
  it('fails with the scoped missing-script error before hashing or altering tasks', () => {
    const missing = script.indexOf("TIGERIQ_PAPERCLIP_WSL_BROKER_SCRIPT_MISSING");
    const hash = script.indexOf('$ExpectedBrokerSha256=(Get-FileHash');
    const task = script.indexOf('$existing=Get-ScheduledTask');
    expect(missing).toBeGreaterThan(0);
    expect(hash).toBeGreaterThan(missing);
    expect(task).toBeGreaterThan(hash);
  });

  it('short-circuits before Stop-ScheduledTask when a running broker has a fresh matching heartbeat', () => {
    const running = script.indexOf("[string]$existing.State -eq 'Running'");
    const verify = script.indexOf("[string]$live.sourceSha256 -ceq $ExpectedBrokerSha256");
    const keepalive = script.indexOf("[bool]$live.wslKeepaliveRunning -eq $true");
    const exit = script.indexOf('      exit 0');
    const stop = script.indexOf('  Stop-ScheduledTask');
    const discard = script.indexOf('Remove-Item -LiteralPath $Heartbeat');
    const register = script.indexOf('Register-ScheduledTask');
    expect(running).toBeGreaterThan(0);
    expect(verify).toBeGreaterThan(running);
    expect(keepalive).toBeGreaterThan(verify);
    expect(exit).toBeGreaterThan(keepalive);
    expect(stop).toBeGreaterThan(exit);
    expect(discard).toBeGreaterThan(stop);
    expect(register).toBeGreaterThan(discard);
  });

  it('requires the same interactive user, source identity, session and bounded heartbeat age', () => {
    for (const expected of [
      "[string]$live.schema -eq 'TIGERIQ_PAPERCLIP_WSL_HEARTBEAT_V1'",
      "[string]$live.version -eq $ExpectedBrokerVersion",
      "[string]$live.sourceSha256 -ceq $ExpectedBrokerSha256",
      "[string]$live.user -ieq $expectedUserName",
      "[int]$live.sessionId -gt 0",
      "[int]$live.pid -gt 0",
      "[int]$live.wslKeepalivePid -gt 0",
      '$ageSec -ge -2 -and $ageSec -le 15',
    ]) {
      expect(script).toContain(expected);
    }
    expect(script).toContain("([string]$user -split '\\\\')[-1]");
    expect(script).toContain('Get-Content -Raw -LiteralPath $Heartbeat | ConvertFrom-Json');
  });

  it('keeps the guarded fallback install, restart, and fresh running-source heartbeat verification', () => {
    for (const expected of [
      'Stop-ScheduledTask -TaskName $TaskName',
      'Register-ScheduledTask -TaskName $TaskName',
      'Start-ScheduledTask -TaskName $TaskName',
      'New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited',
      "[string]$h.sourceSha256 -ceq $ExpectedBrokerSha256",
      '[bool]$h.wslKeepaliveRunning -eq $true',
      '$heartbeatAt -ge $InstallStartedAt',
      'TIGERIQ_PAPERCLIP_WSL_BROKER_HEARTBEAT_TIMEOUT',
    ]) {
      expect(script).toContain(expected);
    }
  });
});
