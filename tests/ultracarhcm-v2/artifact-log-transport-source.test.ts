import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const fixture=readFileSync(
  new URL('./android-native-fixture.test.ts',import.meta.url),
  'utf8',
);
const transport=readFileSync(
  new URL('./artifact-log-transport.ts',import.meta.url),
  'utf8',
);

describe('GH-5135 unsigned exact-head handoff transport safety',()=>{
  it('builds release, aligns it, proves unsigned and pins exact V2 identity',()=>{
    expect(fixture).toContain("':app:assembleRelease'");
    expect(fixture).toContain('app-release-unsigned.apk');
    expect(fixture).toContain('Release APK must remain unsigned before handoff');
    expect(fixture).toContain('Aligned handoff must remain unsigned');
    expect(fixture).toContain("run(zipalign,['-f','4'");
    expect(fixture).toContain(
      "package: name='ai.tigeriq.ultracarhcm.v2' versionCode='11' versionName='2.0.0-dev.11'",
    );
  });

  it('uses tokenless bounded CI log transport only for GH-5135/main UltraCar scope',()=>{
    expect(transport).toContain("workflow !== 'CI'");
    expect(transport).toContain("const GH5135_BRANCH_PREFIX = 'nv02/gh5135-'");
    expect(transport).toContain("'apps/ultracarhcm-v2/'");
    expect(transport).toContain("'tests/ultracarhcm-v2/'");
    expect(transport).toContain('GH5135_ARTIFACT_B64_BEGIN');
    expect(transport).not.toMatch(/ACTIONS_RUNTIME_TOKEN|GITHUB_TOKEN|password|credential|keystore|DPAPI/i);
  });

  it('never signs, installs, publishes Drive or claims release acceptance',()=>{
    expect(fixture).not.toMatch(/apksigner['"]?\s*,?\s*['"]sign|adb\s+install|pm\s+install/i);
    expect(fixture).not.toMatch(/Google Drive|G:\\Drive/i);
    expect(fixture).toContain('ANDROID_R01_CLEAN_CLONE_NATIVE_BUILD_PASS_NOT_FOR_RELEASE');
    expect(fixture).toContain('ANDROID_UNSIGNED_ARTIFACT_LOG_TRANSPORT_PASS');
  });
});
