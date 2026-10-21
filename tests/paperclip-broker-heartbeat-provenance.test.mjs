import { describe, expect, it } from 'vitest';
import { paperclipBrokerHeartbeatProvenancePresent } from '../apps/openclaw-tigeriq-runtime/paperclip-lab.mjs';

// Pure R07 readiness regression: no Windows, Docker, broker or device mutation.
describe('GH-2054 Paperclip broker heartbeat provenance', () => {
  const valid = () => ({ pid: 9044, sourceSha256: 'a'.repeat(64) });

  it('accepts well-formed running-process evidence with a lowercase SHA-256', () => {
    expect(paperclipBrokerHeartbeatProvenancePresent(valid())).toBe(true);
  });

  it('rejects missing, stopped, forged or fractional broker PIDs', () => {
    for (const pid of [undefined, null, 0, -5, '9044', 4.5, Infinity, NaN]) {
      expect(paperclipBrokerHeartbeatProvenancePresent({ ...valid(), pid })).toBe(false);
    }
  });

  it('rejects absent, truncated or non-hexadecimal source provenance', () => {
    for (const sourceSha256 of [
      undefined, null, '', 'a'.repeat(63), 'a'.repeat(65),
      'g'.repeat(64), 'A'.repeat(64), 42,
    ]) {
      expect(paperclipBrokerHeartbeatProvenancePresent({ ...valid(), sourceSha256 })).toBe(false);
    }
  });
});
