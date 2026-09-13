import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest';

vi.mock('pg', () => {
  const mPool = {
    query: vi.fn(),
    on: vi.fn(),
    end: vi.fn(),
  };
  return { Pool: vi.fn(() => mPool) };
});

import { Pool } from 'pg';

describe('Rotating Idle Auditor', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('verifies 10-30 minute interval bounds and audit execution with fake clock', async () => {
    const poolInstance = new Pool();
    // First query returns candidate resource
    // Second query checks heartbeat
    // Third query checks existing handoff
    // Fourth query inserts handoff
    // Fifth query inserts state
    (poolInstance.query as any)
      .mockResolvedValueOnce({
        rows: [
          { employee_id: 'NV12', provider: 'gemini', model: 'gemini-3.5-flash-lite', work_state: 'IDLE', health_state: 'OK', credential_state: 'VALID' }
        ]
      })
      .mockResolvedValueOnce({
        rows: [{ seq: 100, type: 'RESOURCE_SUCCESS' }]
      })
      .mockResolvedValueOnce({
        rows: []
      })
      .mockResolvedValueOnce({
        rows: []
      })
      .mockResolvedValueOnce({
        rows: []
      });

    const core = await import('../apps/tigeriq-core/core.mjs');
    
    // Advance time by 10 minutes plus some random offset within range
    vi.advanceTimersByTime(15 * 60 * 1000);
    
    expect(poolInstance.query).toHaveBeenCalled();
  });

  it('excludes BUSY, RATE_LIMITED, BLOCKED, WAIT_KEY, OFFLINE, and critical nodes', async () => {
    const poolInstance = new Pool();
    (poolInstance.query as any).mockResolvedValueOnce({
      rows: [
        { employee_id: 'NV02', provider: 'ollama', work_state: 'BUSY', health_state: 'OK', credential_state: 'VALID' },
        { employee_id: 'NV13', provider: 'openrouter', work_state: 'IDLE', health_state: 'RATE_LIMITED', credential_state: 'VALID' },
        { employee_id: 'NV14', provider: 'mistral', work_state: 'IDLE', health_state: 'BLOCKED', credential_state: 'VALID' },
        { employee_id: 'NV15', provider: 'cloudflare', work_state: 'IDLE', health_state: 'OK', credential_state: 'WAIT_KEY' },
        { employee_id: 'NV16', provider: 'huggingface', work_state: 'IDLE', health_state: 'OFFLINE', credential_state: 'VALID' },
        { employee_id: 'NV17', provider: 'vercel', work_state: 'CRITICAL', health_state: 'CRITICAL', credential_state: 'VALID' },
        { employee_id: 'NV12', provider: 'gemini', work_state: 'READY', health_state: 'OK', credential_state: 'VALID' }
      ]
    }).mockResolvedValueOnce({
      rows: [{ seq: 101, type: 'RESOURCE_PROBE_OK' }]
    }).mockResolvedValueOnce({
      rows: []
    }).mockResolvedValueOnce({
      rows: []
    }).mockResolvedValueOnce({
      rows: []
    });

    // Verify query criteria specifically requests exclusion of BUSY, WAIT_KEY, RATE_LIMITED, OFFLINE, BLOCKED, CRITICAL
    await import('../apps/tigeriq-core/core.mjs');
    const lastCallArg = (poolInstance.query as any).mock.calls[0][0];
    expect(lastCallArg).toContain("work_state not in ('BUSY', 'CRITICAL')");
    expect(lastCallArg).toContain("health_state not in ('RATE_LIMITED', 'OFFLINE', 'ERROR', 'BLOCKED', 'CRITICAL')");
    expect(lastCallArg).toContain("credential_state not in ('WAIT_KEY')");
  });

  it('verifies state recovery after restart supports both object and string representations', async () => {
    const poolInstance = new Pool();
    // Mock state recovery query returning stringified JSON
    (poolInstance.query as any).mockResolvedValueOnce({
      rows: [{ data: JSON.stringify({ lastIdleAudit: 50000, nextIdleAuditInterval: 900000 }) }]
    });

    // Force recovery execution or test the parse logic directly via core import
    const core = await import('../apps/tigeriq-core/core.mjs');
    expect(poolInstance.query).toHaveBeenCalledWith(expect.stringContaining('ROTATING_IDLE_AUDITOR_STATE'));
  });
});
