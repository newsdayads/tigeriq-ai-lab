import { expect, test } from 'vitest';
import { ZFold2DeXEmulator, ZFOLD2_PROFILE } from '../../projects/dexcam-personal/zfold2-emulator-runner.mjs';
import { inspectB01 } from '../../projects/dexcam-personal/b01-evidence-admission.mjs';

test('ZFOLD2_PROFILE has standard Samsung Galaxy Z Fold 2 specifications', () => {
  expect(ZFOLD2_PROFILE.device.manufacturer).toBe('Samsung');
  expect(ZFOLD2_PROFILE.device.model).toBe('SM-F916B');
  expect(ZFOLD2_PROFILE.device.android_version).toBe('13');
  expect(ZFOLD2_PROFILE.device.api_level).toBe(33);
  expect(ZFOLD2_PROFILE.device.one_ui_version).toBe('5.1.1');
  expect(ZFOLD2_PROFILE.screens.dex_desktop.width_px).toBe(1920);
  expect(ZFOLD2_PROFILE.screens.dex_desktop.height_px).toBe(1080);
  expect(ZFOLD2_PROFILE.screens.dex_desktop.density_dpi).toBe(160);
  expect(ZFOLD2_PROFILE.screens.dex_desktop.rotation_deg).toBe(0);
  expect(ZFOLD2_PROFILE.uvc_camera.vendor_id).toBe('0x1BCF');
  expect(ZFOLD2_PROFILE.uvc_camera.product_id).toBe('0x2281');
});

test('ZFold2DeXEmulator runs 50 reverse gear cycles successfully with P50/P95 within spec', () => {
  const emulator = new ZFold2DeXEmulator();
  const benchmark = emulator.runReverseCycles(50);

  expect(benchmark.totalCycles).toBe(50);
  expect(benchmark.passedCycles).toBe(50);
  expect(benchmark.allPassed).toBe(true);
  expect(benchmark.p50LatencyMs).toBeLessThan(90);
  expect(benchmark.p95LatencyMs).toBeLessThan(120);
  expect(benchmark.latencyWithinSpec).toBe(true);
});

test('ZFold2DeXEmulator shows CAMERA_UNAVAILABLE when USB is detached instead of frozen frame', () => {
  const emulator = new ZFold2DeXEmulator();
  emulator.detachUsb();

  const engageResult = emulator.engageReverse(70);
  expect(engageResult.ok).toBe(false);
  expect(engageResult.error).toBe('CAMERA_UNAVAILABLE');
  expect(emulator.cameraOverlayBounds?.status).toBe('CAMERA_UNAVAILABLE');

  // Re-attaching restores streaming capability
  emulator.attachUsb();
  const restoredResult = emulator.engageReverse(74);
  expect(restoredResult.ok).toBe(true);
  expect(emulator.cameraOverlayBounds?.status).toBe('STREAMING_1080P_MJPEG');
});

test('ZFold2DeXEmulator restores DeX window layout after reverse gear disengages', () => {
  const emulator = new ZFold2DeXEmulator();
  emulator.engageReverse(75);
  expect(emulator.cameraOverlayBounds).not.toBeNull();

  const disengaged = emulator.disengageReverse();
  expect(disengaged.ok).toBe(true);
  expect(emulator.cameraOverlayBounds).toBeNull();
  expect(disengaged.restoredLayout).toEqual(emulator.currentWindowLayout);
});

test('ZFold2DeXEmulator generated admission record passes B01 structural admission preflight', () => {
  const emulator = new ZFold2DeXEmulator();
  const record = emulator.generateAdmissionRecord();

  const preflight = inspectB01(record);
  expect(preflight.status).toBe('SYNTHETIC_FIXTURE_ONLY');
  expect(preflight.b01_accepted).toBe(false);
  expect(preflight.errors).toEqual([]);
});
