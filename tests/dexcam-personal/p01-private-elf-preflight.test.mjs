import { createHash } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspectArm64Elf, inspectPrivateApkNative, runP01 } from '../../projects/dexcam-personal/p01-private-elf-preflight.mjs';

let t;
function crc32(b) {
  t ??= Array.from({ length: 256 }, (_, i) => {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
    return c >>> 0;
  });
  let c = 0xffffffff;
  for (const x of b) c = (c >>> 8) ^ t[(c ^ x) & 255];
  return (c ^ 0xffffffff) >>> 0;
}
function elf(align = 4096n) {
  const b = Buffer.alloc(176);
  b.write('7f454c46', 0, 'hex'); b[4] = 2; b[5] = 1; b[6] = 1;
  b.writeUInt16LE(3, 16); b.writeUInt16LE(183, 18);
  b.writeBigUInt64LE(64n, 32); b.writeUInt16LE(64, 52);
  b.writeUInt16LE(56, 54); b.writeUInt16LE(1, 56);
  b.writeUInt32LE(1, 64); b.writeBigUInt64LE(0n, 64 + 8);
  b.writeBigUInt64LE(0x400000n, 64 + 16); b.writeBigUInt64LE(BigInt(b.length), 64 + 32);
  b.writeBigUInt64LE(align, 64 + 48);
  return b;
}
function apk({ align = 4096n, compressed = false, tamperCrc = false, mismatchHeader = false, descriptor = false, name = 'lib/arm64-v8a/libsample.so' } = {}) {
  const raw = elf(align), zipped = compressed ? deflateRawSync(raw) : raw;
  const nameBuf = Buffer.from(name);
  const method = compressed ? 8 : 0, crc = crc32(raw);
  const local = Buffer.alloc(30 + nameBuf.length);
  local.writeUInt32LE(0x04034b50); local.writeUInt16LE(descriptor ? 8 : 0, 6);
  local.writeUInt16LE(mismatchHeader ? (method === 0 ? 8 : 0) : method, 8);
  if (!descriptor) {
    local.writeUInt32LE(tamperCrc ? 0 : crc, 14); local.writeUInt32LE(zipped.length, 18); local.writeUInt32LE(raw.length, 22);
  }
  local.writeUInt16LE(nameBuf.length, 26); nameBuf.copy(local, 30);
  const dd = Buffer.alloc(descriptor ? 16 : 0);
  if (descriptor) {
    dd.writeUInt32LE(0x08074b50); dd.writeUInt32LE(crc, 4);
    dd.writeUInt32LE(zipped.length, 8); dd.writeUInt32LE(raw.length, 12);
  }
  const cd = Buffer.alloc(46 + nameBuf.length);
  cd.writeUInt32LE(0x02014b50);
  cd.writeUInt16LE(descriptor ? 8 : 0, 8); cd.writeUInt16LE(method, 10);
  cd.writeUInt32LE(tamperCrc ? 0 : crc, 16);
  cd.writeUInt32LE(zipped.length, 20); cd.writeUInt32LE(raw.length, 24);
  cd.writeUInt16LE(nameBuf.length, 28); nameBuf.copy(cd, 46);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(local.length + zipped.length + dd.length, 16);
  return Buffer.concat([local, zipped, dd, cd, eocd]);
}
const pin = b => createHash('sha256').update(b).digest('hex');

test('4KiB ELF fails 16KiB static preflight, no runtime or REA acceptance', () => {
  const b = apk(); const r = inspectPrivateApkNative(b, pin(b));
  assert.equal(r.arm64_native_libraries, 1);
  assert.equal(r.arm64_static_16k_not_eligible, 1);
  assert.equal(r.load_segments_aligned_4k, 1);
  assert.equal(r.classification, 'ELF_STATIC_16K_INCOMPATIBLE');
  assert.equal(r.p01_rea_accepted, false);
  assert.equal(r.android_16k_runtime_verified, false);
  assert.equal(r.apk_zip_alignment_checked, false);
  assert.equal(JSON.stringify(r).includes('libsample'), false);
});
test('16KiB ELF passes only static candidate with compressed ZIP and verified CRC', () => {
  const b = apk({ align: 16384n, compressed: true });
  const r = inspectPrivateApkNative(b, pin(b));
  assert.equal(r.arm64_static_16k_eligible, 1);
  assert.equal(r.classification, 'ELF_STATIC_16K_CANDIDATE_ONLY');
  assert.equal(r.g1_g2_device_accepted, false);
});
test('supports descriptor ZIP written without local sizes', () => {
  const b = apk({ align: 16384n, compressed: true, descriptor: true });
  assert.equal(inspectPrivateApkNative(b, pin(b)).arm64_static_16k_eligible, 1);
});
test('tampered pin fails even for a syntactically valid archive', () => {
  const b = apk(); assert.throws(() => inspectPrivateApkNative(b, '0'.repeat(64)), /APK_SHA256_MISMATCH/);
});
test('missing pin fails closed', () => {
  const b = apk(); assert.throws(() => inspectPrivateApkNative(b, ''), /PINNED_SHA256_REQUIRED/);
});
test('invalid central checksum fails closed', () => {
  const b = apk({ tamperCrc: true });
  assert.throws(() => inspectPrivateApkNative(b, pin(b)), /NATIVE_CRC_MISMATCH/);
});
test('local ZIP method mismatches central -> reject', () => {
  const b = apk({ mismatchHeader: true });
  assert.throws(() => inspectPrivateApkNative(b, pin(b)), /NATIVE_HEADER_MISMATCH/);
});
test('a corrupt descriptor cannot be hidden behind a central checksum', () => {
  const b = apk({ descriptor: true }); b.writeUInt32LE(12, 30 + Buffer.byteLength('lib/arm64-v8a/libsample.so') + elf().length + 4);
  assert.throws(() => inspectPrivateApkNative(b, pin(b)), /NATIVE_DESCRIPTOR_MISMATCH/);
});
test('non-arm64 native files cannot be miscounted as arm64 evidence', () => {
  const b = apk({ name: 'lib/armeabi-v7a/liblegacy.so' });
  assert.equal(inspectPrivateApkNative(b, pin(b)).classification, 'NO_ARM64_LIBRARIES');
});
test('rejects malformed ELF identity and a PT_LOAD missing from header', () => {
  const b = elf(); b[4] = 1;
  assert.throws(() => inspectArm64Elf(b), /INVALID_ARM64_ELF/);
  const c = elf(); c.writeUInt32LE(0, 64);
  assert.throws(() => inspectArm64Elf(c), /NO_ELF_LOAD_SEGMENT/);
});
test('rejects an ELF LOAD segment with invalid alignment and memory bounds', () => {
  const b = elf(); b.writeBigUInt64LE(3000n, 64 + 48);
  assert.throws(() => inspectArm64Elf(b), /INVALID_ELF_LOAD_SEGMENT/);
  const c = elf(); c.writeBigUInt64LE(BigInt(c.length + 10), 64 + 32);
  assert.throws(() => inspectArm64Elf(c), /INVALID_ELF_LOAD_SEGMENT/);
});
test('CLI does not disclose private local paths on missing file or bad input', async () => {
  let output='';
  const exit = await runP01(['/private/OWNER_SECRET.apk', 'a'.repeat(64)], x => {output += x;});
  assert.equal(exit, 1);
  assert.equal(JSON.parse(output).error, 'PRIVATE_APK_STATIC_PREFLIGHT_FAILED');
  assert.equal(output.includes('OWNER_SECRET'), false);
});
