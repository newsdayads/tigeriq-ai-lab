import test from 'node:test';
import assert from 'node:assert/strict';
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
const reject = (x, field) => {
  const r = inspectB01(x);
  assert.equal(r.status, 'INCOMPLETE');
  assert.equal(r.b01_accepted, false);
  assert.ok(r.errors.some(e => e.startsWith(field + ':')), JSON.stringify(r.errors));
};

test('complete synthetic record is never accepted as B01', () => {
  const r = inspectB01(sample());
  assert.equal(r.status, 'SYNTHETIC_FIXTURE_ONLY');
  assert.equal(r.b01_accepted, false); assert.deepEqual(r.errors, []);
});
test('real-device-shaped record remains only a candidate pending private independent readback', () => {
  const x = sample(); x.capture_kind = 'REAL_DEVICE_OBSERVATION';
  const r = inspectB01(x);
  assert.equal(r.status, 'CANDIDATE_NEEDS_DEVICE_REVIEW'); assert.equal(r.b01_accepted, false);
});
test('no real device input never turns into a green acceptance', () => reject({}, 'schema'));
test('no missing/guessed manufacturer', () => { const x = sample(); x.android.manufacturer = 'NOT_MEASURED'; reject(x, 'android.manufacturer'); });
test('display must be measured rather than guessed', () => { const x = sample(); x.display.smallest_width_dp = 'NOT_MEASURED'; reject(x, 'display.smallest_width_dp'); });
test('zero density rejected', () => { const x = sample(); x.display.density_dpi = 0; reject(x, 'display.density_dpi'); });
test('unexpected VIN and serial keys fail closed', () => { const x = sample(); x.android.serial = 'SENSITIVE'; reject(x, 'android.serial'); });
test('no public URLs or absolute paths for evidence refs', () => { const x = sample(); x.evidence.android_settings = 'https://example.com/private-photo'; reject(x, 'evidence.android_settings'); });
test('reject unverifiable USB/deX status', () => { const x = sample(); x.dex.mode = 'UNKNOWN'; reject(x, 'dex.mode'); });
test('reject missing timestamp offset', () => { const x = sample(); x.observed_at = '2026-10-15T12:00:00'; reject(x, 'observed_at'); });
test('reject unsupported fields and authentication artifacts', () => { const x = sample(); x.token = 'abc'; reject(x, 'root.token'); });
test('reject invalid screen rotation', () => { const x = sample(); x.display.rotation_deg = 45; reject(x, 'display.rotation_deg'); });
test('valid records cannot override admission status with forged property', () => { const x = sample(); x.b01_accepted = true; reject(x, 'root.b01_accepted'); });
test('reject unredacted evidence', () => { const x = sample(); x.redaction_confirmed = false; reject(x, 'redaction_confirmed'); });
