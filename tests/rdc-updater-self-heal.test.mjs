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
    expect(source).toContain("-MultipleInstances StopExisting");
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
    expect(source).toContain("-MultipleInstances StopExisting");
    expect(source).toContain("UPDATER_TASK_RECREATED");
  });
});
