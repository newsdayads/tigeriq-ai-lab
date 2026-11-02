// GH-5135 F04/F06 — source contract only; device acceptance remains separate.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const camera = readFileSync(
  new URL('../../apps/ultracarhcm-v2/app/src/main/java/ai/tigeriq/ultracarhcm/v2/UsbCameraActivity.kt', import.meta.url),
  'utf8',
);
const rules = readFileSync(
  new URL('../../apps/ultracarhcm-v2/app/src/main/java/ai/tigeriq/ultracarhcm/v2/CameraDisplayRules.kt', import.meta.url),
  'utf8',
);

describe('GH-5135 camera display affinity source contract', () => {
  it('toggles only a started-visible existing camera on the requested display', () => {
    expect(camera).toContain('private var startedVisible = false');
    expect(camera).toContain('visible.get()?.takeUnless { it.isFinishing || !it.startedVisible }');
    expect(camera).toContain('CameraDisplayRules.shouldToggleExisting(existingDisplayId, displayId)');
    expect(camera).toContain('existing?.window?.decorView?.display?.displayId');
    const start = camera.slice(
      camera.indexOf('override fun onStart()'),
      camera.indexOf('override fun onStop()'),
    );
    expect(start).toContain('startedVisible = true');
    const stop = camera.slice(
      camera.indexOf('override fun onStop()'),
      camera.indexOf('override fun onDestroy()'),
    );
    expect(stop).toContain('startedVisible = false');
    expect(stop.indexOf('startedVisible = false')).toBeLessThan(
      stop.indexOf('resumeCameraOnStart = camera.requested'),
    );
  });

  it('uses a dedicated task when moving camera to another display', () => {
    expect(camera).toContain('Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_MULTIPLE_TASK');
    expect(camera).toContain('existing.runOnUiThread { existing.finish() }');
  });

  it('fails closed instead of launching on an unspecified display', () => {
    expect(camera).toContain('if (!CameraDisplayRules.allowUnspecifiedFallback(displayId))');
    expect(camera).toContain('Refusing unspecified fallback for explicit display=$displayId');
    expect(rules).toContain('requestedDisplayId < 0');
  });
});
