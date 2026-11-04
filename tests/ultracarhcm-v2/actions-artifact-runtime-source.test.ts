import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const fixture = readFileSync(
  new URL('./android-native-fixture.test.ts', import.meta.url),
  'utf8',
);
const uploader = readFileSync(
  new URL('./actions-artifact-runtime.ts', import.meta.url),
  'utf8',
);

describe('GH-5135 exact-head unsigned artifact safety contract', () => {
  it('builds release, proves it unsigned, aligns it and pins V2 package identity', () => {
    expect(fixture).toContain("':app:assembleRelease'");
    expect(fixture).toContain("app-release-unsigned.apk");
    expect(fixture).toContain("Release APK must remain unsigned before handoff");
    expect(fixture).toContain("Aligned handoff must remain unsigned");
    expect(fixture).toContain("zipalign,['-f','4'");
    expect(fixture).toContain("package: name='ai.tigeriq.ultracarhcm.v2' versionCode='11' versionName='2.0.0-dev.11'");
  });

  it('uploads only through ephemeral Actions artifact runtime and never signs, installs or changes credentials', () => {
    expect(uploader).toContain('ACTIONS_RUNTIME_TOKEN');
    expect(uploader).toContain('ACTIONS_RESULTS_URL');
    expect(uploader).toContain('Actions.Results:');
    expect(uploader).toContain("'x-ms-blob-type': 'BlockBlob'");
    expect(uploader).not.toMatch(/apksigner\s+sign|keystore|DPAPI|password|credential/i);
    expect(fixture).not.toMatch(/apksigner['\"]?\s*,?\s*['\"]sign|adb\s+install|pm\s+install/i);
    expect(fixture).toContain('ANDROID_UNSIGNED_ARTIFACT_UPLOAD_PASS_NOT_SIGNED_NOT_RELEASED');
  });

  it('keeps artifact creation scoped to GH-5135 branches or relevant main pushes', () => {
    expect(uploader).toContain("const GH5135_BRANCH_PREFIX = 'nv02/gh5135-'");
    expect(uploader).toContain("'apps/ultracarhcm-v2/'");
    expect(uploader).toContain("'tests/ultracarhcm-v2/'");
    expect(uploader).toContain("event.ref !== 'refs/heads/main'");
  });
});
