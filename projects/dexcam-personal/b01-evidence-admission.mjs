/**
 * B01 source-only evidence admission. Never certifies a real device measurement.
 * No Android, USB, ADB, network, filesystem, telemetry, or credential access.
 */
const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const schema = 'dexcam-b01-v1';
const ref = v => typeof v === 'string' && /^LOCAL_ONLY:[A-Za-z0-9._-]{3,64}$/.test(v);
const num = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
const measured = v => typeof v === 'string' && v !== 'NOT_MEASURED' && v.trim().length > 0;
const safeText = v => measured(v) && /^[A-Za-z0-9 ._()+/-]{2,48}$/.test(v);
// Date.parse normalizes 2026-02-30 into March: verify Gregorian date and real offset.
const observedTime = value => {
  if (typeof value !== 'string') return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.(\d{1,9}))?(Z|([+-])(\d{2}):([0-5]\d))$/.exec(value);
  if (!m) return false;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 ||
    day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return false;
  const zoneHour = Number(m[10] || 0), zoneMinute = Number(m[11] || 0);
  if (zoneHour > 14 || (zoneHour === 14 && zoneMinute !== 0)) return false;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && ms <= Date.now() + 5 * 60 * 1000;
};
// Plain-text device metadata can still contain placeholder labels. Reject these
// for a self-declared real observation without claiming the remainder is genuine.
const sampleMarker = value => typeof value === 'string' &&
  /(?:^|[^A-Z0-9])(?:NOT[_ -]?MEASURED|UNKNOWN|UNVERIFIED|TBD|TEST|MOCK|SAMPLE|DEMO|PLACEHOLDER|FAKE|N\/A)(?:$|[^A-Z0-9])/i.test(value);

/** Return a preflight assessment, not B01 acceptance or a device attestation. */
export function inspectB01(x) {
  const errors = [];
  const err = (field, why) => errors.push(field + ':' + why);
  const shape = (v, path, allowed) => {
    if (!plain(v)) { err(path, 'OBJECT_REQUIRED'); return false; }
    for (const k of Object.keys(v)) if (!allowed.includes(k)) err(path + '.' + k, 'UNEXPECTED_OR_PRIVATE_FIELD');
    return true;
  };
  if (!shape(x, 'root', ['schema', 'capture_kind', 'observed_at', 'android', 'dex', 'display', 'evidence', 'redaction_confirmed']))
    return { status: 'INCOMPLETE', b01_accepted: false, errors };
  if (x.schema !== schema) err('schema', 'UNKNOWN_VERSION');
  if (!['REAL_DEVICE_OBSERVATION', 'SYNTHETIC_FIXTURE'].includes(x.capture_kind)) err('capture_kind', 'INVALID');
  if (!observedTime(x.observed_at)) err('observed_at', 'REAL_CALENDAR_OFFSET_PAST_OR_CURRENT_REQUIRED');
  if (shape(x.android, 'android', ['manufacturer', 'model', 'android_version', 'api_level', 'one_ui_version'])) {
    for (const k of ['manufacturer', 'model', 'android_version', 'one_ui_version']) if (!safeText(x.android[k])) err('android.' + k, 'MEASURED_SAFE_TEXT_REQUIRED');
    if (!num(x.android.api_level, 23, 50)) err('android.api_level', 'INTEGER_REQUIRED');
    if (x.capture_kind === 'REAL_DEVICE_OBSERVATION') {
      for (const k of ['manufacturer', 'model', 'android_version', 'one_ui_version'])
        if (sampleMarker(x.android[k])) err('android.' + k, 'PLACEHOLDER_NOT_REAL_EVIDENCE');
    }
  }
  if (shape(x.dex, 'dex', ['mode', 'source'])) {
    if (!['EXTERNAL_DISPLAY', 'ON_DEVICE'].includes(x.dex.mode)) err('dex.mode', 'ACTIVE_OBSERVED_MODE_REQUIRED');
    if (!ref(x.dex.source)) err('dex.source', 'LOCAL_ONLY_POINTER_REQUIRED');
  }
  if (shape(x.display, 'display', ['display_id', 'logical_width_px', 'logical_height_px', 'density_dpi', 'smallest_width_dp', 'rotation_deg', 'source'])) {
    for (const [key, lo, hi] of [['display_id', 0, 50], ['logical_width_px', 1, 16384], ['logical_height_px', 1, 16384], ['density_dpi', 80, 1200], ['smallest_width_dp', 1, 5000]])
      if (!num(x.display[key], lo, hi)) err('display.' + key, 'MEASURED_INTEGER_REQUIRED');
    if (![0, 90, 180, 270].includes(x.display.rotation_deg)) err('display.rotation_deg', 'INVALID');
    if (!ref(x.display.source)) err('display.source', 'LOCAL_ONLY_POINTER_REQUIRED');
  }
  if (shape(x.evidence, 'evidence', ['android_settings', 'dex_observation', 'display_readback'])) {
    // Each evidence category needs its own local reference; distinct labels do not attest to distinct underlying files.
    const seen = new Set();
    for (const k of ['android_settings', 'dex_observation', 'display_readback']) {
      const pointer = x.evidence[k];
      if (!ref(pointer)) err('evidence.' + k, 'LOCAL_ONLY_POINTER_REQUIRED');
      else if (seen.has(pointer)) err('evidence.' + k, 'DUPLICATE_EVIDENCE_POINTER');
      else seen.add(pointer);
    }
  }
  if (x.redaction_confirmed !== true) err('redaction_confirmed', 'REQUIRED');
  const complete = errors.length === 0;
  return {
    status: !complete ? 'INCOMPLETE' : x.capture_kind === 'SYNTHETIC_FIXTURE' ? 'SYNTHETIC_FIXTURE_ONLY' : 'CANDIDATE_NEEDS_DEVICE_REVIEW',
    b01_accepted: false,
    errors,
    next: !complete ? 'COLLECT_MISSING_REAL_OBSERVATIONS' : x.capture_kind === 'SYNTHETIC_FIXTURE' ? 'NO_REAL_DEVICE_EVIDENCE' : 'VERIFY_PRIVATE_EVIDENCE_AND_GITHUB_WORK_ORDER_BEFORE_B01_ACCEPTANCE'
  };
}
