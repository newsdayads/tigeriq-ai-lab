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
    expect(home).toContain('val selectedModel = VehicleRules.currentModel(');
    expect(home).toContain('.put("limo", selectedModel == VehicleRules.MODEL_LIMO_RED)');
    expect(home).toContain('.put("vehicleModel", selectedModel)');
    expect(home).toContain('.put("licensePlate", licensePlate)');
    expect(home).toContain('.put("driver", prefs.getString("driver_name", "Driver")');
    expect(home).toContain('.put("schemaVersion", HomeConfigRules.CURRENT_SCHEMA_VERSION)');
    expect(home).toContain('.put("quickSlots", normalizedQuickSlotsForStorage(quickSlots()))');
    expect(home).toContain('putString("v2_home_configs", current.toString()).commit()');
    expect(home).not.toContain('Chưa hỗ trợ tạo bố cục V2 — không ghi dữ liệu giả');
  });

  it('supports applying and removing saved HOME configurations without claiming V1 parity', () => {
    expect(home).toContain('private fun showSaved()');
    expect(home).toContain('private fun savedConfigurations(): JSONArray');
    expect(home).toContain('JSONArray(prefs.getString("v2_home_configs", "[]")');
    expect(home).toContain('private fun applyHomeConfiguration(item: JSONObject, renderAfter: Boolean)');
    expect(home).toContain('.putBoolean("night", safe.optBoolean("night", false))');
    expect(home).toContain('.putBoolean("limo", safe.optBoolean("limo", false))');
    expect(home).toContain('.putString(VehicleRules.PREF_MODEL, safe.optString("vehicleModel"))');
    expect(home).toContain('.putString(VehicleRules.PREF_LICENSE_PLATE, safe.optString("licensePlate"))');
    expect(home).toContain('.putString("driver_name", safe.optString("driver", "Driver"))');
    expect(home).toContain('editor.putString("v2_quick_slots", normalizedQuickSlotsForStorage(slots).toString())');
    expect(home).toContain('if (i != index) remaining.put(entries.get(i))');
    expect(home).toContain('.putString("v2_home_configs", remaining.toString())');
    expect(home).toContain('if (editor.commit())');
    expect(home).toContain('chưa phải bố cục V1');
    expect(home).not.toContain('prefs.getInt("saved_count", 0)');
  });

  it('acknowledges user-visible HOME mutations only after synchronous persistence succeeds', () => {
    const applyStart = home.indexOf('private fun applyHomeConfiguration');
    const applyEnd = home.indexOf('private fun applyDefaultHomeConfiguration', applyStart);
    const applyBlock = home.slice(applyStart, applyEnd);
    expect(applyBlock).toContain('if (!editor.commit()) return false');
    expect(applyBlock).not.toContain('editor.apply()');

    const saveStart = home.indexOf('private fun saveHomeConfiguration');
    const saveEnd = home.indexOf('private fun moveSavedConfiguration', saveStart);
    const saveBlock = home.slice(saveStart, saveEnd);
    expect(saveBlock).toContain('putString("v2_home_configs", current.toString()).commit()');
    expect(saveBlock).toContain('Không thể lưu cấu hình Home');

    const defaultStart = home.indexOf('private fun setDefaultHomeConfiguration');
    const defaultEnd = home.indexOf('private fun saveHomeConfiguration', defaultStart);
    const defaultBlock = home.slice(defaultStart, defaultEnd);
    expect(defaultBlock).toContain('putString("v2_default_home_config", safe.toString()).commit()');
    expect(defaultBlock).toContain('Không thể lưu cấu hình Home mặc định');

    const savedStart = home.indexOf('private fun showSaved()');
    const savedEnd = home.indexOf('private fun exportOverlayPositions', savedStart);
    const savedBlock = home.slice(savedStart, savedEnd);
    expect(savedBlock).toContain('if (editor.commit())');
    expect(savedBlock).toContain('Không thể xóa cấu hình khỏi thiết bị');
  });

  it('reorders saved HOME configurations with deterministic up/down controls', () => {
    expect(home).toContain('private fun moveSavedConfiguration(index: Int, delta: Int): Boolean');
    expect(home).toContain('HomeConfigRules.reorderTarget(entries.length(), index, delta)');
    expect(home).toContain('.putString("v2_home_configs", reordered.toString())');
    expect(home).toContain('.commit()');
    expect(home).toContain('private fun showSavedOrderEditor()');
    expect(home).toContain('SẮP XẾP BỐ CỤC');
    expect(home).toContain('↑ Đưa lên');
    expect(home).toContain('↓ Đưa xuống');
    expect(home).toContain('Không dùng kéo thả để tránh chọn nhầm thẻ.');
    expect(home).toContain('.setNeutralButton("SẮP XẾP BỐ CỤC")');
  });

  it('migrates legacy local state and fails closed on corrupt or future schemas', () => {
    expect(home).toContain('private fun normalizeHomeConfiguration(item: JSONObject): JSONObject?');
    expect(home).toContain('item.optInt("schemaVersion", 0)');
    expect(home).toContain('HomeConfigRules.canReadSchema(schema)');
    expect(home).toContain('val vehicleModel = VehicleRules.currentModel(');
    expect(home).toContain('item.optString("vehicleModel", "")');
    expect(home).toContain('VehicleRules.normalizeLicensePlate(');
    expect(home).toContain('.put("schemaVersion", HomeConfigRules.CURRENT_SCHEMA_VERSION)');
    expect(home).toContain('val limit = minOf(raw.length(), HomeConfigRules.MAX_SAVED)');
    expect(home).toContain('val safe = normalizeHomeConfiguration(item) ?: continue');
    expect(home).toContain('val seenIds = mutableSetOf<String>()');
    expect(home).toContain('safe.put("configId", configId)');
    expect(home).toContain('val cleared = prefs.edit().remove("v2_home_configs").commit()');
    expect(home).toContain('Failed to persist corrupt HOME config cleanup');
    expect(home).toContain('val persisted = prefs.edit()');
    expect(home).toContain('.putString("v2_home_configs", normalized.toString())');
    expect(home).toContain('Failed to persist normalized HOME configurations');
    const savedStart = home.indexOf('private fun savedConfigurations(): JSONArray');
    const savedEnd = home.indexOf('private fun savedLayoutShortcutPrefs()', savedStart);
    const savedBlock = home.slice(savedStart, savedEnd);
    expect(savedBlock).not.toContain('.apply()');
    expect(savedBlock).toContain('.commit()');
    expect(home).toContain('Unsupported HOME config schema');
  });

  it('supports a device-local default HOME configuration without claiming V1 parity', () => {
    expect(home).toContain('applyDefaultHomeConfiguration()');
    expect(home).toContain('private fun setDefaultHomeConfiguration(item: JSONObject)');
    expect(home).toContain('putString("v2_default_home_config", safe.toString()).commit()');
    expect(home).toContain('arrayOf("Áp dụng", "Đặt làm mặc định", "Xóa cấu hình")');
    expect(home).toContain('editor.remove("v2_default_home_config")');
    expect(home).toContain('Corrupt or unsupported default HOME configuration');
  });

  it('stops retired HOME video decoders before rerender and during Activity teardown', () => {
    expect(home).toContain('private var homeVideo: VideoView? = null');
    expect(home).toContain('private fun releaseHomeVideo()');
    const release = home.slice(home.indexOf('private fun releaseHomeVideo()'), home.indexOf('private fun shape('));
    expect(release).toContain('video.setOnPreparedListener(null)');
    expect(release).toContain('video.stopPlayback()');
    expect(release).toContain('homeVideo = null');

    const renderStart = home.indexOf('private fun render()');
    expect(renderStart).toBeGreaterThanOrEqual(0);
    const renderNight = home.indexOf('val night = prefs.getBoolean', renderStart);
    expect(renderNight).toBeGreaterThan(renderStart);
    const rerender = home.slice(renderStart, renderNight);
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
    expect(home).toContain('putString("driver_name", name).commit()');
    expect(home).toContain('Không thể lưu tên tài xế V2');
    expect(home).toContain('editDriverName()');
    expect(home).toContain('Cấu hình đã lưu');
    expect(home).toContain('Lưu cấu hình');
    expect(home).toContain('getSharedPreferences("ultracar_v2_home", Context.MODE_PRIVATE)');
  });
});
