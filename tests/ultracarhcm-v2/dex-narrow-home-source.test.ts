import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const home = readFileSync(
  new URL('../../apps/ultracarhcm-v2/app/src/main/java/ai/tigeriq/ultracarhcm/v2/HomeActivity.kt', import.meta.url),
  'utf8',
);
const rules = readFileSync(
  new URL('../../apps/ultracarhcm-v2/app/src/main/java/ai/tigeriq/ultracarhcm/v2/HomeLayoutRules.kt', import.meta.url),
  'utf8',
);

describe('GH-5135 F05 DeX narrow HOME source contract', () => {
  it('activates the compact panel only for a tall narrow desktop window', () => {
    expect(rules).toContain('NARROW_DEX_MAX_WIDTH_DP = 520');
    expect(rules).toContain('NARROW_DEX_MIN_HEIGHT_DP = 600');
    expect(rules).toContain('!isDesktop');
    expect(rules).toContain('heightPx > widthPx');
    expect(home).toContain('HomeLayoutRules.useNarrowDexPanel(');
    expect(home).toContain('renderNarrowDexPanel()');
  });

  it('keeps only bounded V2-owned launch actions in the narrow panel', () => {
    expect(home).toContain('button("GOOGLE MAPS"');
    expect(home).toContain('button("CAMERA USB"');
    expect(home).toContain('button("CÀI ĐẶT"');
    expect(home).toContain('DeX panel • V2 • chưa tự sắp cửa sổ');
    expect(home).not.toContain('WRITE_SECURE_SETTINGS');
  });
});
