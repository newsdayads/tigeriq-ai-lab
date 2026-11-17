import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const base = new URL('../../apps/ultracarhcm-v2/app/src/main/java/ai/tigeriq/ultracarhcm/v2/', import.meta.url);
const dex = readFileSync(new URL('DexUtils.kt', base), 'utf8');
const geometry = readFileSync(new URL('CameraWindowBoundsRules.kt', base), 'utf8');
const runner = readFileSync(new URL('../../apps/ultracarhcm-v2/app/src/androidTest/java/ai/tigeriq/ultracarhcm/v2/V2VirtualSecondaryDisplayTest.kt', import.meta.url), 'utf8');

describe('GH-5135 Android virtual display is never a fake Samsung DeX acceptance', () => {
  it('rejects developer overlay even with a native-desktop flag and unapproved virtual display', () => {
    expect(dex).toContain('type != Display.TYPE_OVERLAY');
    expect(dex).toContain('(type != Display.TYPE_VIRTUAL || nativeDesktopActive)');
    expect(dex).toContain('display.state == Display.STATE_ON');
  });
  it('tests Android virtual display and source geometry, not pretend physical hardware', () => {
    expect(runner).toContain('it.type == Display.TYPE_OVERLAY');
    expect(runner).toContain('Android refused secondary-display Home launch');
    expect(runner).toContain('actual');
    expect(runner).toContain('CameraWindowBoundsRules.initial(');
    expect(runner).toContain('assertFalse("Real Samsung DeX must not be synthesized"');
    expect(geometry).toContain('displayDensity.isFinite()');
  });
});
