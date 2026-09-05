import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const script = readFileSync(new URL('../scripts/pc-worker/harden-pc01-prelogin-autostart.ps1', import.meta.url), 'utf8');

describe('#368 PC01 Worker + Watchdog pre-login hardening', () => {
  it('locks the fresh PC01 action paths instead of inventing a new runtime', () => {
    expect(script).toContain(String.raw`$ExpectedWorkerPython = 'C:\Users\wdragons12x\AppData\Local\Programs\Python\Python312\python.exe'`);
    expect(script).toContain(String.raw`$ExpectedWorkerLauncher = 'F:\TigerIQ\Worker\worker.py'`);
    expect(script).toContain(String.raw`$ExpectedWatchdogScript = 'F:\TigerIQ\Worker\watchdog.ps1'`);
    expect(script).toContain(String.raw`$ExpectedWatchdogArgs = '-NoProfile -ExecutionPolicy Bypass -File F:\TigerIQ\Worker\watchdog.ps1'`);
    expect(script).toContain("Fail 'WORKER_LAUNCHER_UNEXPECTED'");
    expect(script).toContain("Fail 'WATCHDOG_ARGUMENTS_UNEXPECTED'");
  });

  it('moves both tasks to SYSTEM + startup while retaining the watchdog 1-minute loop', () => {
    expect(script).toContain("New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest");
    expect(script.match(/New-ScheduledTaskTrigger -AtStartup/g)?.length).toBeGreaterThanOrEqual(2);
    expect(script).toContain('-RepetitionInterval (New-TimeSpan -Minutes 1)');
    expect(script).toContain("watchdog='SYSTEM_AT_STARTUP_REPEAT_1M'");
  });

  it('backs up both task definitions before any task mutation and has deterministic rollback', () => {
    const workerBackup = script.indexOf('Export-ScheduledTask -TaskName $WorkerTaskName');
    const watchdogBackup = script.indexOf('Export-ScheduledTask -TaskName $WatchdogTaskName');
    const mutation = script.indexOf('$mutationStarted = $true');
    expect(workerBackup).toBeGreaterThan(-1);
    expect(watchdogBackup).toBeGreaterThan(-1);
    expect(mutation).toBeGreaterThan(workerBackup);
    expect(mutation).toBeGreaterThan(watchdogBackup);
    expect(script).toContain('Register-ScheduledTask -TaskName $WorkerTaskName -Xml ([IO.File]::ReadAllText($workerBackup)) -Force');
    expect(script).toContain('Register-ScheduledTask -TaskName $WatchdogTaskName -Xml ([IO.File]::ReadAllText($watchdogBackup)) -Force');
    expect(script).toContain("$rollback = 'ROLLBACK_OK'");
  });

  it('is fail-closed, plan-first and idempotent after the desired contract is already present', () => {
    const ready = script.indexOf('if ($workerReady -and $watchdogReady)');
    const applyGate = script.indexOf('if (-not $Apply)');
    const mutation = script.indexOf('$mutationStarted = $true');
    expect(ready).toBeGreaterThan(-1);
    expect(applyGate).toBeGreaterThan(ready);
    expect(mutation).toBeGreaterThan(applyGate);
    expect(script).toContain("status='READY'; apply=$Apply.IsPresent; mutated=$false");
    expect(script).toContain("status='PLAN'; apply=$false; mutated=$false");
    expect(script).toContain("Fail 'WRONG_HOST' 'This package is restricted to PC01.'");
    expect(script).toContain("Fail 'ADMIN_REQUIRED'");
  });

  it('does not widen network, credentials, repository release or reboot scope', () => {
    expect(script).not.toContain('New-NetFirewallRule');
    expect(script).not.toContain('Remove-NetFirewallRule');
    expect(script).not.toContain('workforce-admin.secret');
    expect(script).not.toContain('git push');
    expect(script).not.toContain('Restart-Computer');
    expect(script).not.toContain('shutdown.exe');
  });
});
