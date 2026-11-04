// GH-5135 F20 — external Android Settings intents must fail visibly.
// Source-only regression; does not claim OEM/device runtime acceptance.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) =>
  readFileSync(new URL('../../' + path, import.meta.url), 'utf8');

const privacy = read(
  'apps/ultracarhcm-v2/app/src/main/java/ai/tigeriq/ultracarhcm/v2/PrivacyActivity.kt',
);
const home = read(
  'apps/ultracarhcm-v2/app/src/main/java/ai/tigeriq/ultracarhcm/v2/HomeActivity.kt',
);

describe('GH-5135 F20 external settings fail-visible contract', () => {
  it('guards both Privacy settings entry points and reports a visible failure', () => {
    expect(privacy).toContain('private fun openExternalSettings(intent: Intent, failureMessage: String)');
    expect(privacy).toContain('catch (error: RuntimeException)');
    expect(privacy).toContain('External privacy settings launch failed');
    expect(privacy).toContain('"Không thể mở cài đặt ứng dụng"');
    expect(privacy).toContain('"Không thể mở cài đặt quyền hiển thị"');
    expect(privacy).toContain('Settings.ACTION_APPLICATION_DETAILS_SETTINGS');
    expect(privacy).toContain('Settings.ACTION_MANAGE_OVERLAY_PERMISSION');
    expect(privacy).toContain('status.text =');
  });

  it('guards the Home overlay-permission settings launch without granting permission itself', () => {
    expect(home).toContain('private fun launchExternalSettings(intent: Intent, failureMessage: String)');
    expect(home).toContain('catch (error: RuntimeException)');
    expect(home).toContain('External settings launch failed');
    expect(home).toContain('Settings.ACTION_MANAGE_OVERLAY_PERMISSION');
    expect(home).toContain('"Không thể mở quyền Camera nổi DeX"');
    expect(home).not.toMatch(/putExtra\([^)]*SYSTEM_ALERT_WINDOW/);
  });
});
