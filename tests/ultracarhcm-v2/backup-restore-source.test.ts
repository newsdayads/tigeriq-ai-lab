// GH-5135 F16: static contract for V2-owned local backup/restore.
// This proves source wiring only, not device acceptance or V1 full backup parity.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const home = readFileSync(
  new URL('../../apps/ultracarhcm-v2/app/src/main/java/ai/tigeriq/ultracarhcm/v2/HomeActivity.kt', import.meta.url),
  'utf8',
);
const rules = readFileSync(
  new URL('../../apps/ultracarhcm-v2/app/src/main/java/ai/tigeriq/ultracarhcm/v2/HomeBackupRules.kt', import.meta.url),
  'utf8',
);

describe('GH-5135 F16 local backup/restore source contract', () => {
  it('uses Android Storage Access Framework instead of broad filesystem permission', () => {
    expect(home).toContain('ActivityResultContracts.CreateDocument("application/json")');
    expect(home).toContain('ActivityResultContracts.OpenDocument()');
    expect(home).toContain('contentResolver.openOutputStream(uri, "wt")');
    expect(home).toContain('contentResolver.openInputStream(uri)');
    expect(home).not.toContain('MANAGE_EXTERNAL_STORAGE');
  });

  it('exports bounded V2-owned Home and Taxi Meter state with an explicit schema', () => {
    expect(home).toContain('private fun exportHomeBackupJson(): JSONObject');
    expect(home).toContain('.put("backupSchemaVersion", HomeBackupRules.CURRENT_BACKUP_SCHEMA_VERSION)');
    expect(home).toContain('.put("quickSlots", normalizedQuickSlotsForStorage(quickSlots()))');
    expect(home).toContain('val savedConfigs = savedConfigurations()');
    expect(home).toContain('.put("savedConfigurations", savedConfigs)');
    expect(home).toContain('.put("savedLayoutShortcuts", exportSavedLayoutShortcuts(savedConfigs))');
    expect(home).toContain('.put("defaultHomeConfiguration", defaultSafe ?: JSONObject.NULL)');
    expect(home).toContain('.put("taxiMeter", exportTaxiMeterBackup())');
    expect(home).toContain('getSharedPreferences(TaxiMeterRules.PREFS_NAME, Context.MODE_PRIVATE)');
    expect(home).toContain('TaxiMeterRules.KEY_HISTORY');
    expect(home).toContain('TaxiMeterRules.KEY_RATE');
    expect(rules).toContain('const val MAX_BACKUP_BYTES = 256 * 1024');
  });

  it('validates the full payload before applying preferences', () => {
    const start = home.indexOf('private fun importHomeBackupJson(text: String): Boolean');
    const end = home.indexOf('private fun editDriverName()');
    const block = home.slice(start, end);
    expect(block).toContain('HomeBackupRules.canReadBackupSchema');
    expect(block).toContain('validatedQuickSlotsForBackup(rawSlots) ?: return false');
    expect(home).toContain('private fun validatedQuickSlotsForBackup(source: JSONArray?): JSONArray?');
    expect(home).toContain('rawLabel !is String || rawTarget !is String');
    expect(home).toContain('QuickSlotRules.isValidPersistedAssignment(rawLabel, rawTarget)');
    expect(block).toContain('rawConfigs.length() > HomeConfigRules.MAX_SAVED');
    expect(block).toContain('validatedHomeConfigurationForBackup(item) ?: return false');
    expect(block).toContain('HomeBackupRules.requiresTaxiMeterState(backupSchema)');
    expect(block).toContain('validatedTaxiHistoryForBackup(rawHistory) ?: return false');
    expect(home).toContain('private fun validatedTaxiHistoryForBackup(source: JSONArray?): JSONArray?');
    expect(home).toContain('source.length() > TaxiMeterRules.MAX_HISTORY');
    expect(home).toContain('private fun validatedHomeConfigurationForBackup(item: JSONObject): JSONObject?');
    expect(block).toContain('val editor = prefs.edit()');
    expect(block.indexOf('val editor = prefs.edit()')).toBeGreaterThan(block.indexOf('validatedHomeConfigurationForBackup(item) ?: return false'));
    expect(block).toContain('if (!editor.commit()) return false');
  });

  it('fails visibly unless every restore preference domain commits synchronously', () => {
    const start = home.indexOf('private fun importHomeBackupJson(text: String): Boolean');
    const end = home.indexOf('private fun editDriverName()');
    const block = home.slice(start, end);

    expect(block).toContain('if (!editor.commit()) return false');
    expect(block).toContain('if (!shortcutEditor.commit()) return false');
    expect(block).toContain('if (!overlayEditor.commit()) return false');
    expect(block).toContain('if (!taxiEditor.commit()) return false');
    expect(block).not.toContain('.apply()');
    expect(home).toContain('Không thể khôi phục: tệp không hợp lệ hoặc ghi dữ liệu thất bại');
  });

  it('rejects JSON scalar coercion before restore writes', () => {
    expect(rules).toContain('fun exactBoolean(value: Any?): Boolean? = value as? Boolean');
    expect(rules).toContain('fun exactString(value: Any?): String? = value as? String');
    expect(rules).toContain('fun exactInt(value: Any?): Int?');
    expect(home).toContain('HomeBackupRules.exactInt(root.opt("backupSchemaVersion")) ?: return false');
    expect(home).toContain('HomeBackupRules.exactBoolean(root.opt("night")) ?: return false');
    expect(home).toContain('HomeBackupRules.exactBoolean(root.opt("limo")) ?: return false');
    expect(home).toContain('HomeBackupRules.exactString(root.opt("driver")) ?: return false');
    expect(home).toContain('HomeBackupRules.exactString(root.opt("vehicleModel")) ?: return false');
    expect(home).toContain('HomeBackupRules.exactString(root.opt("licensePlate")) ?: return false');
    expect(home).toContain('HomeBackupRules.exactInt(item.opt("displayId")) ?: return false');
    expect(home).toContain('HomeBackupRules.exactInt(item.opt("x")) ?: return false');
    expect(home).toContain('HomeBackupRules.exactInt(item.opt("y")) ?: return false');
    expect(home).toContain('HomeBackupRules.exactLong(item.opt("startedAt")) ?: return null');
    expect(home).toContain('HomeBackupRules.exactDouble(item.opt("distanceMeters")) ?: return null');
    expect(home).toContain('TaxiMeterRules.validRateVndPerKm(rate)');
  });

  it('backs up and restores bounded DeX camera overlay positions without changing legacy v1 backups', () => {
    expect(home).toContain('private fun exportOverlayPositions(): JSONArray');
    expect(home).toContain('getSharedPreferences("v2_camera_shortcut", Context.MODE_PRIVATE)');
    expect(home).toContain('.put("overlayPositions", exportOverlayPositions())');
    expect(home).toContain('HomeBackupRules.requiresOverlayPositions(backupSchema)');
    expect(home).toContain('rawOverlayPositions.length() > HomeBackupRules.MAX_OVERLAY_DISPLAYS');
    expect(home).toContain('!seenDisplays.add(displayId)');
    expect(home).toContain('.edit().clear()');
    expect(home).toContain('OverlayPositionRules.xKey(displayId)');
    expect(home).toContain('OverlayPositionRules.yKey(displayId)');
    expect(rules).toContain('const val LEGACY_BACKUP_SCHEMA_VERSION = 1');
    expect(rules).toContain('const val CURRENT_BACKUP_SCHEMA_VERSION = 5');
    expect(rules).toContain('version in LEGACY_BACKUP_SCHEMA_VERSION..CURRENT_BACKUP_SCHEMA_VERSION');
    expect(rules).toContain('fun requiresVehicleState(version: Int): Boolean');
    expect(home).toContain('"vehicleModel"');
    expect(home).toContain('"licensePlate"');
    expect(home).toContain('VehicleRules.PREF_MODEL');
    expect(home).toContain('VehicleRules.PREF_LICENSE_PLATE');
  });

  it('preserves Taxi Meter state from schema v4 while keeping older backups non-destructive', () => {
    expect(rules).toContain('fun requiresTaxiMeterState(version: Int): Boolean');
    expect(rules).toContain('version >= 4');
    expect(home).toContain('val replaceTaxiMeterState = HomeBackupRules.requiresTaxiMeterState(backupSchema)');
    expect(home).toContain('if (replaceTaxiMeterState)');
    expect(home).toContain('.putString(TaxiMeterRules.KEY_HISTORY, safeTaxiHistory.toString())');
    expect(home).toContain('taxiEditor.remove(TaxiMeterRules.KEY_RATE)');
  });

  it('backs up five stable saved-layout shortcuts in schema v5 and validates references before writes', () => {
    expect(rules).toContain('fun requiresSavedLayoutShortcuts(version: Int): Boolean');
    expect(rules).toContain('version >= 5');
    expect(home).toContain('private fun exportSavedLayoutShortcuts(savedConfigs: JSONArray): JSONArray');
    expect(home).toContain('SavedLayoutShortcutRules.SLOT_COUNT');
    expect(home).toContain('knownConfigIds.contains(configId)');
    expect(home).toContain('val replaceSavedLayoutShortcuts =');
    expect(home).toContain('HomeBackupRules.requiresSavedLayoutShortcuts(backupSchema)');
    expect(home).toContain('rawSavedLayoutShortcuts.length() != SavedLayoutShortcutRules.SLOT_COUNT');
    expect(home).toContain('!safeConfigIds.contains(configId)');
    expect(home).toContain('val shortcutEditor = savedLayoutShortcutPrefs().edit().clear()');
    const start = home.indexOf('private fun importHomeBackupJson(text: String): Boolean');
    const end = home.indexOf('private fun editDriverName()');
    const block = home.slice(start, end);
    expect(block.indexOf('val editor = prefs.edit()')).toBeGreaterThan(
      block.indexOf('!safeConfigIds.contains(configId)'),
    );
    expect(block).toContain('if (replaceSavedLayoutShortcuts)');
  });

  it('refreshes an active DeX overlay immediately after a successful restore', () => {
    expect(home).toContain('private fun refreshOverlayAfterRestore()');
    expect(home).toContain('OverlayService.EXTRA_FORCE_REATTACH');
    expect(home).toMatch(/importHomeBackupJson\(text\)[\s\S]*render\(\)[\s\S]*refreshOverlayAfterRestore\(\)/);
  });

  it('exposes explicit backup and restore actions without touching V1 data', () => {
    expect(home).toContain('"Sao lưu dữ liệu V2"');
    expect(home).toContain('"Khôi phục dữ liệu V2"');
    expect(home).toContain('exportBackupLauncher.launch(HomeBackupRules.exportFileName())');
    expect(home).toContain('importBackupLauncher.launch(arrayOf("application/json", "text/plain"))');
    expect(home).toContain('getSharedPreferences("ultracar_v2_home", Context.MODE_PRIVATE)');
  });
});
