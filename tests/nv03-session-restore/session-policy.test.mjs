import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { classifyNv03Session, planNv03SessionRecovery, NV03_SESSION_STATES } from '../../scripts/nv03-session-restore/session-policy.mjs';

const healthy={
  activeSessionId:1,
  chrome:{listening:true,sessionId:1,scopeMatched:true},
  sidecar:{listening:true,sessionId:1,scopeMatched:true},
};

describe('NV03 interactive-session recovery policy',()=>{
  it('treats interactive 9223/8823 runtime as healthy and idempotent',()=>{
    expect(classifyNv03Session(healthy).state).toBe(NV03_SESSION_STATES.HEALTHY_INTERACTIVE);
    expect(planNv03SessionRecovery(healthy).actions).toEqual([]);
  });

  it('classifies healthy ports in Session 0 as WRONG_WINDOWS_SESSION',()=>{
    const snapshot={...healthy,chrome:{...healthy.chrome,sessionId:0},sidecar:{...healthy.sidecar,sessionId:0}};
    expect(classifyNv03Session(snapshot).state).toBe(NV03_SESSION_STATES.WRONG_WINDOWS_SESSION);
    expect(planNv03SessionRecovery(snapshot).actions).toEqual([
      'STOP_NV03_SIDECAR_WRONG_SESSION',
      'STOP_NV03_CHROME_WRONG_SESSION',
      'START_NV03_CHROME_INTERACTIVE',
      'START_NV03_SIDECAR_INTERACTIVE',
      'VERIFY_NV03_INTERACTIVE',
    ]);
  });

  it('fails closed on non-NV03 process ownership instead of stopping it',()=>{
    const snapshot={...healthy,chrome:{...healthy.chrome,scopeMatched:false}};
    expect(classifyNv03Session(snapshot).state).toBe(NV03_SESSION_STATES.SCOPE_MISMATCH);
    expect(planNv03SessionRecovery(snapshot).actions).toEqual([]);
  });

  it('requires a real interactive session',()=>{
    const snapshot={...healthy,activeSessionId:0};
    expect(classifyNv03Session(snapshot).state).toBe(NV03_SESSION_STATES.NO_INTERACTIVE_SESSION);
    expect(planNv03SessionRecovery(snapshot).actions).toEqual([]);
  });

  it('rebuilds an incomplete scoped runtime without shared App Chrome mutation',()=>{
    const snapshot={...healthy,sidecar:{listening:false,sessionId:null,scopeMatched:true}};
    expect(classifyNv03Session(snapshot).state).toBe(NV03_SESSION_STATES.NOT_RUNNING);
    expect(planNv03SessionRecovery(snapshot).actions).toEqual([
      'STOP_NV03_PARTIAL_SCOPED_RUNTIME',
      'START_NV03_CHROME_INTERACTIVE',
      'START_NV03_SIDECAR_INTERACTIVE',
      'VERIFY_NV03_INTERACTIVE',
    ]);
  });

  it('PowerShell restore is NV03-only and never calls shared restore',()=>{
    const restore=readFileSync('scripts/nv03-session-restore/Start-NV03-InteractiveRestore.ps1','utf8');
    const module=readFileSync('scripts/nv03-session-restore/NV03-SessionRestore.psm1','utf8');
    const install=readFileSync('scripts/nv03-session-restore/Install-NV03-InteractiveTask.ps1','utf8');
    expect(restore).not.toContain('Restore-AppChrome-Windows.ps1');
    expect(restore).not.toMatch(/NV02|NV04/);
    expect(restore).toContain('--remote-debugging-port=9223');
    expect(restore).toContain('"--profile-directory=`"$ProfileDirectory`""');
    expect(restore).not.toContain('"--profile-directory=$ProfileDirectory"');
    expect(restore).toContain("Wait-Nv03Port -Port 8823");
    expect(restore).toContain('--window-position=$WindowLeft,$WindowTop');
    expect(restore).toContain('NV03_INTERACTIVE_SESSION_REQUIRED');
    expect(module).toContain('WTSGetActiveConsoleSessionId');
    expect(module).toContain('WRONG_WINDOWS_SESSION');
    expect(module).toContain('NV03_SCOPE_MISMATCH_REFUSE_STOP');
    expect(install).toContain('-LogonType Interactive');
    expect(install).toContain('New-ScheduledTaskTrigger -AtLogOn');
    expect(install).toContain('Export-ScheduledTask');
    expect(install).toContain('DisableLegacyTask');
    expect(install).not.toMatch(/NV02|NV04/);
  });
});
