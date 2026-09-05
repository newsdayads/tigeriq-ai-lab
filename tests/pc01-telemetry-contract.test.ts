import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const telemetry = readFileSync('scripts/pc-worker/pc01-telemetry.ps1', 'utf8');

describe('PC01 telemetry controller compatibility', () => {
  it('prefers Controller V1 status and keeps the legacy status path only as fallback', () => {
    expect(telemetry).toContain('/api/v1/status');
    expect(telemetry).toContain('/api/workforce/status');
    expect(telemetry.indexOf('/api/v1/status')).toBeLessThan(telemetry.indexOf('/api/workforce/status'));
  });

  it('does not project the legacy detailed workforce shape from Controller V1 aggregate status', () => {
    expect(telemetry).toContain("protocol -ne 'controller-v1'");
  });
});
