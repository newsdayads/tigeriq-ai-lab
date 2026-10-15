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
  if (typeof x.observed_at !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(x.observed_at) || Number.isNaN(Date.parse(x.observed_at)))
    err('observed_at', 'OFFSET_TIMESTAMP_REQUIRED');
  if (shape(x.android, 'android', ['manufacturer', 'model', 'android_version', 'api_level', 'one_ui_version'])) {
    for (const k of ['manufacturer', 'model', 'android_version', 'one_ui_version']) if (!safeText(x.android[k])) err('android.' + k, 'MEASURED_SAFE_TEXT_REQUIRED');
    if (!num(x.android.api_level, 23, 50)) err('android.api_level', 'INTEGER_REQUIRED');
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
    for (const k of ['android_settings', 'dex_observation', 'display_readback']) if (!ref(x.evidence[k])) err('evidence.' + k, 'LOCAL_ONLY_POINTER_REQUIRED');
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
