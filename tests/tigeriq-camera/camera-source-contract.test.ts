import { readFileSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const manifestPath = new URL('../../apps/tigeriq-camera/app/src/main/AndroidManifest.xml', import.meta.url);
const guideModelPath = new URL('../../apps/tigeriq-camera/app/src/main/java/ai/tigeriq/camera/GuideTrackModel.kt', import.meta.url);
const guideViewPath = new URL('../../apps/tigeriq-camera/app/src/main/java/ai/tigeriq/camera/DynamicGuideView.kt', import.meta.url);
const cameraActivityPath = new URL('../../apps/tigeriq-camera/app/src/main/java/ai/tigeriq/camera/CameraActivity.kt', import.meta.url);
const floatingServicePath = new URL('../../apps/tigeriq-camera/app/src/main/java/ai/tigeriq/camera/FloatingCameraService.kt', import.meta.url);
const reverseReceiverPath = new URL('../../apps/tigeriq-camera/app/src/main/java/ai/tigeriq/camera/ReverseGearReceiver.kt', import.meta.url);
const usbReceiverPath = new URL('../../apps/tigeriq-camera/app/src/main/java/ai/tigeriq/camera/UsbAttachReceiver.kt', import.meta.url);
const uvcManagerPath = new URL('../../apps/tigeriq-camera/app/src/main/java/ai/tigeriq/camera/UsbUvcManager.kt', import.meta.url);

describe('TigerIQ Camera Standalone Architecture & Reverse Guide Contract', () => {
  it('ensures all core components and Kotlin source files exist', () => {
    expect(existsSync(manifestPath)).toBe(true);
    expect(existsSync(guideModelPath)).toBe(true);
    expect(existsSync(guideViewPath)).toBe(true);
    expect(existsSync(cameraActivityPath)).toBe(true);
    expect(existsSync(floatingServicePath)).toBe(true);
    expect(existsSync(reverseReceiverPath)).toBe(true);
    expect(existsSync(usbReceiverPath)).toBe(true);
    expect(existsSync(uvcManagerPath)).toBe(true);
  });

  it('declares necessary hardware features and permissions in AndroidManifest.xml', () => {
    const manifest = readFileSync(manifestPath, 'utf8');
    expect(manifest).toContain('android.hardware.usb.host');
    expect(manifest).toContain('android.permission.CAMERA');
    expect(manifest).toContain('android.permission.SYSTEM_ALERT_WINDOW');
    expect(manifest).toContain('android.permission.FOREGROUND_SERVICE');
    expect(manifest).toContain('android:name=".ReverseGearReceiver"');
    expect(manifest).toContain('android:name=".FloatingCameraService"');
    expect(manifest).toContain('android:name=".UsbAttachReceiver"');
    expect(manifest).toContain('android:name=".CameraActivity"');
  });

  it('inherits the exact V1/V2 dynamic reverse guidelines specification', () => {
    const model = readFileSync(guideModelPath, 'utf8');
    const view = readFileSync(guideViewPath, 'utf8');

    // Geometry & Perspective invariants
    expect(model).toContain('MAX_STEERING_DEGREES = 35f');
    expect(model).toContain('halfWidthBottom = 0.235f');
    expect(model).toContain('halfWidthTop = 0.070f');
    expect(model).toContain('val lateralCurve = steeringRatio * 0.24f * p * p * normalized.warp');

    // Visual distance markers
    expect(model).toContain('progress = 0.72f, label = "1.5m"');
    expect(model).toContain('progress = 0.48f, label = "1.0m"');
    expect(model).toContain('progress = 0.22f, label = "0.5m"');

    // Color definitions
    expect(view).toContain('Color.rgb(239, 68, 68)');
    expect(view).toContain('Color.rgb(234, 179, 8)');
    expect(view).toContain('Color.rgb(34, 197, 94)');
  });

  it('provides dedicated, deterministic Reverse Gear handling without launcher coupling', () => {
    const receiver = readFileSync(reverseReceiverPath, 'utf8');
    expect(receiver).toContain('class ReverseGearReceiver : BroadcastReceiver()');
    expect(receiver).toContain('ACTION_REVERSE_GEAR = "ai.tigeriq.camera.action.REVERSE_GEAR"');
    expect(receiver).toContain('isReverse');
    expect(receiver).toContain('CameraActivity.launch(');
    expect(receiver).toContain('reverseActive = true');
    expect(receiver).toContain('CameraActivity.dismissIfRunning');
  });

  it('provides dedicated Floating popup button service with drag and click handling', () => {
    const service = readFileSync(floatingServicePath, 'utf8');
    expect(service).toContain('class FloatingCameraService : Service()');
    expect(service).toContain('WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY');
    expect(service).toContain('findDexDisplay');
    expect(service).toContain('attachTouchListener');
    expect(service).toContain('CameraActivity.launch');
  });

  it('integrates genuine USB UVC camera engine using UVCAndroid', () => {
    const uvc = readFileSync(uvcManagerPath, 'utf8');
    expect(uvc).toContain('com.herohan.uvcapp.CameraHelper');
    expect(uvc).toContain('ICameraHelper.StateCallback');
    expect(uvc).toContain('device.deviceClass == 14');
    expect(uvc).toContain('selectDevice');
    expect(uvc).toContain('startPreview');
    expect(uvc).toContain('UVCUtils.init');
    expect(uvc).toContain('requestUsbPermissionDirectly');
  });
});
