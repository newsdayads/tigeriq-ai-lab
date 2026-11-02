// GH-5135 F04/F09/F15: regression contract for the last local async persistence paths.
// Source-only evidence; does not claim DeX/UVC/device acceptance.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

const notification = read(
  'apps/ultracarhcm-v2/app/src/main/java/ai/tigeriq/ultracarhcm/v2/NotificationActivity.kt',
);
const overlay = read(
  'apps/ultracarhcm-v2/app/src/main/java/ai/tigeriq/ultracarhcm/v2/OverlayService.kt',
);
const home = read(
  'apps/ultracarhcm-v2/app/src/main/java/ai/tigeriq/ultracarhcm/v2/HomeActivity.kt',
);

describe('GH-5135 remaining local durability paths', () => {
  it('clears resolved notifications durably and exposes failure instead of false-empty success', () => {
    const start = notification.indexOf(
      'if (NotificationRules.isResolvedNotice(currentVersionCode(), versionCode))',
    );
    const end = notification.indexOf('if (versionCode <= 0L)', start);
    const block = notification.slice(start, end);
    expect(block).toContain('prefs.edit().clear().commit()');
    expect(block).not.toContain('.apply()');
    expect(block).toContain('Thông báo đã hết hiệu lực nhưng chưa thể xóa dữ liệu cục bộ.');
    expect(block).toContain('Không thể xóa thông báo đã hết hiệu lực');
    expect(block.indexOf('.commit()')).toBeLessThan(block.indexOf('renderEmpty()'));
  });

  it('persists DeX camera shortcut coordinates synchronously and logs persistence failure', () => {
    const start = overlay.indexOf('MotionEvent.ACTION_UP ->');
    const end = overlay.indexOf('MotionEvent.ACTION_CANCEL', start);
    const block = overlay.slice(start, end);
    expect(block).toContain('val persisted = pref.edit()');
    expect(block).toContain('.putInt(xKey, p.x)');
    expect(block).toContain('.putInt(yKey, p.y)');
    expect(block).toContain('.commit()');
    expect(block).not.toContain('.apply()');
    expect(block).toContain('if (!persisted)');
    expect(block).toContain('Position persistence failed');
  });

  it('fails closed to bundled background when a persisted custom image cannot decode', () => {
    const start = home.indexOf('AppearanceRules.KIND_IMAGE ->');
    const end = home.indexOf('AppearanceRules.KIND_VIDEO ->', start);
    const block = home.slice(start, end);
    expect(block).toContain('view.setImageURI(uri)');
    expect(block).toContain('if (view.drawable == null)');
    expect(block).toContain('Custom image could not be decoded');
    expect(block).toContain('clearInvalidCustomBackground()');
    expect(block).toContain('renderBundledBackground(night)');
    expect(block.indexOf('if (view.drawable == null)')).toBeLessThan(
      block.indexOf('place(view, 0f, 0f, 1f, 1f)'),
    );
  });

  it('persists invalid custom-background cleanup synchronously and logs failure', () => {
    const start = home.indexOf('private fun clearInvalidCustomBackground()');
    const end = home.indexOf('private fun renderBackground', start);
    const block = home.slice(start, end);
    expect(block).toContain('.remove(AppearanceRules.PREF_CUSTOM_BACKGROUND_URI)');
    expect(block).toContain('.remove(AppearanceRules.PREF_CUSTOM_BACKGROUND_KIND)');
    expect(block).toContain('.commit()');
    expect(block).not.toContain('.apply()');
    expect(block).toContain('if (!cleared)');
    expect(block).toContain('Failed to persist invalid custom background cleanup');
  });
});
