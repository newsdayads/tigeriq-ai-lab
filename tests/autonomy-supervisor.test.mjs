import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {isRetryableFailure,shouldRetry,isStaleJob,repairInstruction} from '../apps/tigeriq-coding-lane/autonomy-supervisor.mjs';

describe('Autonomy supervisor policy',()=>{
  it('retries CI failures but not arbitrary blockers',()=>{
    expect(isRetryableFailure('CI_GATES_FAILED')).toBe(true);
    expect(isRetryableFailure('CI_GATES_TIMEOUT')).toBe(true);
    expect(isRetryableFailure('NO_FREE_API_CODING_RESOURCE')).toBe(false);
    expect(isRetryableFailure('CREDENTIAL_MISSING')).toBe(false);
  });

  it('enforces a bounded objective retry budget',()=>{
    expect(shouldRetry(1,3)).toBe(true);
    expect(shouldRetry(2,3)).toBe(true);
    expect(shouldRetry(3,3)).toBe(false);
  });

  it('detects only old active jobs as stale',()=>{
    const now=Date.parse('2026-09-12T02:00:00Z');
    expect(isStaleJob({status:'running',started_at:'2026-09-12T01:00:00Z'},now,45*60*1000)).toBe(true);
    expect(isStaleJob({status:'waiting_ci',started_at:'2026-09-12T01:50:00Z'},now,45*60*1000)).toBe(false);
    expect(isStaleJob({status:'failed',started_at:'2026-09-12T01:00:00Z'},now,45*60*1000)).toBe(false);
  });

  it('preserves scope while adding machine-readable repair context',()=>{
    const text=repairInstruction({instruction:'Fix target',failure:{message:'CI_GATES_FAILED'}},'CI_GATES_FAILED',2);
    expect(text).toContain('Fix target');
    expect(text).toContain('AUTONOMOUS_REPAIR_CYCLE=2');
    expect(text).toContain('PREVIOUS_FAILURE=CI_GATES_FAILED');
    expect(text).toContain('Do not broaden scope');
  });
});

describe('Runtime updater watchdog wiring',()=>{
  const src=readFileSync('scripts/tigeriq-core/update-core-runtime.ps1','utf8');
  it('checks and heals only canonical services with bounded cooldown',()=>{
    expect(src).toContain("Ensure-ServiceHealth 'core'");
    expect(src).toContain("Ensure-ServiceHealth 'web'");
    expect(src).toContain("Ensure-ServiceHealth 'coding'");
    expect(src).toContain('$healthFailures[$key]-lt 2');
    expect(src).toContain('$healCooldownSec=300');
  });
  it('kills surviving child node processes and verifies a new PID',()=>{
    expect(src).toContain('function Stop-NodeProcessesByMatch');
    expect(src).toContain('function Get-NodePidByMatch');
    expect(src).toContain("$codingPath=(Join-Path $repo 'apps\\tigeriq-coding-lane\\coding-entry.mjs')");
    expect(src).toContain("$webPath=(Join-Path $webRuntime 'web-control-server.mjs')");
    expect(src).toContain('([int]$newPid-ne[int]$oldPid)');
    expect(src).toContain('CODING_LANE_HEALTH_OR_PID_FAILED');
    expect(src).toContain('WEB_CONTROL_HEALTH_OR_PID_FAILED');
  });
  it('self-restarts updater after updater source changes',()=>{
    expect(src).toContain('Restart-UpdaterAfterExit');
    expect(src).toContain("$updaterTask='TigerIQ Core Runtime Updater'");
  });
});
