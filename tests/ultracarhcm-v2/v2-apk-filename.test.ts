import { describe, expect, it } from 'vitest';
import { FIRST_V2_APK_NAME, parseV2ApkName, formatV2ApkName, nextV2ApkName } from '../../apps/ultracarhcm-v2/release/v2-apk-filename.mjs';

describe('GH-5135 Owner short APK naming policy', () => {
  it('starts with exactly UltraCarHCM-V2.00.00.apk', () => {
    expect(nextV2ApkName([])).toBe(FIRST_V2_APK_NAME);
    expect(parseV2ApkName(FIRST_V2_APK_NAME)).toBe(0);
  });

  it('increments automatically without any build/hash/dev suffix', () => {
    expect(nextV2ApkName(['UltraCarHCM-V2.00.00.apk'])).toBe('UltraCarHCM-V2.00.01.apk');
    expect(nextV2ApkName(['UltraCarHCM-V2.00.99.apk'])).toBe('UltraCarHCM-V2.01.00.apk');
    expect(nextV2ApkName(['UltraCarHCM-V2.99.98.apk'])).toBe('UltraCarHCM-V2.99.99.apk');
    expect(nextV2ApkName(['report.json', 'UltraCarHCM-V2.00.04.apk', 'UltraCarHCM-V2.00.02.apk'])).toBe('UltraCarHCM-V2.00.05.apk');
  });

  it('rejects overflow, incompatible legacy filenames and invalid inputs', () => {
    expect(() => nextV2ApkName(['UltraCarHCM-V2.99.99.apk'])).toThrow('V2_FILENAME_SEQUENCE_EXHAUSTED');
    expect(parseV2ApkName('UltraCarHCM_V2_2.0.0_dev11_MAIN.apk')).toBeNull();
    expect(parseV2ApkName('UltraCarHCM-V2.00.01_SIGNED_TEST.apk')).toBeNull();
    expect(() => nextV2ApkName('UltraCarHCM-V2.00.00.apk' as any)).toThrow('DRIVE_FILENAMES_ARRAY_REQUIRED');
    expect(() => formatV2ApkName(10000)).toThrow('V2_VERSION_SEQUENCE_OUT_OF_RANGE');
    expect(formatV2ApkName(9999)).toBe('UltraCarHCM-V2.99.99.apk');
  });
});
