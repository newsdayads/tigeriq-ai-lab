/**
 * G1 USB/R five-cycle private JSON preflight, not device acceptance.
 * No Android, USB, car, network, installation or private evidence export.
 */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readSmallLocalFile } from './b01-local-preflight.mjs';
import { inspectG1Cycles } from './g1-cycle-admission.mjs';

const rootFields = new Set(['root','schema','capture_kind','redaction_confirmed','cycles']);
const cycleFields = new Set([
  '', 'cycle_id','usb_vid','usb_pid','usb_interface_class',
  'usb_present_before_R','usb_present_during_R','reverse_state',
  'R_on_evidence','R_off_evidence','private_log_pointer',
  'R_on_timestamp','R_off_timestamp','R_on_clock_source','R_off_clock_source',
  'clock_source','auto_open_success','manual_open_success',
  'first_visible_live_frame_timestamp'
]);
const incomplete = code => ({
  status:'INCOMPLETE',g1_accepted:false,errors:[code],
  next:'COLLECT_OR_CORRECT_PRIVATE_DEVICE_OBSERVATIONS'
});
function safeError(raw) {
  if (typeof raw !== 'string') return 'input:INVALID';
  const match = /^(.*):([A-Z_]{2,80})$/.exec(raw);
  if (!match) return 'input:INVALID';
  const [,field,reason] = match;
  if (rootFields.has(field)) return field + ':' + reason;
  const cycle = /^cycles\[(\d{1,2})\](?:\.([A-Za-z_]+))?$/.exec(field);
  if (cycle && cycleFields.has(cycle[2] ?? '')) return field + ':' + reason;
  return 'input:INVALID';
}

/** Only status + bounded field codes; no raw values, refs, or paths. */
export function inspectG1Json(raw) {
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    return incomplete('input:INVALID_JSON');
  }
  const result = inspectG1Cycles(input);
  return {
    status:result.status,
    g1_accepted:false,
    errors:result.errors.map(safeError),
    next:result.next ?? 'COLLECT_OR_CORRECT_PRIVATE_DEVICE_OBSERVATIONS'
  };
}

/** Exit 0 = structurally complete, not G1 accepted. Exit 1 = invalid, 2 = usage. */
export async function runG1LocalPreflight(args, write = line => process.stdout.write(line)) {
  if (args.length !== 1 || typeof args[0] !== 'string' || !args[0] || args[0].startsWith('-')) {
    write(JSON.stringify(incomplete('input:ONE_LOCAL_JSON_PATH_REQUIRED')) + '\n');
    return 2;
  }
  let result;
  try {
    // Reuse existing B01 bounded, regular-file, read-only private JSON reader.
    const read = await readSmallLocalFile(args[0]);
    result = read.error ? incomplete(read.error) : inspectG1Json(read.raw);
  } catch {
    result = incomplete('input:READ_FAILED');
  }
  write(JSON.stringify(result) + '\n');
  return result.status === 'INCOMPLETE' ? 1 : 0;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await runG1LocalPreflight(process.argv.slice(2));
}
