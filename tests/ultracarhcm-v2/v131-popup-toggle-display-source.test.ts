import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const base = new URL('../../apps/ultracarhcm-v2/app/src/main/java/ai/tigeriq/ultracarhcm/v2/', import.meta.url);
const camera = readFileSync(new URL('UsbCameraActivity.kt', base), 'utf8');
const windowRules = readFileSync(new URL('CameraWindowBoundsRules.kt', base), 'utf8');

describe('GH-5135 V1.2.31 Camera popup visual behavior', () => {
  it('short-taps toggle the actual camera popup; CAM inside still controls USB feed', () => {
    expect(camera).toContain('CameraDisplayRules.shouldToggleExisting(existingDisplayId, displayId)');
    expect(camera).toContain('existing?.runOnUiThread { existing.finish() }');
    expect(camera).not.toContain('existing?.runOnUiThread { existing.toggle() }');
    expect(camera).toContain('private fun toggle()');
    expect(camera).toContain('camera.stop()');
  });
  it('uses DeX display-specific pixels and requests freeform bounds only for external displays', () => {
    expect(camera).toContain('displayId != Display.DEFAULT_DISPLAY');
    expect(camera).toContain('context.createDisplayContext(display).resources.displayMetrics.density');
    expect(camera).toContain('opts.launchBounds = Rect(bounds.left, bounds.top, bounds.right, bounds.bottom)');
    expect(windowRules).toContain('displayWidth < 800 || displayHeight < 550');
    expect(windowRules).toContain('displayDensity.isFinite()');
    expect(camera).toContain('Refusing unspecified fallback for explicit display=$displayId');
  });
});
