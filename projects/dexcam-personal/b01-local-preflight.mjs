/**
 * Private, read-only B01 local JSON preflight.
 * This does not inspect Android or attest to physical evidence.
 * It never writes files, accesses the network, or prints input values/paths.
 */
import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inspectB01 } from './b01-evidence-admission.mjs';

const MAX_INPUT_BYTES = 64 * 1024;
const safeFields = new Set([
  'root', 'schema', 'capture_kind', 'observed_at', 'android',
  'android.manufacturer', 'android.model', 'android.android_version',
  'android.api_level', 'android.one_ui_version', 'dex', 'dex.mode', 'dex.source',
  'display', 'display.display_id', 'display.logical_width_px',
  'display.logical_height_px', 'display.density_dpi', 'display.smallest_width_dp',
  'display.rotation_deg', 'display.source', 'evidence',
  'evidence.android_settings', 'evidence.dex_observation',
  'evidence.display_readback', 'redaction_confirmed'
]);

const incomplete = error => ({
  status: 'INCOMPLETE', b01_accepted: false, errors: [error],
  next: 'COLLECT_MISSING_REAL_OBSERVATIONS'
});

function sanitizedError(value) {
  if (typeof value !== 'string') return 'input:INVALID';
  const colon = value.lastIndexOf(':');
  if (colon < 0) return 'input:INVALID';
  const field = value.slice(0, colon);
  const reason = value.slice(colon + 1);
  if (!/^[A-Z_]{2,80}$/.test(reason)) return 'input:INVALID';
  return (safeFields.has(field) ? field : 'input') + ':' + reason;
}

export function inspectB01Json(raw) {
  let record;
  try {
    record = JSON.parse(raw);
  } catch {
    return incomplete('input:INVALID_JSON');
  }
  const result = inspectB01(record);
  return {
    status: result.status,
    b01_accepted: false,
    errors: result.errors.map(sanitizedError),
    next: result.next ?? 'COLLECT_MISSING_REAL_OBSERVATIONS'
  };
}

export async function readSmallLocalFile(filename) {
  // Reject symlinks, FIFOs, sockets and devices before open: opening a FIFO can block forever.
  const before = await lstat(filename);
  if (!before.isFile()) return { error: 'input:NOT_A_REGULAR_FILE' };
  if (before.size > MAX_INPUT_BYTES) return { error: 'input:FILE_TOO_LARGE' };
  // POSIX no-follow prevents symlink swaps; nonblock avoids FIFO hangs in a path-swap race.
  const flags = constants.O_RDONLY | constants.O_NONBLOCK |
    (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW);
  const file = await open(filename, flags);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.dev !== before.dev || info.ino !== before.ino)
      return { error: 'input:NOT_A_REGULAR_FILE' };
    if (info.size > MAX_INPUT_BYTES) return { error: 'input:FILE_TOO_LARGE' };
    const buffer = Buffer.alloc(MAX_INPUT_BYTES + 1);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    if (bytesRead > MAX_INPUT_BYTES) return { error: 'input:FILE_TOO_LARGE' };
    try {
      return { raw: new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytesRead)) };
    } catch {
      return { error: 'input:INVALID_UTF8' };
    }
  } finally {
    await file.close();
  }
}

/**
 * Exit 0 = structurally readable (NOT accepted as B01).
 * Exit 1 = missing/invalid evidence, exit 2 = command usage error.
 */
export async function runB01LocalPreflight(args, write = line => process.stdout.write(line)) {
  if (args.length !== 1 || !args[0] || args[0].startsWith('-')) {
    write(JSON.stringify(incomplete('input:ONE_LOCAL_JSON_PATH_REQUIRED')) + '\n');
    return 2;
  }
  let result;
  try {
    const read = await readSmallLocalFile(args[0]);
    result = read.error ? incomplete(read.error) : inspectB01Json(read.raw);
  } catch {
    result = incomplete('input:READ_FAILED');
  }
  write(JSON.stringify(result) + '\n');
  return result.status === 'INCOMPLETE' ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await runB01LocalPreflight(process.argv.slice(2));
}
