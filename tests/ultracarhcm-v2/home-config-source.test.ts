// GH-5135: Static source contract for HOME local persistence.
// This does NOT prove Android device/runtime behavior or V1 layout parity.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const home = readFileSync(
  new URL('../../apps/ultracarhcm-v2/app/src/main/java/ai/tigeriq/ultracarhcm/v2/HomeActivity.kt', import.meta.url),
  'utf8',
);

describe('GH-5135 HOME configuration source contract (not device QA)', () => {
  it('saves actual selected HOME preferences to private device storage', () => {
    expect(home).toContain('private fun saveHomeConfiguration()');
    expect(home).toContain('val current = savedConfigurations()');
    expect(home).toContain('HomeConfigRules.canSave(current.length())');
    expect(home).toContain('HomeConfigRules.normalizeName(input.text.toString())');
    expect(home).toContain('.put("night", prefs.getBoolean("night", false))');
    expect(home).toContain('.put("limo", prefs.getBoolean("limo", false))');
    expect(home).toContain('.put("driver", prefs.getString("driver_name", "Driver")');
    expect(home).toContain('.put("quickSlots", normalizedQuickSlotsForStorage(quickSlots()))');
    expect(home).toContain('putString("v2_home_configs", current.toString()).apply()');
    expect(home).not.toContain('Chưa hỗ trợ tạo bố cục V2 — không ghi dữ liệu giả');
  });

  it('supports applying and removing saved HOME configurations without claiming V1 parity', () => {
    expect(home).toContain('private fun showSaved()');
    expect(home).toContain('private fun savedConfigurations(): JSONArray');
    expect(home).toContain('JSONArray(prefs.getString("v2_home_configs", "[]")');
    expect(home).toContain('private fun applyHomeConfiguration(item: JSONObject, renderAfter: Boolean)');
    expect(home).toContain('.putBoolean("night", item.optBoolean("night", false))');
    expect(home).toContain('.putBoolean("limo", item.optBoolean("limo", false))');
    expect(home).toContain('.putString("driver_name", item.optString("driver", "Driver"))');
    expect(home).toContain('editor.putString("v2_quick_slots", normalizedQuickSlotsForStorage(slots).toString())');
    expect(home).toContain('if (i != index) remaining.put(entries.get(i))');
    expect(home).toContain('.putString("v2_home_configs", remaining.toString())');
    expect(home).toContain('editor.apply()');
    expect(home).toContain('chưa phải bố cục V1');
    expect(home).not.toContain('prefs.getInt("saved_count", 0)');
  });

  it('supports a device-local default HOME configuration without claiming V1 parity', () => {
    expect(home).toContain('applyDefaultHomeConfiguration()');
    expect(home).toContain('private fun setDefaultHomeConfiguration(item: JSONObject)');
    expect(home).toContain('putString("v2_default_home_config", item.toString()).apply()');
    expect(home).toContain('arrayOf("Áp dụng", "Đặt làm mặc định", "Xóa cấu hình")');
    expect(home).toContain('editor.remove("v2_default_home_config")');
    expect(home).toContain('Corrupt default HOME configuration');
  });

  it('stops retired HOME video decoders before rerender and during Activity teardown', () => {
    expect(home).toContain('private var homeVideo: VideoView? = null');
    expect(home).toContain('private fun releaseHomeVideo()');
    const release = home.slice(home.indexOf('private fun releaseHomeVideo()'), home.indexOf('private fun shape('));
    expect(release).toContain('video.setOnPreparedListener(null)');
    expect(release).toContain('video.stopPlayback()');
    expect(release).toContain('homeVideo = null');

    const rerender = home.slice(home.indexOf('private fun render()'), home.indexOf('val night = prefs.getBoolean'));
    expect(rerender).toMatch(/releaseHomeVideo\(\)\s*root\.removeAllViews\(\)/);
    const destroy = home.slice(home.indexOf('override fun onDestroy()'), home.indexOf('private fun releaseHomeVideo()'));
    expect(destroy).toMatch(/homeVisible = false\s*tickHandler\.removeCallbacks\(clockTick\)\s*releaseHomeVideo\(\)\s*super\.onDestroy\(\)/);
    expect(home).toContain('if (homeVideo === bot)');
  });

  it('stops background VIDEO decoder and clock ticks, and resumes only while HOME visible', () => {
    expect(home).toContain('private var homeVisible = false');
    const create = home.slice(home.indexOf('override fun onCreate('), home.indexOf('override fun onResume()'));
    expect(create).not.toContain('tickHandler.post(clockTick)');
    expect(create).toContain('root.post { if (homeVisible && homeVideo == null) render() }');
    const resume = home.slice(home.indexOf('override fun onResume()'), home.indexOf('override fun onConfigurationChanged('));
    expect(resume).toMatch(/homeVisible = true\s*tickHandler\.removeCallbacks\(clockTick\)\s*tickHandler\.post\(clockTick\)/);
    expect(resume).toContain('root.post { if (homeVisible && homeVideo == null) render() }');
    const stop = home.slice(home.indexOf('override fun onStop()'), home.indexOf('override fun onDestroy()'));
    expect(stop).toMatch(/homeVisible = false\s*tickHandler\.removeCallbacks\(clockTick\)\s*releaseHomeVideo\(\)\s*super\.onStop\(\)/);
    expect(home).toContain('root.post { if (homeVisible) render() }');
    expect(home).not.toContain('root.post { render() }');
    // Android lifecycle callback ownership is not physical Device/DeX QA.
  });

  it('allows a real local driver-name edit without modifying the original V1 app', () => {
    expect(home).toContain('private fun editDriverName()');
    expect(home).toContain('putString("driver_name", name).apply()');
    expect(home).toContain('5 -> editDriverName()');
    expect(home).toContain('Cấu hình đã lưu');
    expect(home).toContain('Lưu cấu hình');
    expect(home).toContain('getSharedPreferences("ultracar_v2_home", Context.MODE_PRIVATE)');
  });
});
