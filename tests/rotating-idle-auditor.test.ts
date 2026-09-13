import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Auditor } from '../apps/tigeriq-core/core.mjs';

describe('Rotating Idle Auditor', () => {
  let mockPool;
  let auditor;

  beforeEach(() => {
    vi.useFakeTimers();
    mockPool = {
      query: vi.fn().mockImplementation(async (sql, params) => {
        if (sql.includes('select * from tigeriq_resources')) {
          return {
            rows: [
              { employee_id: 'NV02', enabled: true, health_state: 'ONLINE', credential_state: 'OK', current_job_id: null, work_state: 'IDLE' },
              { employee_id: 'NV11', enabled: true, health_state: 'ONLINE', credential_state: 'WAIT_KEY', current_job_id: null, work_state: 'IDLE' },
              { employee_id: 'NV12', enabled: true, health_state: 'ONLINE', credential_state: 'OK', current_job_id: 'JOB-1', work_state: 'BUSY' },
              { employee_id: 'NV13', enabled: true, health_state: 'RATE_LIMITED', credential_state: 'OK', current_job_id: null, work_state: 'IDLE' },
              { employee_id: 'NV14', enabled: true, health_state: 'ONLINE', credential_state: 'OK', current_job_id: null, work_state: 'IDLE' }
            ]
          };
        }
        if (sql.includes('tigeriq_events') && sql.includes('RESOURCE_FAILURE')) {
          return { rows: [] };
        }
        if (sql.includes('insert into tigeriq_events')) {
          return { rows: [] };
        }
        return { rows: [] };
      })
    };
    auditor = new Auditor(mockPool, { lightIntervalMs: 300000, deepIntervalMs: 1800000 });
  });

  afterEach(() => {
    auditor.stop();
    vi.useRealTimers();
  });

  it('verifies auditor runs on correct 5-minute and 30-minute intervals', async () => {
    const scanSpy = vi.spyOn(auditor, 'scan').mockResolvedValue(undefined);
    auditor.start();

    expect(scanSpy).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(300000);
    expect(scanSpy).toHaveBeenCalledWith('light');

    await vi.advanceTimersByTimeAsync(1500000);
    expect(scanSpy).toHaveBeenCalledWith('deep');
  });

  it('checks that only eligible resources are selected', async () => {
    const eligible = await auditor.getEligibleResources();
    const ids = eligible.map(r => r.employee_id);
    
    // NV02 (ONLINE -> IDLE) and NV14 (ONLINE -> IDLE) should be eligible.
    // NV11 is WAIT_KEY, NV12 has current_job_id (BUSY), NV13 is RATE_LIMITED -> excluded.
    expect(ids).toContain('NV02');
    expect(ids).toContain('NV14');
    expect(ids).not.toContain('NV11');
    expect(ids).not.toContain('NV12');
    expect(ids).not.toContain('NV13');
  });

  it('confirms deduplication logic prevents duplicate heartbeats within the same interval', async () => {
    const querySpy = mockPool.query;
    await auditor.scan('light');
    const initialCallCount = querySpy.mock.calls.length;

    // Re-running scan immediately with same timestamp hash should trigger deduplication and perform no new inserts
    await auditor.scan('light');
    const subsequentCallCount = querySpy.mock.calls.length;

    // Only database queries for selecting resources/events should occur, no duplicate inserts for same hash
    expect(subsequentCallCount).toBeLessThan(initialCallCount * 2);
  });

  it('ensures the auditor does not invoke any write-oriented core functions', async () => {
    const scanSpy = vi.spyOn(auditor, 'scan');
    auditor.start();
    await vi.advanceTimersByTimeAsync(300000);
    
    expect(scanSpy).toHaveBeenCalled();
    // Check that mock pool only received read selects and auditor event logs, no resource updates or job mutations
    const allSql = mockPool.query.mock.calls.map(c => c[0]);
    for (const sql of allSql) {
      expect(sql).not.toContain('update tigeriq_resources');
      expect(sql).not.toContain('update tigeriq_jobs');
      expect(sql).not.toContain('delete from');
    }
  });

  it('validates that the auditor can be started, stopped, and restarted without losing state', async () => {
    expect(auditor.isRunning).toBe(false);
    auditor.start();
    expect(auditor.isRunning).toBe(true);

    auditor.stop();
    expect(auditor.isRunning).toBe(false);

    auditor.start();
    expect(auditor.isRunning).toBe(true);
    expect(auditor.processedHashes).toBeInstanceOf(Set);
  });
});
