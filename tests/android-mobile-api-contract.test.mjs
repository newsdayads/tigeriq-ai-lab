import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const client = readFileSync(new URL('../apps/android-worker/app/src/main/java/ai/tigeriq/worker/ControllerClient.java', import.meta.url), 'utf8');
const core = readFileSync(new URL('../apps/tigeriq-core/mobile-worker-api.mjs', import.meta.url), 'utf8');

describe('Android Worker ↔ TigerIQ Core mobile API contract', () => {
  it('uses only the authoritative Core mobile enrollment routes', () => {
    for (const route of [
      '/api/mobile/health',
      '/api/mobile/pairing-challenge',
      '/api/mobile/pair',
      '/api/mobile/assignment',
      '/api/mobile/heartbeat',
      '/api/mobile/update/manifest',
      '/api/mobile/tasks/lease',
      '/api/mobile/tasks/result',
    ]) {
      expect(client).toContain(route);
      expect(core).toContain(route);
    }
    expect(client).not.toContain('/api/node/employee');
    expect(client).not.toContain('/api/node/pair');
    expect(client).not.toContain('/api/node/pairing-challenge');
    expect(core).toContain('/api/mobile/tasks/enqueue');
    expect(core).toContain('/api/mobile/tasks/renew');
    expect(core).toContain('tigeriq_mobile_tasks');
    expect(core).toContain("mobile_task_result_conflict");
    expect(core).toContain("mobile_lease_stale");
  });
});
