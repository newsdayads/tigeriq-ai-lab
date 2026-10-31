/**
 * GH-4625 G1 source-only five-cycle evidence preflight.
 * No USB, R, Android, vehicle access, filesystem, network or attestation.
 * Private values never appear in the output. A valid shape is NOT G1 acceptance.
 */
const plain = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const ptr = x => typeof x === 'string' && /^LOCAL_ONLY:[A-Za-z0-9._-]{3,64}$/.test(x);
const placeholder = x => typeof x !== 'string' || !x.trim() ||
  /^(?:NOT[_ -]?MEASURED|UNVERIFIED|UNKNOWN|NOT[_ -]?AVAILABLE|TBD|NONE|N\/A)$/i.test(x.trim());
const textValue = x => typeof x === 'string' && x.length <= 80 && !placeholder(x);
const usbNumber = x => (Number.isInteger(x) && x >= 0 && x <= 65535) ||
  (typeof x === 'string' && /^0x[0-9a-f]{1,4}$/i.test(x));
const usbClass = x => Number.isInteger(x) && x >= 0 && x <= 255;
const yesNo = x => x === 'YES' || x === 'NO';
/**
 * A recorded time is either a finite, nonnegative counter value or an
 * RFC3339 instant with timezone. A label alone is not a measurement.
 * No cross-clock latency or synchronization is inferred here.
 */
const timestamp = x => {
  if (typeof x !== 'string' || x.length > 80 || placeholder(x)) return null;
  if (/^\d{1,16}(?:\.\d{1,3})?$/.test(x)) {
    const n = Number(x);
    return Number.isFinite(n) && n <= Number.MAX_SAFE_INTEGER ? {kind:'counter',value:n} : null;
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(x);
  if (!m) return null;
  const [year,month,day,hour,minute,second] = m.slice(1,7).map(Number);
  if (year < 1970 || month < 1 || month > 12 || day < 1 || day > 31 ||
      hour > 23 || minute > 59 || second > 59) return null;
  const date = new Date(Date.UTC(year,month-1,day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month-1 ||
      date.getUTCDate() !== day) return null;
  if (m[7] !== 'Z') {
    const oh = Number(m[7].slice(1,3)), om = Number(m[7].slice(4,6));
    if (oh > 14 || om > 59 || (oh === 14 && om !== 0)) return null;
  }
  const n = Date.parse(x);
  return Number.isFinite(n) ? {kind:'rfc3339',value:n} : null;
};

/** Validate a locally captured G1 observation candidate without approving it. */
export function inspectG1Cycles(input) {
  const errors = [];
  const error = (path, reason) => {
    if (errors.length < 64) errors.push(path + ':' + reason);
  };
  if (!plain(input)) return {status:'INCOMPLETE',g1_accepted:false,errors:['root:OBJECT_REQUIRED']};
  if (input.schema !== 'dexcam-g1-cycles-v1') error('schema','UNKNOWN_VERSION');
  if (!['SYNTHETIC_FIXTURE','REAL_DEVICE_OBSERVATION'].includes(input.capture_kind))
    error('capture_kind','INVALID');
  if (input.redaction_confirmed !== true) error('redaction_confirmed','REQUIRED');
  const cycles = input.cycles;
  if (!Array.isArray(cycles) || cycles.length < 5 || cycles.length > 100)
    error('cycles','FIVE_TO_100_RECORDS_REQUIRED');
  const seen = new Set();
  // Distinct cycles must reference distinct R transition observations.
  // One aggregate private log may cover multiple cycles; only event refs
  // require per-cycle uniqueness. This is structural, never provenance proof.
  const seenTransitions = new Map();
  if (Array.isArray(cycles) && cycles.length <= 100) for (let i = 0; i < cycles.length; i++) {
    const row = cycles[i], at = 'cycles[' + i + ']';
    if (!plain(row)) { error(at,'OBJECT_REQUIRED'); continue; }
    if (typeof row.cycle_id !== 'string' || !/^[A-Za-z0-9_-]{3,48}$/.test(row.cycle_id))
      error(at+'.cycle_id','SAFE_ID_REQUIRED');
    else if (seen.has(row.cycle_id)) error(at+'.cycle_id','DUPLICATE_CYCLE');
    else seen.add(row.cycle_id);
    if (!usbNumber(row.usb_vid)) error(at+'.usb_vid','MEASURED_USB_ID_REQUIRED');
    if (!usbNumber(row.usb_pid)) error(at+'.usb_pid','MEASURED_USB_ID_REQUIRED');
    if (!usbClass(row.usb_interface_class)) error(at+'.usb_interface_class','MEASURED_CLASS_REQUIRED');
    for (const field of ['usb_present_before_R','usb_present_during_R'])
      if (!yesNo(row[field])) error(at+'.'+field,'MEASURED_YES_OR_NO_REQUIRED');
    // These must come from independently observed R transitions. Pointer
    // syntax cannot prove they were actually observed or independent.
    if (row.reverse_state !== 'OFF') error(at+'.reverse_state','COMPLETE_R_CYCLE_OFF_NOT_PROVEN');
    for (const key of ['R_on_evidence','R_off_evidence','private_log_pointer'])
      if (!ptr(row[key])) error(at+'.'+key,'LOCAL_ONLY_POINTER_REQUIRED');
    if (ptr(row.R_on_evidence) && row.R_on_evidence === row.R_off_evidence)
      error(at+'.R_off_evidence','SAME_POINTER_AS_R_ON');
    for (const key of ['R_on_evidence','R_off_evidence']) {
      const ref = row[key];
      if (!ptr(ref)) continue;
      const previousCycle = seenTransitions.get(ref);
      if (previousCycle !== undefined && previousCycle !== i)
        error(at+'.'+key,'REUSED_ACROSS_CYCLES');
      else if (previousCycle === undefined) seenTransitions.set(ref,i);
    }
    for (const key of ['R_on_clock_source','R_off_clock_source','clock_source'])
      if (!textValue(row[key])) error(at+'.'+key,'MEASURED_VALUE_REQUIRED');
    const on = timestamp(row.R_on_timestamp), off = timestamp(row.R_off_timestamp);
    if (!on) error(at+'.R_on_timestamp','MEASURED_TIMESTAMP_REQUIRED');
    if (!off) error(at+'.R_off_timestamp','MEASURED_TIMESTAMP_REQUIRED');
    if (on && off && textValue(row.R_on_clock_source) && textValue(row.R_off_clock_source) &&
        row.R_on_clock_source === row.R_off_clock_source) {
      if (on.kind !== off.kind) error(at+'.R_off_timestamp','CLOCK_FORMAT_MISMATCH');
      else if (off.value < on.value) error(at+'.R_off_timestamp','R_OFF_BEFORE_R_ON');
    }
    if (!yesNo(row.auto_open_success)) error(at+'.auto_open_success','OBSERVED_YES_OR_NO_REQUIRED');
    if (!['YES','NO','NOT_TESTED'].includes(row.manual_open_success))
      error(at+'.manual_open_success','OBSERVED_OR_NOT_TESTED_REQUIRED');
    if (row.auto_open_success === 'YES') {
      if (row.usb_present_during_R !== 'YES')
        error(at+'.auto_open_success','USB_PRESENT_DURING_R_NOT_VERIFIED');
      const frame = timestamp(row.first_visible_live_frame_timestamp);
      if (!frame) error(at+'.first_visible_live_frame_timestamp','LIVE_FRAME_TIMESTAMP_REQUIRED');
      // Compare only within an explicitly shared clock domain. A first
      // visible frame outside the observed R interval is not auto-open proof.
      if (frame && textValue(row.clock_source)) {
        if (on && row.clock_source === row.R_on_clock_source) {
          if (frame.kind !== on.kind)
            error(at+'.first_visible_live_frame_timestamp','CLOCK_FORMAT_MISMATCH');
          else if (frame.value < on.value)
            error(at+'.first_visible_live_frame_timestamp','FRAME_BEFORE_R_ON');
        }
        if (off && row.clock_source === row.R_off_clock_source) {
          if (frame.kind !== off.kind)
            error(at+'.first_visible_live_frame_timestamp','CLOCK_FORMAT_MISMATCH');
          else if (frame.value > off.value)
            error(at+'.first_visible_live_frame_timestamp','FRAME_AFTER_R_OFF');
        }
      }
    }
    if (row.auto_open_success === 'NO' && row.manual_open_success === 'NOT_TESTED')
      error(at+'.manual_open_success','COMPARE_MANUAL_OPEN_AFTER_NATURAL_FAILURE');
  }
  return {
    status:errors.length ? 'INCOMPLETE' : input.capture_kind === 'SYNTHETIC_FIXTURE' ?
      'SYNTHETIC_FIXTURE_ONLY' : 'CANDIDATE_NEEDS_DEVICE_REVIEW',
    g1_accepted:false, errors,
    next: errors.length ? 'COLLECT_OR_CORRECT_PRIVATE_DEVICE_OBSERVATIONS' :
      input.capture_kind === 'SYNTHETIC_FIXTURE' ? 'NO_REAL_DEVICE_EVIDENCE' :
        'VERIFY_REAL_USB_R_TIMESTAMPS_AND_REFERENCED_PRIVATE_LOGS_BEFORE_G1_ACCEPTANCE'
  };
}
