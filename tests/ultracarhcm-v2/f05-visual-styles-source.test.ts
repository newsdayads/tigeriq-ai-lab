import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const base = new URL('../../apps/ultracarhcm-v2/app/src/main/java/ai/tigeriq/ultracarhcm/v2/', import.meta.url);
const rules = readFileSync(new URL('GuideStyleRules.kt', base), 'utf8');
const view = readFileSync(new URL('DynamicGuideView.kt', base), 'utf8');
const camera = readFileSync(new URL('UsbCameraActivity.kt', base), 'utf8');

describe('GH-5135 F05 three visual guides without fake gear-R or UVC evidence', () => {
  it('supports precisely the three Owner-observed V1 styles', () => {
    for (const value of ['SPORT_RACING','LUXURY_OEM','MINIMALIST_MODERN']) expect(rules).toContain(value);
    expect(rules).toContain('val DEFAULT = GuideStyle.SPORT_RACING');
    expect(rules).toContain('fun parse(raw: String?)');
    expect(view).toContain('visualStyle: GuideStyle');
    expect(view).toContain('GuideStyleRules.palette(visualStyle)');
  });

  it('persists user selection and retains all three distance markings', () => {
    expect(camera).toContain('chooseVisualGuideStyle()');
    expect(camera).toContain('.putString(GuideStyleRules.PREF_STYLE, selected.name)');
    expect(camera).toContain('.commit()');
    expect(camera).toContain('guide.updateStyle(selected)');
    expect(view).toContain('label = "1.5m"');
    expect(view).toContain('label = "1.0m"');
    expect(view).toContain('label = "0.5m"');
  });

  it('rejects infinite sensor geometry and never claims reverse gear from UI action', () => {
    expect(view).toContain('state.steeringDegrees.takeIf { it.isFinite() } ?: 0f');
    expect(view).toContain('state.warp.takeIf { it.isFinite() } ?: 1f');
    expect(view).toContain('progress.takeIf { it.isFinite() } ?: 0f');
    expect(camera).toContain('if (cameraFrameActive && guide.curveState.reverseActive) View.VISIBLE else View.GONE');
    expect(camera).not.toContain('fakeReverse');
    expect(camera).not.toContain('simulateGearR');
  });
});
