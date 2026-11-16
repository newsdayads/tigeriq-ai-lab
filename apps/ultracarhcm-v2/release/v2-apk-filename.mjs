// Owner canonical Drive filename contract for UltraCarHCM V2 APKs.
// Safe, pure helper; does not modify Google Drive, sign APKs, or mutate app versions.
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const FIRST_V2_APK_NAME = 'UltraCarHCM-V2.00.00.apk';
const PATTERN = /^UltraCarHCM-V2\.(\d{2})\.(\d{2})\.apk$/;

export function parseV2ApkName(name) {
  if (typeof name !== 'string') return null;
  const match = PATTERN.exec(name);
  if (!match) return null;
  return Number(match[1]) * 100 + Number(match[2]);
}

export function formatV2ApkName(sequence) {
  if (!Number.isInteger(sequence) || sequence < 0 || sequence > 9999) {
    throw new RangeError('V2_VERSION_SEQUENCE_OUT_OF_RANGE_00_00_TO_99_99');
  }
  const major = String(Math.floor(sequence / 100)).padStart(2, '0');
  const minor = String(sequence % 100).padStart(2, '0');
  return `UltraCarHCM-V2.${major}.${minor}.apk`;
}

export function nextV2ApkName(existingNames) {
  if (!Array.isArray(existingNames)) throw new TypeError('DRIVE_FILENAMES_ARRAY_REQUIRED');
  let latest = -1;
  for (const name of existingNames) {
    const value = parseV2ApkName(name);
    if (value !== null) latest = Math.max(latest, value);
  }
  if (latest >= 9999) throw new RangeError('V2_FILENAME_SEQUENCE_EXHAUSTED');
  return formatV2ApkName(latest + 1);
}

// Example: node v2-apk-filename.mjs UltraCarHCM-V2.00.00.apk
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(nextV2ApkName(process.argv.slice(2)) + '\n');
}
