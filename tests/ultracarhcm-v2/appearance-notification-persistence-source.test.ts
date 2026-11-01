// GH-5135 F09/F15: source contract for durable Appearance and Notification local state.
// Source-only evidence; does not prove media-provider, update-release, or device acceptance.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const appearance = readFileSync(
  new URL('../../apps/ultracarhcm-v2/app/src/main/java/ai/tigeriq/ultracarhcm/v2/AppearanceActivity.kt', import.meta.url),
  'utf8',
);
const notification = readFileSync(
  new URL('../../apps/ultracarhcm-v2/app/src/main/java/ai/tigeriq/ultracarhcm/v2/NotificationActivity.kt', import.meta.url),
  'utf8',
);
const update = readFileSync(
  new URL('../../apps/ultracarhcm-v2/app/src/main/java/ai/tigeriq/ultracarhcm/v2/UpdateActivity.kt', import.meta.url),
  'utf8',
);

describe('GH-5135 F09/F15 durable local UI state', () => {
  it('commits day/night state before refreshing the visible Appearance status', () => {
    const start = appearance.indexOf('text = "ĐỔI NGÀY / ĐÊM"');
    const end = appearance.indexOf('text = "CHỌN ẢNH NỀN TÙY CHỈNH"', start);
    const block = appearance.slice(start, end);
    expect(block).toContain('putBoolean("night", nextNight).commit()');
    expect(block).toContain('toast("Không thể lưu chế độ ngày/đêm")');
    expect(block.indexOf('.commit()')).toBeLessThan(block.indexOf('refreshStatus()'));
  });

  it('persists a new custom background before releasing the previous URI grant', () => {
    const start = appearance.indexOf('private fun persistCustomBackground');
    const end = appearance.indexOf('private fun releasePersistedUri', start);
    const block = appearance.slice(start, end);
    expect(block).toContain('.putString(AppearanceRules.PREF_CUSTOM_BACKGROUND_URI, uri.toString())');
    expect(block).toContain('.commit()');
    expect(block).toContain('if (!committed)');
    expect(block).toContain('if (previous != uri) releasePersistedUri(uri)');
    expect(block).toContain('if (previous != null && previous != uri) releasePersistedUri(previous)');
    expect(block.indexOf('.commit()')).toBeLessThan(
      block.indexOf('releasePersistedUri(previous)'),
    );
    expect(block).toContain('toast("Không thể lưu nền tùy chỉnh V2")');
  });

  it('clears persisted background preferences before releasing the old URI grant', () => {
    const start = appearance.indexOf('private fun clearCustomBackground()');
    const end = appearance.indexOf('private fun refreshStatus()', start);
    const block = appearance.slice(start, end);
    expect(block).toContain('.remove(AppearanceRules.PREF_CUSTOM_BACKGROUND_URI)');
    expect(block).toContain('.commit()');
    expect(block).toContain('if (!committed)');
    expect(block).toContain('if (previous != null) releasePersistedUri(previous)');
    expect(block.indexOf('.commit()')).toBeLessThan(block.indexOf('releasePersistedUri(previous)'));
    expect(block).toContain('toast("Không thể xóa nền tùy chỉnh V2")');
  });

  it('commits user notification actions before refreshing their visible state', () => {
    const markStart = notification.indexOf('text = "ĐÁNH DẤU ĐÃ ĐỌC"');
    const clearStart = notification.indexOf('text = "XÓA THÔNG BÁO CỤC BỘ"');
    const mark = notification.slice(markStart, clearStart);
    const clear = notification.slice(clearStart, notification.indexOf('refresh()', clearStart + 100) + 20);
    expect(mark).toContain('putBoolean(NotificationRules.KEY_READ, true).commit()');
    expect(mark).toContain('Không thể đánh dấu thông báo đã đọc');
    expect(mark.indexOf('.commit()')).toBeLessThan(mark.indexOf('refresh()'));
    expect(clear).toContain('prefs.edit().clear().commit()');
    expect(clear).toContain('Không thể xóa thông báo cục bộ');
  });

  it('persists update notices synchronously and exposes persistence failure in the update view', () => {
    expect(update).toContain('private fun recordUpdateNotice(metadata: UpdateMetadata): Boolean');
    const start = update.indexOf('private fun recordUpdateNotice(metadata: UpdateMetadata): Boolean');
    const end = update.indexOf('private fun currentVersionCode()', start);
    const block = update.slice(start, end);
    expect(block).toContain('.putBoolean(NotificationRules.KEY_READ, false)');
    expect(block).toContain('.commit()');
    expect(block).not.toContain('.apply()');
    expect(update).toContain('val noticeRecorded = recordUpdateNotice(metadata)');
    expect(update).toContain('if (!noticeRecorded)');
    expect(update).toContain('Không thể lưu thông báo cập nhật cục bộ trên thiết bị.');
  });
});
