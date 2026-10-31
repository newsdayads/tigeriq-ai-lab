// GH-5135 F08: V1-evidenced five saved-layout shortcut source contract.
// Static source coverage is not physical DeX/device acceptance.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const home = readFileSync(
  new URL('../../apps/ultracarhcm-v2/app/src/main/java/ai/tigeriq/ultracarhcm/v2/HomeActivity.kt', import.meta.url),
  'utf8',
);
const rules = readFileSync(
  new URL('../../apps/ultracarhcm-v2/app/src/main/java/ai/tigeriq/ultracarhcm/v2/SavedLayoutShortcutRules.kt', import.meta.url),
  'utf8',
);

describe('GH-5135 F08 saved-layout shortcuts source contract', () => {
  it('uses exactly five stable config-ID-backed slots', () => {
    expect(rules).toContain('const val SLOT_COUNT = 5');
    expect(rules).toContain('fun slotKey(index: Int): String?');
    expect(rules).toContain('fun validConfigId(value: String): Boolean');
    expect(home).toContain('.put("configId", SavedLayoutShortcutRules.freshConfigId())');
    expect(home).toContain('val seenIds = mutableSetOf<String>()');
    expect(home).toContain('safe.put("configId", configId)');
  });

  it('keeps shortcut identity stable across saved-layout reorder', () => {
    expect(home).toContain('private fun savedConfigurationById(entries: JSONArray, configId: String): JSONObject?');
    expect(home).toContain('private fun moveSavedConfiguration(index: Int, delta: Int): Boolean');
    expect(home).toContain('savedConfigurationById(entries, configId)');
    expect(home).not.toContain('savedLayoutShortcutIndex');
  });

  it('supports tap-to-apply and long-press-to-reassign with synchronous writes', () => {
    expect(home).toContain('private fun openSavedLayoutShortcut(index: Int)');
    expect(home).toContain('applyHomeConfiguration(item, true)');
    expect(home).toContain('private fun showSavedLayoutShortcutEditor(index: Int)');
    expect(home).toContain('onLongClick = { showSavedLayoutShortcutEditor(index) }');
    expect(home).toContain('return editor.commit()');
  });

  it('renders the five shortcuts between START and the bottom actions', () => {
    const start = home.indexOf('button("KHỞI ĐỘNG"');
    const shortcuts = home.indexOf('renderSavedLayoutShortcuts(shortcutTop)');
    const bottom = home.indexOf('val bottomShade = label("", 10f)', shortcuts);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(shortcuts).toBeGreaterThan(start);
    expect(bottom).toBeGreaterThan(shortcuts);
    expect(home).toContain('val left = .05f + index * .1825f');
    expect(home).toContain('String.format(Locale.US, "+%02d", index + 1)');
  });

  it('clears deleted or stale shortcut references instead of opening the wrong layout', () => {
    expect(home).toContain('clearSavedLayoutShortcutReferences(item.optString("configId", ""))');
    expect(home).toContain('if (configId != null && item == null) saveSavedLayoutShortcut(index, null)');
    expect(home).toContain('Bố cục đã gán không còn tồn tại');
  });
});
