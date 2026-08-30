import { afterEach, describe, expect, it } from 'vitest';
import { fetchWorkforceStatus, sanitizeWorkforceSnapshot } from '../api/workforce-status.mjs';

afterEach(() => {
  delete process.env.TIGERIQ_WORKFORCE_STATUS_URL;
  delete process.env.TIGERIQ_WORKFORCE_STATUS_TOKEN;
});

describe('Workforce status ingress', () => {
  it('reports an honest disconnected state when no controller ingress is configured', async () => {
    const result = await fetchWorkforceStatus();
    expect(result.connected).toBe(false);
    expect(result.mode).toBe('not-configured');
    expect(result.workforce).toBeNull();
  });

  it('requires HTTPS for any configured controller ingress', async () => {
    process.env.TIGERIQ_WORKFORCE_STATUS_URL = 'http://127.0.0.1:8787/api/workforce/status';
    await expect(fetchWorkforceStatus()).rejects.toThrow('workforce_status_url_must_use_https');
  });

  it('uses an environment-only bearer token and sanitizes the remote snapshot', async () => {
    process.env.TIGERIQ_WORKFORCE_STATUS_URL = 'https://controller.example.test/api/workforce/status';
    process.env.TIGERIQ_WORKFORCE_STATUS_TOKEN = 'secret-status-token';
    let seenAuthorization = '';
    const result = await fetchWorkforceStatus(async (_url, init) => {
      seenAuthorization = String(init?.headers?.authorization || '');
      return new Response(JSON.stringify({
        ok: true,
        workforce: {
          generatedAt: '2026-08-31T00:00:00.000Z',
          nodes: { total: 2, byStatus: { online: 2, unexpected: 99 }, byKind: { android: 2 } },
          employees: {
            total: 2,
            byAvailability: { idle: 1, busy: 1 },
            activeTasks: 1,
            concurrencyCapacity: 2,
            utilization: 0.5,
            departments: { Operations: 2 },
            providers: { local: 2 },
          },
          tasks: { total: 3, byStage: { queued: 1, running: 1, completed: 1 }, active: 2, terminal: 1, failed: 0 },
          privateSecret: 'must-not-pass-through',
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    expect(seenAuthorization).toBe('Bearer secret-status-token');
    expect(result.connected).toBe(true);
    expect(result.workforce?.nodes.byStatus).toEqual({ online: 2, degraded: 0, offline: 0 });
    expect((result.workforce as unknown as Record<string, unknown>).privateSecret).toBeUndefined();
  });

  it('clamps malformed counters rather than reflecting arbitrary controller data', () => {
    const sanitized = sanitizeWorkforceSnapshot({
      nodes: { total: -3, byStatus: { online: -1 } },
      employees: { utilization: 42, providers: { x: -2 } },
      tasks: { failed: Number.NaN },
    });
    expect(sanitized.nodes.total).toBe(0);
    expect(sanitized.nodes.byStatus.online).toBe(0);
    expect(sanitized.employees.utilization).toBe(1);
    expect(sanitized.employees.providers.x).toBe(0);
    expect(sanitized.tasks.failed).toBe(0);
  });
});
