// GH-5135 F04 — V1 camera-window chrome parity from Owner reference video.
// Source contract only; this does not claim USB/DeX device acceptance.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const camera = readFileSync(
  new URL('../../apps/ultracarhcm-v2/app/src/main/java/ai/tigeriq/ultracarhcm/v2/UsbCameraActivity.kt', import.meta.url),
  'utf8',
);

describe('GH-5135 F04 minimal camera-window chrome', () => {
  it('keeps the UVC texture and reverse guide unobstructed by the former full-width panel', () => {
    expect(camera).toContain('root.addView(texture, FrameLayout.LayoutParams(-1, -1))');
    expect(camera).toContain('root.addView(guide, FrameLayout.LayoutParams(-1, -1))');
    expect(camera).not.toContain('UltraCarHCM V2 — Camera USB');
    expect(camera).not.toContain('orientation = LinearLayout.VERTICAL');
  });

  it('matches the observed V1 compact close and camera controls', () => {
    expect(camera).toContain('text = "×"');
    expect(camera).toContain('Gravity.TOP or Gravity.END');
    expect(camera).toContain('text = "CAM"');
    expect(camera).toContain('Gravity.BOTTOM or Gravity.END');
    expect(camera).toContain('contentDescription = "ĐÓNG CỬA SỔ"');
  });

  it('retains manual camera toggle semantics and only shows status when needed', () => {
    expect(camera).toContain('setOnClickListener { toggle() }');
    expect(camera).toContain('if (camera.requested)');
    expect(camera).toContain('camera.stop()');
    expect(camera).toContain('camera.start()');
    expect(camera).toContain('status.visibility = if (active) View.GONE else View.VISIBLE');
  });
});
