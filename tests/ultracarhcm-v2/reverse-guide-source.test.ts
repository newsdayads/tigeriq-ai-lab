// GH-5135: V1.0.64 dynamic reverse-guide source contract.
// Source assertions do not claim calibrated steering/CAN integration or real vehicle QA.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const guide = readFileSync(
  new URL('../../apps/ultracarhcm-v2/app/src/main/java/ai/tigeriq/ultracarhcm/v2/DynamicGuideView.kt', import.meta.url),
  'utf8',
);
const camera = readFileSync(
  new URL('../../apps/ultracarhcm-v2/app/src/main/java/ai/tigeriq/ultracarhcm/v2/UsbCameraActivity.kt', import.meta.url),
  'utf8',
);

describe('GH-5135 V1.0.64 reverse guide source contract', () => {
  it('provides the four reconstructed guide surfaces without claiming JNI calibration', () => {
    expect(guide).toContain('data class GuideCurveState');
    expect(guide).toContain('class DynamicGuideView');
    expect(guide).toContain('open class GuideTrackView');
    expect(guide).toContain('class NativeGuideWarpView');
    expect(guide).toContain('no native/JNI implementation is claimed');
  });

  it('uses curved perspective geometry instead of the old three static lines', () => {
    expect(guide).toContain('val lateralCurve = steeringRatio * 0.24f * p * p * normalized.warp');
    expect(guide).toContain('val halfWidth = halfWidthBottom + (halfWidthTop - halfWidthBottom) * p');
    expect(guide).toContain('drawBoundary(canvas, -1)');
    expect(guide).toContain('drawBoundary(canvas, 1)');
    expect(camera).not.toContain('listOf(.43f,.57f,.73f)');
  });

  it('fails closed unless an explicit reverse signal is supplied', () => {
    expect(camera).toContain('EXTRA_REVERSE_ACTIVE');
    expect(camera).toContain('intent.getBooleanExtra(EXTRA_REVERSE_ACTIVE, current.reverseActive)');
    expect(camera).toContain('cameraFrameActive && guide.curveState.reverseActive');
    expect(camera).not.toContain('reverseActive = true');
  });

  it('accepts steering updates on new intents without fabricating a hardware signal source', () => {
    expect(camera).toContain('EXTRA_STEERING_DEGREES');
    expect(camera).toContain('setIntent(intent)');
    expect(camera).toContain('applyReverseGuideIntent(intent)');
    expect(camera).toContain('intent.hasExtra(EXTRA_REVERSE_ACTIVE)');
    expect(camera).toContain('intent.hasExtra(EXTRA_STEERING_DEGREES)');
    expect(camera).toContain('intent.getFloatExtra(EXTRA_STEERING_DEGREES, current.steeringDegrees)');
    expect(camera).toContain('Chưa hiệu chuẩn khoảng cách/góc lái và chưa nghiệm thu trên xe');
  });
});
