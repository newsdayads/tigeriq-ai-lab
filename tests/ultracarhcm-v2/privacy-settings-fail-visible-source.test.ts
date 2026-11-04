// GH-5135 F20 — Android Settings handoff must fail visibly without bypassing permissions.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const privacy = readFileSync(
  new URL('../../apps/ultracarhcm-v2/app/src/main/java/ai/tigeriq/ultracarhcm/v2/PrivacyActivity.kt', import.meta.url),
  'utf8',
);

describe('GH-5135 F20 privacy settings fail-visible handoff', () => {
  it('routes both external settings actions through the guarded launcher', () => {
    expect(privacy).toContain('Settings.ACTION_APPLICATION_DETAILS_SETTINGS');
    expect(privacy).toContain('Settings.ACTION_MANAGE_OVERLAY_PERMISSION');
    expect(privacy.match(/openSystemSettings\(/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it('catches OEM/runtime launch failures and shows a user-visible result', () => {
    const start = privacy.indexOf('private fun openSystemSettings');
    const end = privacy.indexOf('private fun hasPermission', start);
    const block = privacy.slice(start, end);
    expect(block).toContain('try {');
    expect(block).toContain('startActivity(intent)');
    expect(block).toContain('catch (error: RuntimeException)');
    expect(block).toContain('Unable to open Android settings');
    expect(block).toContain('Toast.makeText');
  });

  it('does not grant or mutate Android permissions itself', () => {
    expect(privacy).not.toMatch(/pm grant|WRITE_SECURE_SETTINGS|Runtime\.getRuntime|ProcessBuilder/i);
    expect(privacy).not.toMatch(/setDrawOverlays|grantRuntimePermission/i);
  });
});
