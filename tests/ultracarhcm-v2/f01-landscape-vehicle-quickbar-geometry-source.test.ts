import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const base = new URL('../../apps/ultracarhcm-v2/app/src/main/java/ai/tigeriq/ultracarhcm/v2/', import.meta.url);
const home = readFileSync(new URL('HomeActivity.kt', base), 'utf8');
const rules = readFileSync(new URL('HomeLayoutRules.kt', base), 'utf8');

describe('GH-5135 real V1/V2 virtual display visual diff: no car/QuickBar overlap', () => {
  it('reserves car artwork space based on the exact existing 50dp QuickBar lift', () => {
    expect(home).toContain('val quickBarExpectedTop =');
    expect(home).toContain('val quickBarExpectedTop = HomeLayoutRules.quickBarTop(root.height, dp(50))');
    expect(home).toContain('val liftedTop = HomeLayoutRules.quickBarTop(root.height, dp(50))');
    expect(rules).toContain('((heightPx * .69f - liftPx) / heightPx).coerceIn(.56f, .647f)');
    expect(home).toContain('HomeLayoutRules.vehicleTopBeforeQuickBar(quickBarExpectedTop)');
    expect(home).toContain('renderVehicleArtwork(vehicleModel, .295f, carTop, .41f, .225f)');
    expect(home).toContain('.375f, carTop + .184f, .25f, .032f');
    expect(rules).toContain('(safeBarTop - .225f - .018f)');
  });
});
