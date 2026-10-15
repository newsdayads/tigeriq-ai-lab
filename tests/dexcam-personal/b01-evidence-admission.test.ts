import { expect, it } from 'vitest';
// @ts-ignore JS source is an untyped, dependency-free standalone admission gate.
import { inspectB01 } from '../../projects/dexcam-personal/b01-evidence-admission.mjs';

const sample = () => ({
  schema: 'dexcam-b01-v1', capture_kind: 'SYNTHETIC_FIXTURE', observed_at: '2026-10-15T12:00:00+07:00',
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
  const x = sample(); x.capture_kind = 'REAL_DEVICE_OBSERVATION';
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
