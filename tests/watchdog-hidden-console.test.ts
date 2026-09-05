import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('scripts/pc-worker/hide-worker-watchdog-console.ps1', 'utf8');

describe('#368 hidden watchdog console repair', () => {
  it('targets only the one-minute Watchdog action and preserves its script path', () => {
    expect(source).toContain("$TaskName = 'TigerIQ Worker Watchdog'");
    expect(source).toContain("$ExpectedScript = 'F:\\TigerIQ\\Worker\\watchdog.ps1'");
    expect(source).toContain("-NoProfile -ExecutionPolicy Bypass -File F:\\TigerIQ\\Worker\\watchdog.ps1");
  });

  it('makes PowerShell hidden and non-interactive without widening task authority', () => {
    expect(source).toContain('-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File F:\\TigerIQ\\Worker\\watchdog.ps1');
    expect(source).toContain('Set-ScheduledTask -TaskName $TaskName -Action $newAction');
    expect(source).not.toContain('New-ScheduledTaskPrincipal');
    expect(source).not.toContain('New-ScheduledTaskTrigger');
    expect(source).not.toContain('-Principal $');
  });

  it('fails closed on action drift and verifies principal/trigger identity after apply', () => {
    expect(source).toContain("Fail 'WATCHDOG_ARGUMENTS_UNEXPECTED'");
    expect(source).toContain("Fail 'WATCHDOG_EXECUTE_UNEXPECTED'");
    expect(source).toContain("Fail 'PRINCIPAL_DRIFT'");
    expect(source).toContain("Fail 'TRIGGER_DRIFT'");
    expect(source).toContain('Get-PrincipalSignature $after');
    expect(source).toContain('Get-TriggerSignature $after');
  });

  it('is dry-run by default and has deterministic backup/rollback', () => {
    expect(source).toContain("status = 'PLAN'");
    expect(source).toContain('if (-not $Apply)');
    expect(source).toContain('Export-ScheduledTask -TaskName $TaskName');
    expect(source).toContain('Register-ScheduledTask -TaskName $TaskName -Xml');
    expect(source).toContain("$rollback = 'ROLLBACK_OK'");
  });

  it('does not claim physical acceptance from repo-only execution', () => {
    expect(source).toContain('physicalVerified = $false');
    expect(source).toContain("3_CONSECUTIVE_1M_CYCLES_NO_POPUP_NO_FOCUS_STEAL_WATCHDOG_HEALTHY");
  });
});
