// GH-5135 F14: V1 V66 proves the original Profile header subtitle is red.
// This is source fidelity only; it does not accept full Profile/device parity.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const profile = readFileSync(
  new URL('../../apps/ultracarhcm-v2/app/src/main/java/ai/tigeriq/ultracarhcm/v2/ProfileActivity.kt', import.meta.url),
  'utf8',
);
const v66 = readFileSync(
  new URL('../../apps/ultracarhcm-v1/release/build-v66-profile-red-test.mjs', import.meta.url),
  'utf8',
);

describe('GH-5135 F14 V66 Profile subtitle parity', () => {
  it('uses the real V2 runtime version as the red original header subtitle', () => {
    const start = profile.indexOf('body.addView(text("HỒ SƠ NGƯỜI LÁI", 28f)');
    const end = profile.indexOf('val widthDp =', start);
    const header = profile.slice(start, end);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(header).toContain('body.addView(text(currentVersionLabel(), 14f, Color.RED))');
    expect(header).not.toContain('Bố cục tự đổi theo chiều rộng màn hình');
  });

  it('does not add a floating profile version badge', () => {
    expect(profile).not.toMatch(/versionBadge|profile_chip|floating version/i);
  });

  it('is grounded in the isolated V66 original-subtitle color callsite', () => {
    expect(v66).toContain('ORIGINAL profile header passes subtitle p1 into the FIRST Compose Text.');
    expect(v66).toContain('const-wide v3, 0xffff000000000000L');
    expect(v66).toContain('Do NOT touch title, other Text calls or Float registers.');
  });
});
