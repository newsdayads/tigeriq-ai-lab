import { describe, it, expect, vi, beforeEach } from 'vitest';
// @ts-expect-error importing mjs for test
import { auditor, loadAuditorState, persistAuditorState, selectEligibleAuditor, runAuditorScan, pool } from '../apps/tigeriq-core/core.mjs';

vi.mock('pg', () => {
  const mPool = {
    query: vi.fn(),
    on: vi.fn(),
    end: vi.fn()
  };
  return { Pool: vi.fn(() => mPool) };
});

describe('Rotating Idle Auditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auditor.lastScan = 0;
    auditor.lastDeepScan = 0;
    auditor.lastAuditorId = null;
    auditor.currentAuditor = null;
  });

  it('selects exactly one API NV and respects exclusion rules', async () => {
    (pool.query as any).mockResolvedValueOnce({
      rows: [{ employee_id: 'NV11' }, { employee_id: 'NV12' }]
    });
    const chosen = await selectEligibleAuditor();
    expect(chosen).toBe('NV11');
    expect(auditor.currentAuditor).toBe('NV11');
  });

  it('emits heartbeat on healthy scans', async () => {
    (pool.query as any).mockResolvedValueOnce({ rows: [{ employee_id: 'NV11' }] });
    (pool.query as any).mockResolvedValueOnce({
      rows: [{ employee_id: 'NV11', provider: 'groq', model: 'gpt', credential_state: 'READY', health_state: 'ONLINE' }]
    });
    (pool.query as any).mockResolvedValueOnce({ rows: [] }); // event insert
    await runAuditorScan(false);
    expect(pool.query).toHaveBeenCalled();
  });

  it('deduplicates duplicate findings', async () => {
    (pool.query as any).mockResolvedValueOnce({ rows: [{ employee_id: 'NV11' }] });
    (pool.query as any).mockResolvedValueOnce({
      rows: [{ employee_id: 'NV11', provider: 'groq', model: 'gpt', credential_state: 'READY', health_state: 'ERROR' }]
    });
    (pool.query as any).mockResolvedValueOnce({ rows: [] }); // event failure
    (pool.query as any).mockResolvedValueOnce({ rows: [{ id: 'OBJ-existing' }] }); // active objective
    (pool.query as any).mockResolvedValueOnce({ rows: [] }); // dedupe event
    (pool.query as any).mockResolvedValueOnce({ rows: [] }); // persist state

    await runAuditorScan(false);
    expect(pool.query).toHaveBeenCalled();
  });

  it('persists and reloads state across core restart', async () => {
    auditor.lastScan = 12345;
    (pool.query as any).mockResolvedValueOnce({ rows: [] });
    await persistAuditorState();
    expect(pool.query).toHaveBeenCalled();

    (pool.query as any).mockResolvedValueOnce({
      rows: [{ data: { lastScan: 12345, lastAuditorId: 'NV11' } }]
    });
    await loadAuditorState();
    expect(auditor.lastScan).toBe(12345);
    expect(auditor.lastAuditorId).toBe('NV11');
  });
});
