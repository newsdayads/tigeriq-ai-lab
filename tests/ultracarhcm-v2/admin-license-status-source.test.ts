// GH-5135 F18 — fail-closed administrative/license status surface.
// Source coverage only; no backend, activation or device-registration acceptance is claimed.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const activity = readFileSync(
  new URL('../../apps/ultracarhcm-v2/app/src/main/java/ai/tigeriq/ultracarhcm/v2/AdminLicenseActivity.kt', import.meta.url),
  'utf8',
);
const rules = readFileSync(
  new URL('../../apps/ultracarhcm-v2/app/src/main/java/ai/tigeriq/ultracarhcm/v2/AdminLicenseRules.kt', import.meta.url),
  'utf8',
);
const profile = readFileSync(
  new URL('../../apps/ultracarhcm-v2/app/src/main/java/ai/tigeriq/ultracarhcm/v2/ProfileActivity.kt', import.meta.url),
  'utf8',
);
const manifest = readFileSync(
  new URL('../../apps/ultracarhcm-v2/app/src/main/AndroidManifest.xml', import.meta.url),
  'utf8',
);

describe('GH-5135 F18 fail-closed admin/license surface', () => {
  it('exposes a real read-only product surface from Profile', () => {
    expect(profile).toContain('AdminLicenseActivity::class.java');
    expect(profile).toContain('QUẢN TRỊ VÀ GIẤY PHÉP');
    expect(manifest).toContain('<activity android:name=".AdminLicenseActivity"');
    expect(activity).toContain('QUẢN TRỊ VÀ GIẤY PHÉP');
    expect(activity).toContain('Chế độ quản trị: CHỈ ĐỌC / FAIL-CLOSED');
  });

  it('fails closed until a verified backend contract exists', () => {
    expect(rules).toContain('VERIFIED_BACKEND_CONFIGURED = false');
    expect(rules).toContain('"CHƯA CẤU HÌNH"');
    expect(rules).toContain('"KHÔNG KHẢ DỤNG"');
    expect(rules).toContain('không tự tạo license');
    expect(activity).toContain('Không có nút kích hoạt, gia hạn, đăng ký');
  });

  it('does not invent network, credential or activation logic', () => {
    expect(activity).not.toMatch(/HttpURLConnection|OkHttp|Retrofit|URL\(/);
    expect(activity).not.toMatch(/EditText|Password|credential/i);
    expect(activity).not.toMatch(/activate|registerDevice|renewLicense/i);
    expect(rules).not.toMatch(/token|secret|password/i);
  });
});
