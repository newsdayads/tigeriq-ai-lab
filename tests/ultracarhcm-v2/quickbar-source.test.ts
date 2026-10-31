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
const compose = readFileSync(
  new URL('../../apps/ultracarhcm-v2/app/src/main/java/ai/tigeriq/ultracarhcm/v2/QuickBarCompose.kt', import.meta.url),
  'utf8',
);

describe('GH-5135 V1.0.64 QuickBar source contract', () => {
  it('renders exactly nine slots as three Compose rows of three and lifts the cluster by 50dp', () => {
    expect(rules).toContain('const val SLOT_COUNT = 9');
    expect(compose).toContain('repeat(3) { rowIndex ->');
    expect(compose).toContain('repeat(3) { columnIndex ->');
    expect(compose).toContain('slots[rowIndex * 3 + columnIndex]');
    expect(home).toContain('baselineTopPx - dp(50)');
    expect(home).toContain('QuickBarGrid(');
    expect(home).toContain('class HomeActivity : ComponentActivity()');
    expect(home).toContain('val quickBar = ComposeView(this).apply');
  });

  it('uses Compose combinedClickable for platform long-press editing and explicit unassign', () => {
    expect(compose).toContain('import androidx.compose.foundation.combinedClickable');
    expect(compose).toContain('.combinedClickable(');
    expect(compose).toContain('onLongClick = { onLongClick(slot.index) }');
    expect(home).toContain('onLongClick = { index -> showQuickSlotEditor(index) }');
    expect(home).toContain('— Bỏ gán ô này —');
    expect(home).toContain('clearQuickSlot(index)');
    expect(home).toContain('.putString("v2_quick_slots", slots.toString())');
    expect(home).toContain('.commit()');
    expect(home).toContain('if (!saved)');
    expect(home).toContain('Không thể lưu phím tắt trên thiết bị');
    expect(home).not.toContain('putString("v2_quick_slots", slots.toString()).apply()');
  });

  it('maps V1.0.64 app families to real Material Compose icons', () => {
    expect(compose).toContain('Icons.Filled.PlayArrow');
    expect(compose).toContain('Icons.Filled.DirectionsCar');
    expect(compose).toContain('Icons.Filled.Route');
    expect(compose).toContain('Icons.Filled.Videocam');
    expect(compose).toContain('Icons.Filled.Add');
    expect(compose).toContain('Icons.Filled.Apps');

    expect(rules).toContain('"youtube", "nhạc", "nhac", "zing", "spotify", "media"');
    expect(rules).toContain('"grab", "be partner", "greensm", "xanh sm", "taxi"');
    expect(rules).toContain('"bản đồ", "ban do", "map", "vietmap", "navitel", "route"');
    expect(rules).toContain('"camera", "dashcam", "videocam"');
  });

  it('launches installed packages and routes the local camera target without fabricating installs', () => {
    expect(home).toContain('packageManager.getLaunchIntentForPackage(target)');
    expect(home).toContain('target == QuickSlotRules.CAMERA_TARGET');
    expect(home).toContain('startActivity(Intent(this, UsbCameraActivity::class.java))');
    expect(home).toContain('Chưa tìm thấy ứng dụng: $label');
  });
});
