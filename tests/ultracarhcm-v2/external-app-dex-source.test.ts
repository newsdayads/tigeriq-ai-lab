import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const home = readFileSync(new URL('../../apps/ultracarhcm-v2/app/src/main/java/ai/tigeriq/ultracarhcm/v2/HomeActivity.kt', import.meta.url), 'utf8');
const manifest = readFileSync(new URL('../../apps/ultracarhcm-v2/app/src/main/AndroidManifest.xml', import.meta.url), 'utf8');
const bounds = readFileSync(new URL('../../apps/ultracarhcm-v2/app/src/main/java/ai/tigeriq/ultracarhcm/v2/ExternalAppWindowBoundsRules.kt', import.meta.url), 'utf8');

describe('GH-5135 launch editable external apps on requested native DeX region', () => {
  it('uses qualified native-DeX display before explicit launchBounds instead of implicit phone launch', () => {
    expect(home).toContain('DexUtils.resolveDisplay(this,');
    expect(home).toContain('ActivityOptions.makeBasic()');
    expect(home).toContain('options.launchDisplayId = display.displayId');
    expect(home).toContain('options.launchBounds = Rect(');
    expect(home).toContain('startActivity(launch, options.toBundle())');
    expect(home).toContain('startActivity(launch)');
    expect(home).toContain('Không thể mở ứng dụng đúng khung DeX');
  });
  it('preserves installed launchable app visibility without QUERY_ALL_PACKAGES', () => {
    expect(manifest).toContain('<queries>');
    expect(manifest).toContain('android.intent.action.MAIN');
    expect(manifest).toContain('android.intent.category.LAUNCHER');
    expect(manifest).not.toContain('android.permission.QUERY_ALL_PACKAGES');
    expect(home).toContain('packageManager.getLaunchIntentForPackage(target)');
    expect(home).toContain('target == QuickSlotRules.CAMERA_TARGET');
  });
  it('bounds right-hand panel without mutating or controlling other app windows', () => {
    expect(bounds).toContain('internal object ExternalAppWindowBoundsRules');
    expect(bounds).toContain('fun initial(');
    expect(bounds).toContain('displayWidth *');
    expect(bounds).toContain('displayHeight *');
    expect(bounds).toContain('return null');
  });
});
