import { expect, it } from 'vitest';
// @ts-ignore JS source is an untyped, dependency-free standalone admission gate.
import { inspectB01 } from '../../projects/dexcam-personal/b01-evidence-admission.mjs';

const sample = () => ({
  schema: 'dexcam-b01-v1', capture_kind: 'SYNTHETIC_FIXTURE', observed_at: '2026-10-14T12:00:00+07:00',
  android: { manufacturer: 'Samsung', model: 'SM-TEST', android_version: '16', api_level: 36, one_ui_version: '8.0' },
  dex: { mode: 'EXTERNAL_DISPLAY', source: 'LOCAL_ONLY:dex-screenshot-01' },
  display: { display_id: 1, logical_width_px: 1920, logical_height_px: 1080, density_dpi: 240,
    smallest_width_dp: 800, rotation_deg: 0, source: 'LOCAL_ONLY:display-readback-01' },
  evidence: { android_settings: 'LOCAL_ONLY:settings-01', dex_observation: 'LOCAL_ONLY:dex-01',
    display_readback: 'LOCAL_ONLY:display-01' }, redaction_confirmed: true
});
const reject = (x: any, field: string) => {
  const r = inspectB01(x);
  expect(r.status).toBe('INCOMPLETE');
  expect(r.b01_accepted).toBe(false);
  expect(r.errors.some((e: string) => e.startsWith(field + ':'))).toBe(true);
};

it('synthetic data cannot pass acceptance', () => {
  const r = inspectB01(sample());
  expect(r.status).toBe('SYNTHETIC_FIXTURE_ONLY');
  expect(r.b01_accepted).toBe(false);
  expect(r.errors).toEqual([]);
});
it('real-device-shaped input is only a candidate requiring real review', () => {
  const x = sample(); x.capture_kind = 'REAL_DEVICE_OBSERVATION'; x.android.model = 'SM-X999';
  const r = inspectB01(x);
  expect(r.status).toBe('CANDIDATE_NEEDS_DEVICE_REVIEW');
  expect(r.b01_accepted).toBe(false);
});
it('rejects empty record', () => reject({}, 'schema'));
it('rejects invented model identity', () => { const x = sample(); x.android.manufacturer = 'NOT_MEASURED'; reject(x, 'android.manufacturer'); });
it('rejects missing smallest width measurement', () => { const x = sample(); x.display.smallest_width_dp = 'NOT_MEASURED' as any; reject(x, 'display.smallest_width_dp'); });
it('rejects zero density', () => { const x = sample(); x.display.density_dpi = 0; reject(x, 'display.density_dpi'); });
it('rejects a private serial field', () => { const x: any = sample(); x.android.serial = 'SENSITIVE'; reject(x, 'android.serial'); });
it('rejects public evidence URL', () => { const x = sample(); x.evidence.android_settings = 'https://example.com/private'; reject(x, 'evidence.android_settings'); });
it('rejects unknown DeX mode', () => { const x = sample(); x.dex.mode = 'UNKNOWN'; reject(x, 'dex.mode'); });
it('requires timezone offset', () => { const x = sample(); x.observed_at = '2026-10-15T12:00:00'; reject(x, 'observed_at'); });
it('rejects unexpected authentication fields', () => { const x: any = sample(); x.token = 'secret'; reject(x, 'root.token'); });
it('rejects invalid rotation', () => { const x = sample(); x.display.rotation_deg = 45; reject(x, 'display.rotation_deg'); });
it('rejects forged acceptance flag', () => { const x: any = sample(); x.b01_accepted = true; reject(x, 'root.b01_accepted'); });
it('requires evidence redaction', () => { const x = sample(); x.redaction_confirmed = false; reject(x, 'redaction_confirmed'); });

it('rejects normalized nonexistent February 30', () => { const x = sample(); x.observed_at = '2026-02-30T10:00:00+07:00'; reject(x, 'observed_at'); });
it('rejects invalid leap day in a nonleap year', () => { const x = sample(); x.observed_at = '2025-02-29T10:00:00+07:00'; reject(x, 'observed_at'); });
it('accepts a genuine Gregorian leap-day date in synthetic fixture', () => { const x = sample(); x.observed_at = '2024-02-29T10:00:00+07:00'; expect(inspectB01(x).status).toBe('SYNTHETIC_FIXTURE_ONLY'); });
it('rejects timestamp claiming a far-future observation', () => { const x = sample(); x.observed_at = '2099-01-01T00:00:00+07:00'; reject(x, 'observed_at'); });
it('rejects UTC offset beyond plausible civil timezone', () => { const x = sample(); x.observed_at = '2026-10-14T00:00:00+14:30'; reject(x, 'observed_at'); });
it('rejects sample-model evidence relabeled as real device', () => { const x = sample(); x.capture_kind = 'REAL_DEVICE_OBSERVATION'; reject(x, 'android.model'); });
it('rejects unknown manufacturer posing as real observation', () => { const x = sample(); x.capture_kind = 'REAL_DEVICE_OBSERVATION'; x.android.manufacturer = 'unknown'; x.android.model = 'SM-X999'; reject(x, 'android.manufacturer'); });

it('rejects Android settings pointer copied to DeX observation', () => {
  const x = sample(); x.evidence.dex_observation = x.evidence.android_settings;
  const r = inspectB01(x);
  expect(r.b01_accepted).toBe(false);
  expect(r.errors).toContain('evidence.dex_observation:DUPLICATE_EVIDENCE_POINTER');
});
it('rejects a DeX pointer copied to display readback', () => {
  const x = sample(); x.evidence.display_readback = x.evidence.dex_observation;
  const r = inspectB01(x);
  expect(r.status).toBe('INCOMPLETE');
  expect(r.errors).toContain('evidence.display_readback:DUPLICATE_EVIDENCE_POINTER');
});
it('a real-device-shaped input with duplicated evidence remains incomplete', () => {
  const x = sample(); x.capture_kind = 'REAL_DEVICE_OBSERVATION'; x.android.model = 'SM-X999';
  x.evidence.display_readback = x.evidence.android_settings;
  const r = inspectB01(x);
  expect(r.b01_accepted).toBe(false);
  expect(r.errors).toContain('evidence.display_readback:DUPLICATE_EVIDENCE_POINTER');
});

// Regression: mock/test labels with a numeric suffix must not masquerade as real device metadata.
const realShapedB01Input = () => {
  const x = sample(); x.capture_kind = 'REAL_DEVICE_OBSERVATION'; x.android.model = 'SM-X999';
  return x;
};
it('rejects numeric-suffixed placeholder model=SM-TEST2026', () => {
  const x = realShapedB01Input(); x.android.model = 'SM-TEST2026';
  const r = inspectB01(x);
  expect(r.status).toBe('INCOMPLETE');
  expect(r.b01_accepted).toBe(false);
  expect(r.errors).toContain('android.model:PLACEHOLDER_NOT_REAL_EVIDENCE');
});
it('rejects numeric-suffixed placeholder model=SM-MOCK01', () => {
  const x = realShapedB01Input(); x.android.model = 'SM-MOCK01';
  const r = inspectB01(x);
  expect(r.status).toBe('INCOMPLETE');
  expect(r.b01_accepted).toBe(false);
  expect(r.errors).toContain('android.model:PLACEHOLDER_NOT_REAL_EVIDENCE');
});
it('rejects numeric-suffixed placeholder model=SM-FAKE001', () => {
  const x = realShapedB01Input(); x.android.model = 'SM-FAKE001';
  const r = inspectB01(x);
  expect(r.status).toBe('INCOMPLETE');
  expect(r.b01_accepted).toBe(false);
  expect(r.errors).toContain('android.model:PLACEHOLDER_NOT_REAL_EVIDENCE');
});
it('rejects numeric-suffixed placeholder manufacturer=UNKNOWN2026', () => {
  const x = realShapedB01Input(); x.android.manufacturer = 'UNKNOWN2026';
  const r = inspectB01(x);
  expect(r.status).toBe('INCOMPLETE');
  expect(r.b01_accepted).toBe(false);
  expect(r.errors).toContain('android.manufacturer:PLACEHOLDER_NOT_REAL_EVIDENCE');
});
it('rejects numeric-suffixed placeholder android_version=TEST16', () => {
  const x = realShapedB01Input(); x.android.android_version = 'TEST16';
  const r = inspectB01(x);
  expect(r.status).toBe('INCOMPLETE');
  expect(r.b01_accepted).toBe(false);
  expect(r.errors).toContain('android.android_version:PLACEHOLDER_NOT_REAL_EVIDENCE');
});
it('rejects numeric-suffixed placeholder one_ui_version=8.0DEMO1', () => {
  const x = realShapedB01Input(); x.android.one_ui_version = '8.0DEMO1';
  const r = inspectB01(x);
  expect(r.status).toBe('INCOMPLETE');
  expect(r.b01_accepted).toBe(false);
  expect(r.errors).toContain('android.one_ui_version:PLACEHOLDER_NOT_REAL_EVIDENCE');
});
it('rejects numeric-suffixed placeholder model=SAMPLE2026', () => {
  const x = realShapedB01Input(); x.android.model = 'SAMPLE2026';
  const r = inspectB01(x);
  expect(r.status).toBe('INCOMPLETE');
  expect(r.b01_accepted).toBe(false);
  expect(r.errors).toContain('android.model:PLACEHOLDER_NOT_REAL_EVIDENCE');
});
it('rejects numeric-suffixed placeholder manufacturer=PLACEHOLDER01', () => {
  const x = realShapedB01Input(); x.android.manufacturer = 'PLACEHOLDER01';
  const r = inspectB01(x);
  expect(r.status).toBe('INCOMPLETE');
  expect(r.b01_accepted).toBe(false);
  expect(r.errors).toContain('android.manufacturer:PLACEHOLDER_NOT_REAL_EVIDENCE');
});
