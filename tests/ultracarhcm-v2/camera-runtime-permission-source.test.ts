// GH-5135 F03/F20 runtime CAMERA permission source contract.
// Static assertions prevent UVC startup from bypassing the Android runtime permission gate.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const activity = readFileSync(
  new URL('../../apps/ultracarhcm-v2/app/src/main/java/ai/tigeriq/ultracarhcm/v2/UsbCameraActivity.kt', import.meta.url),
  'utf8',
);

describe('GH-5135 F03/F20 camera runtime permission gate', () => {
  it('requests CAMERA before starting the UVC controller', () => {
    expect(activity).toContain('checkSelfPermission(Manifest.permission.CAMERA)');
    expect(activity).toContain('requestPermissions(arrayOf(Manifest.permission.CAMERA), CAMERA_PERMISSION_REQUEST)');
    expect(activity).toContain('PackageManager.PERMISSION_GRANTED');
    const permissionCheck = activity.indexOf('checkSelfPermission(Manifest.permission.CAMERA)');
    const start = activity.indexOf('camera.start()');
    expect(permissionCheck).toBeGreaterThan(-1);
    expect(start).toBeGreaterThan(permissionCheck);
  });

  it('keeps permission denial visible instead of auto-granting or starting UVC', () => {
    expect(activity).toContain('Quyền CAMERA bị từ chối — Camera USB chưa mở');
    expect(activity).toContain('awaitingCameraPermission');
    expect(activity).toContain('ĐANG CHỜ QUYỀN CAMERA');
    expect(activity).not.toContain('pm grant');
  });

  it('starts UVC only after a granted runtime result and leaves USB device permission separate', () => {
    expect(activity).toContain('override fun onRequestPermissionsResult');
    expect(activity).toContain('grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED');
    expect(activity).toContain('openCamera()');
    expect(activity).not.toContain('UsbManager.requestPermission');
  });
});
