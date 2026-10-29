// GH-5135: V1.0.64 QuickBar source contract.
// Static assertions verify source wiring only; physical device/DeX acceptance remains separate.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const home = readFileSync(
  new URL('../../apps/ultracarhcm-v2/app/src/main/java/ai/tigeriq/ultracarhcm/v2/HomeActivity.kt', import.meta.url),
  'utf8',
);
const rules = readFileSync(
  new URL('../../apps/ultracarhcm-v2/app/src/main/java/ai/tigeriq/ultracarhcm/v2/QuickSlotRules.kt', import.meta.url),
  'utf8',
);

describe('GH-5135 V1.0.64 QuickBar source contract', () => {
  it('renders exactly nine slots as three rows of three and lifts the cluster by 50dp', () => {
    expect(rules).toContain('const val SLOT_COUNT = 9');
    expect(home).toContain('val row = index / 3');
    expect(home).toContain('val column = index % 3');
    expect(home).toContain('baselineTopPx - dp(50)');
    expect(home).toContain('renderQuickBar()');
  });

  it('supports platform long-press editing with explicit unassign action', () => {
    expect(home).toContain('v.setOnLongClickListener');
    expect(home).toContain('onLongClick = { showQuickSlotEditor(index) }');
    expect(home).toContain('— Bỏ gán ô này —');
    expect(home).toContain('clearQuickSlot(index)');
    expect(home).toContain('putString("v2_quick_slots", slots.toString()).apply()');
  });

  it('maps media, car, route, camera, empty and generic app families', () => {
    expect(rules).toContain('"youtube", "nhạc", "nhac", "zing", "spotify", "media"');
    expect(rules).toContain('"grab", "be partner", "greensm", "xanh sm", "taxi"');
    expect(rules).toContain('"bản đồ", "ban do", "map", "vietmap", "navitel", "route"');
    expect(rules).toContain('"camera", "dashcam", "videocam"');
    for (const icon of ['PLAY', 'CAR', 'ROUTE', 'CAMERA', 'ADD', 'APPS']) {
      expect(rules).toContain(icon);
    }
  });

  it('launches installed packages and routes the local camera target without fabricating installs', () => {
    expect(home).toContain('packageManager.getLaunchIntentForPackage(target)');
    expect(home).toContain('target == QuickSlotRules.CAMERA_TARGET');
    expect(home).toContain('startActivity(Intent(this, UsbCameraActivity::class.java))');
    expect(home).toContain('Chưa tìm thấy ứng dụng: $label');
  });
});
