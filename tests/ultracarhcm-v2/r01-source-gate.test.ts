// GH-5135 R01 SOURCE contract. Green here does NOT imply native Android build/QA.
// Automatically discovered by root vitest.config.ts include 'tests/**/*.test.ts'.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, it, expect } from 'vitest';

const root = process.cwd();
const fromRoot = (path: string) => resolve(root, path);
const app = 'apps/ultracarhcm-v2/';
const media = [
  'drawable/v2_car_lambogini_trang_parked',
  'drawable/v2_car_limo_do_parked',
  'drawable/v2_logo_ultracar',
  'drawable/v2_road_city_day',
  'drawable/v2_road_city_night',
  'raw/ultrabot_glow_packed',
];

describe('GH-5135 R01 source-only gate (not native Android CI)', () => {
  it('uses the official, integrity-checked Gradle 8.2.1 wrapper', () => {
    const jar = readFileSync(fromRoot(app + 'gradle/wrapper/gradle-wrapper.jar'));
    const gitBlob = createHash('sha1')
      .update(Buffer.from('blob ' + jar.length + '\0'))
      .update(jar)
      .digest('hex');
    expect(gitBlob).toBe('033e24c4cdf41af1ab109bc7f253b2b887023340');
    expect(readFileSync(fromRoot(app + 'gradle/wrapper/gradle-wrapper.properties'), 'utf8'))
      .toContain('gradle-8.2.1-bin.zip');
  });

  it('uses published UVCAndroid and never shadows its AGP-generated R class', () => {
    const build = readFileSync(fromRoot(app + 'app/build.gradle'), 'utf8');
    expect(build).toContain("implementation 'com.herohan:UVCAndroid:1.0.13'");
    expect(existsSync(fromRoot(app + 'app/src/main/java/com/serenegiant/uvccamera/R.java')))
      .toBe(false);
    const label = readFileSync(fromRoot(app + 'app/src/main/res/values/strings.xml'), 'utf8');
    expect(label).toContain('<string name="app_name">UltraCarHCM V2</string>');
  });

  it('preserves six unresolved V1 media dependencies, without fake substitutes', () => {
    const probe = spawnSync(process.execPath, [
      fromRoot('tests/ultracarhcm-v2/r01-preflight.mjs'), root
    ], { cwd: root, encoding: 'utf8', timeout: 15000 });
    // Intentionally nonzero: original artwork/video is not in the GitHub source yet.
    expect(probe.status).toBe(2);
    const report = JSON.parse(probe.stdout) as {
      ok: boolean;
      missingFiles: string[];
      missingResources: string[];
    };
    expect(report.ok).toBe(false);
    expect(report.missingFiles).toEqual([]); // Gradle wrapper/module now complete.
    expect(report.missingResources).toEqual([...media].sort());
  });

  it('guards Kotlin UVC preview cleanup during detach, error and close', () => {
    const file = readFileSync(fromRoot(
      app + 'app/src/main/java/ai/tigeriq/ultracarhcm/v2/UsbUvcController.kt'
    ), 'utf8');
    for (const name of ['onCameraClose', 'onDeviceClose', 'onError']) {
      const start = file.indexOf('override fun ' + name + '(');
      expect(start).toBeGreaterThanOrEqual(0);
      const end = file.indexOf('\n    override fun ', start + 13);
      const body = file.slice(start, end < 0 ? undefined : end);
      expect(body).toContain('device == target');
      expect(body).toContain('releasePreview()');
    }
  });
});
