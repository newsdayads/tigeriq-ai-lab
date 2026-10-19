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
    for (const key of ['R_on_timestamp','R_off_timestamp','R_on_clock_source','R_off_clock_source','clock_source'])
      if (!textValue(row[key])) error(at+'.'+key,'MEASURED_VALUE_REQUIRED');
    if (!yesNo(row.auto_open_success)) error(at+'.auto_open_success','OBSERVED_YES_OR_NO_REQUIRED');
    if (!['YES','NO','NOT_TESTED'].includes(row.manual_open_success))
      error(at+'.manual_open_success','OBSERVED_OR_NOT_TESTED_REQUIRED');
    if (row.auto_open_success === 'YES') {
      if (row.usb_present_during_R !== 'YES')
        error(at+'.auto_open_success','USB_PRESENT_DURING_R_NOT_VERIFIED');
      if (!textValue(row.first_visible_live_frame_timestamp))
        error(at+'.first_visible_live_frame_timestamp','LIVE_FRAME_VISIBILITY_NOT_VERIFIED');
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
