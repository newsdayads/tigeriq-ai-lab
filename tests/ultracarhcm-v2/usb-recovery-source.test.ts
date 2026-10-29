import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const uvc = readFileSync(
  new URL('../../apps/ultracarhcm-v2/app/src/main/java/ai/tigeriq/ultracarhcm/v2/UsbUvcController.kt', import.meta.url),
  'utf8',
);

describe('GH-5135 F20/R03 USB UVC recovery source contract', () => {
  it('keeps the requested session alive while waiting for a UVC hot-plug', () => {
    expect(uvc).toContain('val device = h.deviceList.orEmpty().firstOrNull(::isUvcDevice)');
    expect(uvc).toContain('Đang chờ Camera UVC qua USB Host');
    const noDevice = uvc.slice(
      uvc.indexOf('if (device == null)'),
      uvc.indexOf('selectTarget(device)'),
    );
    expect(noDevice).not.toContain('stop()');
  });

  it('auto-selects a newly attached UVC device only while the session is requested', () => {
    expect(uvc).toContain('if (requested && target == null && isUvcDevice(device))');
    expect(uvc).toContain('if (requested && target == null) selectTarget(device)');
  });

  it('releases preview state but keeps waiting after recoverable close/detach/error', () => {
    expect(uvc).toContain('Camera UVC đã đóng — đang chờ kết nối lại');
    expect(uvc).toContain('USB camera mất kết nối — đang chờ kết nối lại');
    expect(uvc).toContain('Đã rút Camera USB — đang chờ cắm lại');
    expect(uvc).toContain('— đang chờ kết nối lại');
    expect(uvc).toContain('target = null');
  });

  it('bounded-reselects a still-attached UVC after transient close or error', () => {
    expect(uvc).toContain('private fun scheduleRecovery(device: UsbDevice)');
    expect(uvc).toContain('sameAttachedUvc(device)');
    expect(uvc).toContain('UvcRecoveryRules.MAX_AUTOMATIC_ATTEMPTS');
    expect(uvc).toContain('UvcRecoveryRules.RETRY_DELAY_MS');
    expect(uvc).toMatch(/onCameraClose[\s\S]*?scheduleRecovery\(device\)/);
    expect(uvc).toMatch(/onDeviceClose[\s\S]*?scheduleRecovery\(device\)/);
    expect(uvc).toMatch(/onError[\s\S]*?scheduleRecovery\(device\)/);
  });

  it('still treats explicit permission denial as a stopped session requiring retry', () => {
    const cancel = uvc.slice(
      uvc.indexOf('override fun onCancel'),
      uvc.indexOf('override fun onError'),
    );
    expect(cancel).toContain('stop()');
    expect(cancel).toContain('Quyền USB bị từ chối');
  });
});
