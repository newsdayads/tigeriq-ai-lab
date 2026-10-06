import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const updaterUrl = new URL('../scripts/tigeriq-core/update-core-runtime.ps1', import.meta.url);
const watchdogUrl = new URL('../scripts/tigeriq-core/bootstrap-watchdog.ps1', import.meta.url);

describe('RDC updater post-reboot self-heal', () => {
  it('lets a manually/native launched updater recreate its AtStartup SYSTEM task', async () => {
    const source = await readFile(updaterUrl, 'utf8');
    expect(source).toContain('TIGERIQ_UPDATER_TASK_SELF_HEAL_V1');
    expect(source).toContain("Register-ScheduledTask -TaskName $updaterTask");
    expect(source).toContain("New-ScheduledTaskTrigger -AtStartup");
    expect(source).toContain("New-ScheduledTaskPrincipal -UserId 'SYSTEM'");
    expect(source).toContain("-RunLevel Highest");
    expect(source).toContain("-MultipleInstances IgnoreNew");
    expect(source).toContain("RestartCount 999");
    expect(source).toContain("updaterTaskTarget=if($runtimeExists){Ensure-UpdaterTaskRuntimeTarget}");
  });

  it('lets Bootstrap Watchdog recreate and immediately start a missing updater task', async () => {
    const source = await readFile(watchdogUrl, 'utf8');
    expect(source).toContain('TIGERIQ_UPDATER_TASK_SELF_HEAL_V1');
    expect(source).toContain("function Ensure-UpdaterTask()");
    expect(source).toContain("Register-ScheduledTask -TaskName $updaterTask");
    expect(source).toContain("Start-ScheduledTask -TaskName $updaterTask");
    expect(source).toContain("New-ScheduledTaskTrigger -AtStartup");
    expect(source).toContain("New-ScheduledTaskPrincipal -UserId 'SYSTEM'");
    expect(source).toContain("-MultipleInstances IgnoreNew");
    expect(source).toContain("UPDATER_TASK_RECREATED");
    expect(source).toContain('Stop-ExactUpdaterProcesses');
    expect(source).toContain("Stop-ScheduledTask -TaskName $t.task");
    expect(source).toContain("Start-ScheduledTask -TaskName $t.task");
  });
  it('reconciles RDC lifecycle to one launcher plus one local MCP child with a one-shot generation marker', async () => {
    const source = await readFile(updaterUrl, 'utf8');
    expect(source).toContain("remoteDesktopLifecycleGeneration='20260930_TOPOLOGY_2'");
    expect(source).toContain('function Get-RemoteDesktopRuntimeProcesses()');
    expect(source).toContain("$cmd=[string]$_.CommandLine");
    expect(source).toContain("$cmd.ToLowerInvariant().Contains($needle)");
    expect(source).not.toContain("[string]$_.CommandLine.ToLowerInvariant().Contains($needle)");
    expect(source).toContain('function Get-RemoteDesktopLauncherProcesses()');
    expect(source).toContain('function Stop-RemoteDesktopRuntimeProcesses()');
    expect(source).toContain('function Restart-RemoteDesktopTaskClean');
    expect(source).toContain("$topologyHealthy=($launcherCount -eq 1 -and $runtimeCount -eq 2)");
    expect(source).toContain("$needsLifecycleRepair=(-not $lifecycleCurrent) -or (-not $topologyHealthy)");
    expect(source).toContain("reason='guard_current_topology_healthy'");
    expect(source).toContain('Save-RemoteDesktopLifecycleGeneration');
  });

  it('tolerates an idempotent RDC installer result without an authorizer property', async () => {
    const source = await readFile(updaterUrl, 'utf8');
    expect(source).toContain("$result.PSObject.Properties.Name -contains 'authorizer'");
    expect(source).toContain("'tigeriq_authorize_mutation'");
  });

  it('self-heals the Web Control scheduled task before the runtime watchdog', async () => {
    const source = await readFile(updaterUrl, 'utf8');
    expect(source).toContain('function Ensure-WebTaskRuntimeTarget()');
    expect(source).toContain("Join-Path $webRuntime 'run-web-control-bundle.ps1'");
    expect(source).toContain("New-ScheduledTaskPrincipal -UserId 'SYSTEM'");
    expect(source).toContain('-AllowStartIfOnBatteries');
    expect(source).toContain('-DontStopIfGoingOnBatteries');
    expect(source).toContain('$webTaskTarget=Ensure-WebTaskRuntimeTarget');
    expect(source.indexOf('$webTaskTarget=Ensure-WebTaskRuntimeTarget')).toBeLessThan(source.indexOf('$watchdog=Runtime-Watchdog'));
  });

});
