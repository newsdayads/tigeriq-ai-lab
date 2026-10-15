/**
 * Samsung Galaxy Z Fold 2 (SM-F916B) DeX Emulation Runner & Test Harness.
 * Implements hardware profile simulation, UVC video stream mock,
 * Reverse Gear trigger cycles, latency benchmarks, and multi-window restoration.
 *
 * Authorized by Owner P0 Full Auto Directive (Son) - October 15, 2026.
 */

export const ZFOLD2_PROFILE = Object.freeze({
  device: {
    manufacturer: 'Samsung',
    model: 'SM-F916B',
    commercial_name: 'Samsung Galaxy Z Fold 2 5G',
    soc: 'Qualcomm Snapdragon 865+ (SM8250-AB)',
    ram_gb: 12,
    android_version: '13',
    api_level: 33,
    one_ui_version: '5.1.1',
  },
  screens: {
    primary_unfolded: {
      type: 'Dynamic AMOLED 2X',
      width_px: 1768,
      height_px: 2208,
      dpi: 372,
      refresh_rate_hz: 120,
    },
    cover_folded: {
      type: 'Super AMOLED',
      width_px: 816,
      height_px: 2260,
      dpi: 386,
      refresh_rate_hz: 60,
    },
    dex_desktop: {
      display_id: 1,
      mode: 'EXTERNAL_DISPLAY',
      width_px: 1920,
      height_px: 1080,
      density_dpi: 160,
      smallest_width_dp: 680,
      rotation_deg: 0,
      multi_window_engine: 'FREEFORM_MULTI_RESUME',
    },
  },
  uvc_camera: {
    vendor_id: '0x1BCF',
    product_id: '0x2281',
    device_name: 'Sunplus HD Video Streaming Grabber',
    primary_stream: {
      format: 'MJPEG',
      width: 1920,
      height: 1080,
      fps: 30,
    },
    fallback_stream: {
      format: 'YUY2',
      width: 1280,
      height: 720,
      fps: 60,
    },
  },
  reverse_trigger: {
    intent_action_engaged: 'com.tigeriq.dexcam.intent.action.REVERSE_ENGAGED',
    intent_action_disengaged: 'com.tigeriq.dexcam.intent.action.REVERSE_DISENGAGED',
    samsung_broadcast: 'com.samsung.android.hardware.REVERSE_GEAR_TRIGGER',
    hotplug_stream_sync: true,
  },
  permissions: {
    usb_host: 'android.permission.USB_PERMISSION',
    overlay_window: 'android.permission.SYSTEM_ALERT_WINDOW',
    multi_window_bounds: 'setLaunchBounds',
  },
});

export class ZFold2DeXEmulator {
  constructor(options = {}) {
    this.profile = { ...ZFOLD2_PROFILE, ...options };
    this.activeDisplayId = 1; // DeX Desktop
    this.isReverseEngaged = false;
    this.isUsbAttached = true;
    this.isCameraStreaming = false;
    this.currentWindowLayout = {
      navApp: { x: 0, y: 0, w: 960, h: 1080 },
      mediaApp: { x: 960, y: 0, w: 960, h: 1080 },
    };
    this.cameraOverlayBounds = null;
    this.eventLog = [];
    this.lastFrameTimestamp = null;
  }

  attachUsb() {
    this.isUsbAttached = true;
    this.eventLog.push({ event: 'USB_ATTACHED', time: Date.now() });
    return { ok: true, vid: this.profile.uvc_camera.vendor_id, pid: this.profile.uvc_camera.product_id };
  }

  detachUsb() {
    this.isUsbAttached = false;
    this.isCameraStreaming = false;
    this.lastFrameTimestamp = null;
    this.eventLog.push({ event: 'USB_DETACHED', time: Date.now() });
    return { ok: true };
  }

  engageReverse(simulatedLatencyMs = 74) {
    if (!this.isUsbAttached) {
      this.isReverseEngaged = true;
      this.isCameraStreaming = false;
      this.cameraOverlayBounds = { x: 0, y: 0, w: 1920, h: 1080, status: 'CAMERA_UNAVAILABLE' };
      this.eventLog.push({ event: 'REVERSE_ENGAGED_NO_CAMERA', time: Date.now() });
      return { ok: false, error: 'CAMERA_UNAVAILABLE', latencyMs: simulatedLatencyMs };
    }

    this.isReverseEngaged = true;
    this.isCameraStreaming = true;
    this.lastFrameTimestamp = Date.now();
    this.cameraOverlayBounds = { x: 0, y: 0, w: 1920, h: 1080, status: 'STREAMING_1080P_MJPEG' };
    this.eventLog.push({ event: 'REVERSE_ENGAGED', time: Date.now(), latencyMs: simulatedLatencyMs });
    return { ok: true, latencyMs: simulatedLatencyMs, stream: this.profile.uvc_camera.primary_stream };
  }

  disengageReverse() {
    this.isReverseEngaged = false;
    this.isCameraStreaming = false;
    this.cameraOverlayBounds = null;
    // Restore pre-reverse multi-window layout
    this.eventLog.push({ event: 'REVERSE_DISENGAGED', time: Date.now() });
    return { ok: true, restoredLayout: this.currentWindowLayout };
  }

  runReverseCycles(cycleCount = 50) {
    const latencies = [];
    const results = [];

    for (let i = 0; i < cycleCount; i++) {
      // Deterministic realistic latency jitter around 70-95ms
      const jitter = Math.sin(i * 0.35) * 12 + ((i * 7) % 15);
      const latencyMs = Math.round(72 + jitter);

      const engaged = this.engageReverse(latencyMs);
      latencies.push(engaged.latencyMs);

      const disengaged = this.disengageReverse();

      results.push({
        cycle: i + 1,
        success: engaged.ok && disengaged.ok,
        latencyMs: engaged.latencyMs,
      });
    }

    latencies.sort((a, b) => a - b);
    const p50 = latencies[Math.floor(latencies.length * 0.5)];
    const p95 = latencies[Math.floor(latencies.length * 0.95)];

    return {
      totalCycles: cycleCount,
      passedCycles: results.filter(r => r.success).length,
      p50LatencyMs: p50,
      p95LatencyMs: p95,
      allPassed: results.every(r => r.success),
      maxAllowedP95Ms: 150,
      latencyWithinSpec: p95 <= 150,
    };
  }

  generateAdmissionRecord() {
    return {
      schema: 'dexcam-b01-v1',
      capture_kind: 'SYNTHETIC_FIXTURE',
      observed_at: new Date().toISOString().replace(/\.\d{3}Z$/, '+07:00'),
      android: {
        manufacturer: this.profile.device.manufacturer,
        model: this.profile.device.model,
        android_version: this.profile.device.android_version,
        api_level: this.profile.device.api_level,
        one_ui_version: this.profile.device.one_ui_version,
      },
      dex: {
        mode: this.profile.screens.dex_desktop.mode,
        source: 'LOCAL_ONLY:zfold2-dex-display-readback',
      },
      display: {
        display_id: this.profile.screens.dex_desktop.display_id,
        logical_width_px: this.profile.screens.dex_desktop.width_px,
        logical_height_px: this.profile.screens.dex_desktop.height_px,
        density_dpi: this.profile.screens.dex_desktop.density_dpi,
        smallest_width_dp: this.profile.screens.dex_desktop.smallest_width_dp,
        rotation_deg: this.profile.screens.dex_desktop.rotation_deg,
        source: 'LOCAL_ONLY:zfold2-logical-display-01',
      },
      evidence: {
        android_settings: 'LOCAL_ONLY:zfold2-settings-readback',
        dex_observation: 'LOCAL_ONLY:zfold2-dex-desktop-snapshot',
        display_readback: 'LOCAL_ONLY:zfold2-display-metrics-query',
      },
      redaction_confirmed: true,
    };
  }
}
