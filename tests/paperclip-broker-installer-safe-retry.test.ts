import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

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
    const keepalive = script.indexOf("(Test-TrueHeartbeatFlag $live.wslKeepaliveRunning)");
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
      "(Test-PositiveHeartbeatId $live.sessionId)",
      "(Test-PositiveHeartbeatId $live.pid)",
      "(Test-PositiveHeartbeatId $live.wslKeepalivePid)",
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
      "(Test-PositiveHeartbeatId $h.sessionId)",
      "(Test-PositiveHeartbeatId $h.pid)",
      "(Test-PositiveHeartbeatId $h.wslKeepalivePid)",
      '(Test-TrueHeartbeatFlag $h.wslKeepaliveRunning)',
      '$heartbeatAt -ge $InstallStartedAt',
      'TIGERIQ_PAPERCLIP_WSL_BROKER_HEARTBEAT_TIMEOUT',
    ]) {
      expect(script).toContain(expected);
    }
  });
});

const ps7 = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.Major'], {
  encoding: 'utf8', timeout: 10000,
});
const realPowerShellIt = ps7.status === 0 || process.env.CI === 'true' ? it : it.skip;

describe('R07 fail-closed installer heartbeat types', () => {
  it('checks typed identifiers and keepalive in both reuse and startup paths', () => {
    const reuse = script.slice(script.indexOf("if($existing -and [string]$existing.State"), script.indexOf('if($existing){'));
    const fresh = script.slice(script.indexOf('for($i=0;$i -lt 80;'), script.indexOf('if(-not $ready)'));
    for (const field of ['sessionId', 'pid', 'wslKeepalivePid']) {
      expect(reuse).toContain(`(Test-PositiveHeartbeatId $live.${field})`);
      expect(fresh).toContain(`(Test-PositiveHeartbeatId $h.${field})`);
      expect(reuse).not.toContain(`[int]$live.${field}`);
      expect(fresh).not.toContain(`[int]$h.${field}`);
    }
    expect(reuse).toContain('(Test-TrueHeartbeatFlag $live.wslKeepaliveRunning)');
    expect(fresh).toContain('(Test-TrueHeartbeatFlag $h.wslKeepaliveRunning)');
    expect(reuse).not.toContain('[bool]$live.wslKeepaliveRunning');
    expect(fresh).not.toContain('[bool]$h.wslKeepaliveRunning');
  });

  realPowerShellIt('rejects JSON strings, booleans, fractions and unsafe IDs in isolated pwsh', () => {
    const from = script.indexOf('function Test-PositiveHeartbeatId(');
    const to = script.indexOf('\nif(-not (Test-Path -LiteralPath $Broker', from);
    expect(from).toBeGreaterThan(0);
    expect(to).toBeGreaterThan(from);
    const cases = [
      { kind: 'id', value: 1, good: true },
      { kind: 'id', value: 9077, good: true },
      { kind: 'id', value: 9007199254740991, good: true },
      ...[null, 0, -1, '2', '9077', '1.5', 1.5, true, false, 9007199254740992]
        .map(value => ({ kind: 'id', value, good: false })),
      { kind: 'flag', value: true, good: true },
      ...[false, 'true', 'false', 1, 0, null]
        .map(value => ({ kind: 'flag', value, good: false })),
    ];
    const code = [
      "$ErrorActionPreference='Stop'",
      script.slice(from, to),
      `$cases = @('${JSON.stringify(cases)}' | ConvertFrom-Json)`,
      'foreach ($row in $cases) {',
      "  $actual = if ($row.kind -eq 'id') { Test-PositiveHeartbeatId $row.value } else { Test-TrueHeartbeatFlag $row.value }",
      "  if ($actual -ne $row.good) { throw ('HEARTBEAT_TYPE_GATE_FAILED: ' + $row.kind + '/' + [string]$row.value) }",
      '}',
      "Write-Output 'R07_TYPES_PASS'",
    ].join('\n');
    const result = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', code], {
      encoding: 'utf8', timeout: 15000,
    });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('R07_TYPES_PASS');
  });
});
