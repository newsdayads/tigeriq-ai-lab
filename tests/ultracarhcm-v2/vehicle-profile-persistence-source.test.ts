// GH-5135 F02/F14: source contract for durable vehicle/profile local persistence.
// Source-only evidence; does not prove device acceptance or identity/license backend behavior.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const vehicle = readFileSync(
  new URL('../../apps/ultracarhcm-v2/app/src/main/java/ai/tigeriq/ultracarhcm/v2/VehicleActivity.kt', import.meta.url),
  'utf8',
);
const profile = readFileSync(
  new URL('../../apps/ultracarhcm-v2/app/src/main/java/ai/tigeriq/ultracarhcm/v2/ProfileActivity.kt', import.meta.url),
  'utf8',
);
const home = readFileSync(
  new URL('../../apps/ultracarhcm-v2/app/src/main/java/ai/tigeriq/ultracarhcm/v2/HomeActivity.kt', import.meta.url),
  'utf8',
);

describe('GH-5135 F02/F14 local persistence source contract', () => {
  it('commits license plate before UI refresh and success acknowledgement', () => {
    const start = vehicle.indexOf('text = "LƯU BIỂN SỐ"');
    const end = vehicle.indexOf('body.addView(TextView', start);
    const block = vehicle.slice(start, end);
    expect(block).toContain('putString(VehicleRules.PREF_LICENSE_PLATE, plate).commit()');
    expect(block).toContain('toast("Đã lưu biển số V2")');
    expect(block).toContain('toast("Không thể lưu biển số V2")');
    expect(block.indexOf('.commit()')).toBeLessThan(block.indexOf('refreshStatus()'));
  });

  it('commits vehicle model and legacy migration flag before success acknowledgement', () => {
    const start = vehicle.indexOf('private fun selectModel(model: String)');
    const end = vehicle.indexOf('private fun refreshStatus()', start);
    const block = vehicle.slice(start, end);
    expect(block).toContain('.putString(VehicleRules.PREF_MODEL, model)');
    expect(block).toContain('.putBoolean("limo", limo)');
    expect(block).toContain('.commit()');
    expect(block).toContain('toast("Không thể lưu lựa chọn xe V2")');
    expect(block).not.toContain('.apply()');
  });

  it('commits Profile driver name before mutating the visible input and acknowledging success', () => {
    const start = profile.indexOf('text = "LƯU HỒ SƠ"');
    const end = profile.indexOf('addCard(localProfile', start);
    const block = profile.slice(start, end);
    expect(block).toContain('putString("driver_name", name).commit()');
    expect(block).toContain('toast("Đã lưu hồ sơ V2 trên thiết bị")');
    expect(block).toContain('toast("Không thể lưu hồ sơ V2")');
    expect(block.indexOf('.commit()')).toBeLessThan(block.indexOf('input.setText(name)'));
  });

  it('commits Home driver name before rerendering', () => {
    const start = home.indexOf('private fun editDriverName()');
    const end = home.indexOf('private fun showSettings()', start);
    const block = home.slice(start, end);
    expect(block).toContain('putString("driver_name", name).commit()');
    expect(block).toContain('toast("Không thể lưu tên tài xế V2")');
    expect(block.indexOf('.commit()')).toBeLessThan(block.indexOf('render()'));
    expect(block).not.toContain('.apply()');
  });
});
