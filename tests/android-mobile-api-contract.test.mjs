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
    ]) {
      expect(client).toContain(route);
      expect(core).toContain(route);
    }
    expect(client).not.toContain('/api/node/employee');
    expect(client).not.toContain('/api/node/pair');
    expect(client).not.toContain('/api/node/pairing-challenge');
  });
});
