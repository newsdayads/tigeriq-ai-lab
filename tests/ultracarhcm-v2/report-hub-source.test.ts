import {describe, expect, it} from 'vitest';
import {readFileSync} from 'node:fs';

const root = new URL('../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');

describe('GH-5135 F19 trip report hub source', () => {
  const report = read('apps/ultracarhcm-v2/app/src/main/java/ai/tigeriq/ultracarhcm/v2/ReportActivity.kt');
  const profile = read('apps/ultracarhcm-v2/app/src/main/java/ai/tigeriq/ultracarhcm/v2/ProfileActivity.kt');
  const manifest = read('apps/ultracarhcm-v2/app/src/main/AndroidManifest.xml');

  it('uses only V2 Taxi Meter history and SAF CSV export', () => {
    expect(report).toContain('getSharedPreferences(TaxiMeterRules.PREFS_NAME, Context.MODE_PRIVATE)');
    expect(report).toContain('TaxiMeterRules.KEY_HISTORY');
    expect(report).toContain('ActivityResultContracts.CreateDocument("text/csv")');
    expect(report).toContain('contentResolver.openOutputStream(uri, "wt")');
  });

  it('is reachable from Profile and registered as a private activity', () => {
    expect(profile).toContain('Intent(this@ProfileActivity, ReportActivity::class.java)');
    expect(profile).toContain('MỞ BÁO CÁO CHUYẾN');
    expect(manifest).toContain('<activity android:name=".ReportActivity" android:exported="false"');
  });

  it('does not add broad storage or install permissions', () => {
    expect(manifest).not.toContain('READ_EXTERNAL_STORAGE');
    expect(manifest).not.toContain('WRITE_EXTERNAL_STORAGE');
    expect(manifest).not.toContain('MANAGE_EXTERNAL_STORAGE');
    expect(manifest).not.toContain('REQUEST_INSTALL_PACKAGES');
  });
});
