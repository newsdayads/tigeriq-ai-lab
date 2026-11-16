import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const base = new URL('../../apps/ultracarhcm-v2/app/src/main/', import.meta.url);
const source = (path: string) => readFileSync(new URL(path, base), 'utf8');
const rules = source('java/ai/tigeriq/ultracarhcm/v2/RemoteKeyRules.kt');
const service = source('java/ai/tigeriq/ultracarhcm/v2/RemoteKeyAccessibilityService.kt');
const config = source('java/ai/tigeriq/ultracarhcm/v2/RemoteKeyConfigActivity.kt');
const manifest = source('AndroidManifest.xml');
const configXml = source('res/xml/remote_key_accessibility_v2.xml');
const home = source('java/ai/tigeriq/ultracarhcm/v2/HomeActivity.kt');

describe('GH-5135 V1.2.31 remote key behavior reconstructed with owner permission', () => {
  it('registers a user-enabled Android accessibility service with bounded key filter', () => {
    expect(manifest).toContain('android.permission.BIND_ACCESSIBILITY_SERVICE');
    expect(manifest).toContain('.RemoteKeyAccessibilityService');
    expect(manifest).toContain('@xml/remote_key_accessibility_v2');
    expect(configXml).toContain('android:canRequestFilterKeyEvents="true"');
    expect(config).toContain('Settings.ACTION_ACCESSIBILITY_SETTINGS');
    expect(service).toContain('settings.getBoolean(RemoteKeyRules.ENABLED, false)');
  });
  it('captures only replayable Bluetooth media/volume keys, not system navigation', () => {
    expect(rules).toContain('KEYCODE_MEDIA_PLAY_PAUSE');
    expect(rules).toContain('KEYCODE_HEADSETHOOK');
    expect(rules).toContain('KEYCODE_VOLUME_UP');
    expect(rules).not.toContain('KEYCODE_HOME,');
    expect(rules).not.toContain('KEYCODE_BACK,');
    expect(service).toContain('RemoteKeyRules.safeToMap(assigned)');
    expect(service).toContain('AudioManager');
    expect(service).toContain('dispatchMediaKeyEvent');
  });
  it('uses one real camera route and retains manual control without fake gear input', () => {
    expect(service).toContain('UsbCameraActivity.toggleFromShortcut(this, requestedDisplay)');
    expect(service).not.toContain('EXTRA_REVERSE_ACTIVE');
    expect(service).not.toContain('WRITE_SECURE_SETTINGS');
    expect(config).toContain('RemoteKeyAccessibilityService.learnNext');
    expect(home).toContain('RemoteKeyConfigActivity::class.java');
  });
});
