import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {
  MANAGER_STALL_CYCLE_LIMIT,
  managerCycleGuard,
  managerProgressSinceLastCycle,
} from '../apps/tigeriq-core/manager-cycle-policy.mjs';

describe('Core manager progress-aware cycle guard',()=>{
  it('detects only terminal progress newer than the previous objective update',()=>{
    expect(managerProgressSinceLastCycle({
      latestTerminalAt:'2026-10-05T03:10:01+07:00',
      objectiveUpdatedAt:'2026-10-05T03:10:00+07:00',
    })).toBe(true);
    expect(managerProgressSinceLastCycle({
      latestTerminalAt:'2026-10-05T03:10:00+07:00',
      objectiveUpdatedAt:'2026-10-05T03:10:00+07:00',
    })).toBe(false);
    expect(managerProgressSinceLastCycle({
      latestTerminalAt:null,
      objectiveUpdatedAt:'2026-10-05T03:10:00+07:00',
    })).toBe(false);
  });

  it('does not block a progressing objective solely because lifetime cycles exceed 30',()=>{
    expect(managerCycleGuard({managerCycles:37,progressed:true})).toEqual({
      currentCycles:37,
      effectiveCycles:0,
      maxCycles:MANAGER_STALL_CYCLE_LIMIT,
      progressed:true,
      reset:true,
      blocked:false,
    });
  });

  it('still blocks bounded consecutive no-progress cycles',()=>{
    expect(managerCycleGuard({managerCycles:MANAGER_STALL_CYCLE_LIMIT-1,progressed:false}).blocked).toBe(false);
    expect(managerCycleGuard({managerCycles:MANAGER_STALL_CYCLE_LIMIT,progressed:false}).blocked).toBe(true);
  });

  it('keeps the no-progress budget durable across restart-style re-evaluation',()=>{
    const before=managerCycleGuard({managerCycles:12,progressed:false});
    const after=managerCycleGuard({managerCycles:before.effectiveCycles,progressed:false});
    expect(after.effectiveCycles).toBe(12);
    expect(after.reset).toBe(false);
  });

  it('production manager loop uses terminal progress and preserves phase reset',()=>{
    const source=readFileSync(new URL('../apps/tigeriq-core/core.mjs',import.meta.url),'utf8');
    expect(source).toContain("select max(completed_at) as latest_terminal_at");
    expect(source).toContain("status='done'");
    expect(source).not.toContain("status in ('done','failed')");
    expect(source).toContain('managerProgressSinceLastCycle');
    expect(source).toContain('MANAGER_PROGRESS_CYCLE_RESET');
    expect(source).toContain('manager_cycles=0');
  });
});
