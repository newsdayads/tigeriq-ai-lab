/**
 * GH-4625: fail-closed, offline, PRIVATE APK / arm64 native ELF 16-KiB preflight.
 * The CLI prints only aggregate counters; never filenames, private paths or code.
 * This is NOT REA, JADX, Android runtime, device/G1/G2, or D01 acceptance.
 * No third-party packages, shell tools, network or PC01 access.
 */
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const MAX_APK = 128 * 1024 * 1024;
const MAX_ELF = 64 * 1024 * 1024;
const PAGE = 16384n;
function fail(code) { throw new Error(code); }
function inRange(b, p, n) {
  if (!Number.isSafeInteger(p) || !Number.isSafeInteger(n) || p < 0 || n < 0 || p + n > b.length)
    fail('INVALID_BINARY_RANGE');
}
function u16(b, p) { inRange(b, p, 2); return b.readUInt16LE(p); }
function u32(b, p) { inRange(b, p, 4); return b.readUInt32LE(p); }
const safe64 = x => { if (x > BigInt(Number.MAX_SAFE_INTEGER)) fail('INVALID_ELF_RANGE'); return Number(x); };
const powerTwo = n => n > 0n && (n & (n - 1n)) === 0n;

export function inspectArm64Elf(binary) {
  const b = Buffer.from(binary);
  if (b.length < 64 || b.length > MAX_ELF || b.toString('hex', 0, 4) !== '7f454c46' ||
      b[4] !== 2 || b[5] !== 1 || b[6] !== 1 || u16(b, 18) !== 183 || u16(b, 52) !== 64)
    fail('INVALID_ARM64_ELF');
  const start = safe64(b.readBigUInt64LE(32));
  const entry = u16(b, 54), count = u16(b, 56);
  if (entry !== 56 || count < 1 || count > 512) fail('INVALID_ELF_PROGRAM_HEADERS');
  inRange(b, start, count * entry);
  let load = 0, valid16k = true, legacy4k = 0;
  for (let i = 0; i < count; ++i) {
    const p = start + i * entry;
    if (u32(b, p) !== 1) continue;
    load++;
    const offset = b.readBigUInt64LE(p + 8);
    const vaddr = b.readBigUInt64LE(p + 16);
    const fileSize = b.readBigUInt64LE(p + 32);
    const align = b.readBigUInt64LE(p + 48);
    if (!powerTwo(align) || offset + fileSize > BigInt(b.length) || (vaddr - offset) % align !== 0n)
      fail('INVALID_ELF_LOAD_SEGMENT');
    if (align === 4096n) legacy4k++;
    if (align < PAGE || (vaddr - offset) % PAGE !== 0n) valid16k = false;
  }
  if (!load) fail('NO_ELF_LOAD_SEGMENT');
  return { loadSegments: load, legacy4k, static16kEligible: valid16k };
}

let crcTable;
function crc32(b) {
  crcTable ??= Array.from({ length: 256 }, (_, i) => {
    let c = i;
    for (let j = 0; j < 8; ++j) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
    return c >>> 0;
  });
  let n = 0xffffffff;
  for (const x of b) n = (n >>> 8) ^ crcTable[(n ^ x) & 255];
  return (n ^ 0xffffffff) >>> 0;
}

export function inspectPrivateApkNative(apkBuffer, expectedSha256) {
  const b = Buffer.from(apkBuffer);
  if (b.length < 22 || b.length > MAX_APK) fail('INVALID_APK_SIZE');
  if (typeof expectedSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(expectedSha256))
    fail('PINNED_SHA256_REQUIRED');
  const digest = createHash('sha256').update(b).digest('hex');
  if (digest !== expectedSha256) fail('APK_SHA256_MISMATCH');
  let eocd = -1;
  for (let p = b.length - 22; p >= Math.max(0, b.length - 22 - 65535); --p) {
    if (u32(b, p) === 0x06054b50 && p + 22 + u16(b, p + 20) === b.length) { eocd = p; break; }
  }
  if (eocd < 0 || u16(b, eocd + 4) !== 0 || u16(b, eocd + 6) !== 0 ||
      u16(b, eocd + 8) !== u16(b, eocd + 10)) fail('UNSUPPORTED_ZIP');
  const count = u16(b, eocd + 10), dirSize = u32(b, eocd + 12), dir = u32(b, eocd + 16);
  if (count > 30000 || dir + dirSize > eocd) fail('INVALID_ZIP_DIRECTORY');
  let p = dir, arm64 = 0, eligible = 0, legacy4k = 0, loadSegments = 0;
  const seen = new Set();
  for (let i = 0; i < count; ++i) {
    if (u32(b, p) !== 0x02014b50) fail('INVALID_ZIP_MEMBER');
    const flags = u16(b, p + 8), method = u16(b, p + 10), crc = u32(b, p + 16);
    const compressed = u32(b, p + 20), plain = u32(b, p + 24);
    const nameLen = u16(b, p + 28), extra = u16(b, p + 30), comment = u16(b, p + 32);
    const disk = u16(b, p + 34), local = u32(b, p + 42);
    inRange(b, p, 46 + nameLen + extra + comment);
    const name = b.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extra + comment;
    if (!/^lib\/arm64-v8a\/[A-Za-z0-9_.+-]+\.so$/.test(name)) continue;
    if (seen.has(name) || disk || (flags & 1) || ![0, 8].includes(method) ||
        compressed > MAX_APK || plain > MAX_ELF) fail('INVALID_NATIVE_ZIP_MEMBER');
    seen.add(name);
    if (u32(b, local) !== 0x04034b50 || u16(b, local + 6) !== flags || u16(b, local + 8) !== method)
      fail('NATIVE_HEADER_MISMATCH');
    if (!(flags & 8) && (u32(b, local + 14) !== crc || u32(b, local + 18) !== compressed ||
        u32(b, local + 22) !== plain)) fail('NATIVE_HEADER_MISMATCH');
    const ln = u16(b, local + 26), le = u16(b, local + 28);
    inRange(b, local, 30 + ln + le);
    if (b.toString('utf8', local + 30, local + 30 + ln) !== name) fail('NATIVE_NAME_MISMATCH');
    const start = local + 30 + ln + le;
    if (start + compressed > dir) fail('INVALID_NATIVE_RANGE');
    if (flags & 8) {
      const at = start + compressed;
      const match = x => x + 12 <= dir && u32(b, x) === crc && u32(b, x + 4) === compressed && u32(b, x + 8) === plain;
      if (!match(at) && !(at + 16 <= dir && u32(b, at) === 0x08074b50 && match(at + 4)))
        fail('NATIVE_DESCRIPTOR_MISMATCH');
    }
    const zipped = b.subarray(start, start + compressed);
    const native = method === 0 ? zipped : inflateRawSync(zipped, { maxOutputLength: MAX_ELF });
    if (native.length !== plain || crc32(native) !== crc) fail('NATIVE_CRC_MISMATCH');
    const r = inspectArm64Elf(native);
    arm64++; eligible += Number(r.static16kEligible); legacy4k += r.legacy4k; loadSegments += r.loadSegments;
  }
  if (p !== dir + dirSize) fail('INVALID_ZIP_DIRECTORY');
  return {
    schema: 'dexcam-p01-private-arm64-elf-v1',
    apk_sha256_verified: true, apk_bytes: b.length,
    arm64_native_libraries: arm64, arm64_static_16k_eligible: eligible,
    arm64_static_16k_not_eligible: arm64 - eligible,
    load_segments: loadSegments, load_segments_aligned_4k: legacy4k,
    classification: arm64 === 0 ? 'NO_ARM64_LIBRARIES' : eligible === arm64 ? 'ELF_STATIC_16K_CANDIDATE_ONLY' : 'ELF_STATIC_16K_INCOMPATIBLE',
    apk_zip_alignment_checked: false, android_16k_runtime_verified: false,
    p01_rea_accepted: false, g1_g2_device_accepted: false, d01_apk_built: false,
  };
}

async function readPinnedFile(path) {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.size < 22 || stat.size > MAX_APK) fail('INVALID_INPUT_FILE');
  const flags = constants.O_RDONLY | (process.platform !== 'win32' ? constants.O_NOFOLLOW : 0);
  const file = await open(path, flags);
  try {
    const after = await file.stat();
    if (!after.isFile() || after.size !== stat.size || after.dev !== stat.dev || after.ino !== stat.ino)
      fail('INPUT_FILE_CHANGED');
    const data = Buffer.alloc(after.size);
    let n = 0;
    while (n < data.length) {
      const part = await file.read(data, n, data.length - n, n);
      if (!part.bytesRead) fail('INCOMPLETE_FILE_READ');
      n += part.bytesRead;
    }
    return data;
  } finally { await file.close(); }
}

export async function runP01(argv, output = s => process.stdout.write(s)) {
  if (argv.length !== 2 || !argv[0] || argv[0].startsWith('-')) {
    output(JSON.stringify({ ok: false, error: 'APK_PATH_AND_PINNED_SHA256_REQUIRED' }) + '\n');
    return 2;
  }
  try {
    const data = await readPinnedFile(argv[0]);
    const report = inspectPrivateApkNative(data, argv[1]);
    output(JSON.stringify({ ok: true, ...report }) + '\n');
    return 0;
  } catch {
    output(JSON.stringify({ ok: false, error: 'PRIVATE_APK_STATIC_PREFLIGHT_FAILED' }) + '\n');
    return 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  process.exitCode = await runP01(process.argv.slice(2));
