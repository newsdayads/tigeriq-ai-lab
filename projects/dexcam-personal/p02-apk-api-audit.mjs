/**
 * DeXCam P02: read-only structural audit of PUBLIC Android method-ID references.
 * Input APK is private and never uploaded; this tool emits only whitelisted
 * Android API aggregates, not strings/classes from private app code.
 * DEX method IDs are not executed-method evidence or Android/DeX compatibility tests.
 * Node.js >=20, no third-party dependencies, no Android/PC01 access.
 */
import { constants as fsFlags } from 'node:fs';
import { open, lstat } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const MAX_APK_BYTES = 128 * 1024 * 1024;
const MAX_DEX_BYTES = 64 * 1024 * 1024;
const MAX_ZIP_MEMBERS = 30000;
const EXPECTED_TAG = 0x12345678;
const groups = Object.freeze({
  usb: ['Landroid/hardware/usb/'],
  camera: ['Landroid/hardware/Camera;', 'Landroid/hardware/camera2/'],
  window: ['Landroid/app/ActivityOptions;', 'Landroid/app/ActivityTaskManager;', 'Landroid/view/WindowManager;', 'Landroid/view/WindowManager$LayoutParams;'],
  render: ['Landroid/media/MediaCodec;', 'Landroid/graphics/SurfaceTexture;', 'Landroid/graphics/Surface;', 'Landroid/view/Surface;'],
});
const probes = Object.freeze({
  usb_request_permission: ['Landroid/hardware/usb/UsbManager;', 'requestPermission'],
  usb_open_device: ['Landroid/hardware/usb/UsbManager;', 'openDevice'],
  usb_control_transfer: ['Landroid/hardware/usb/UsbDeviceConnection;', 'controlTransfer'],
  usb_interface_class: ['Landroid/hardware/usb/UsbInterface;', 'getInterfaceClass'],
  camera_legacy_open: ['Landroid/hardware/Camera;', 'open'],
  window_request_launch_bounds: ['Landroid/app/ActivityOptions;', 'setLaunchBounds'],
  window_request_display: ['Landroid/app/ActivityOptions;', 'setLaunchDisplayId'],
  render_surface_texture: ['Landroid/graphics/SurfaceTexture;', 'updateTexImage'],
});
const assertRange = (b, off, len) => {
  if (!Number.isSafeInteger(off) || !Number.isSafeInteger(len) || off < 0 || len < 0 || off + len > b.length)
    throw new Error('INVALID_BINARY_RANGE');
};
const u16 = (b, off) => { assertRange(b, off, 2); return b.readUInt16LE(off); };
const u32 = (b, off) => { assertRange(b, off, 4); return b.readUInt32LE(off); };
function readUleb(b, off) {
  let v = 0;
  for (let i = 0; i < 5; i++) {
    assertRange(b, off + i, 1);
    const x = b[off + i];
    v |= (x & 0x7f) << (7 * i);
    if (!(x & 0x80)) return (off + i + 1);
  }
  throw new Error('INVALID_DEX_STRING_LENGTH');
}
function checkTable(b, count, offset, width) {
  if (count > 1000000 || (count && offset < 0x70)) throw new Error('INVALID_DEX_TABLE');
  assertRange(b, offset, count * width);
}
function parseDexPublicApi(bytes) {
  const b = Buffer.from(bytes);
  if (b.length < 112 || b.subarray(0, 4).toString('ascii') !== 'dex\n' ||
      b[7] !== 0 || u32(b, 32) !== b.length || u32(b, 36) !== 112 || u32(b, 40) !== EXPECTED_TAG)
    throw new Error('INVALID_DEX_HEADER');
  const ns = u32(b, 56), os = u32(b, 60), nt = u32(b, 64), ot = u32(b, 68);
  const nm = u32(b, 88), om = u32(b, 92), nc = u32(b, 96), oc = u32(b, 100);
  checkTable(b, ns, os, 4); checkTable(b, nt, ot, 4);
  checkTable(b, nm, om, 8); checkTable(b, nc, oc, 32);
  // Resolve only strings needed by DEX type IDs and method names. These are
  // kept in memory; no vendor identifiers enter the output.
  const needed = new Set();
  const typeStr = [];
  for (let i = 0; i < nt; i++) { const idx = u32(b, ot + i * 4); if (idx >= ns) throw new Error('INVALID_DEX_INDEX'); typeStr.push(idx); needed.add(idx); }
  for (let i = 0; i < nm; i++) { const idx = u32(b, om + i * 8 + 4); if (idx >= ns) throw new Error('INVALID_DEX_INDEX'); needed.add(idx); }
  const strs = new Map();
  for (const i of needed) {
    const start = readUleb(b, u32(b, os + i * 4));
    const end = b.indexOf(0, start);
    if (end < 0 || end - start > 65535) throw new Error('INVALID_DEX_STRING');
    strs.set(i, b.subarray(start, end).toString('utf8'));
  }
  const types = typeStr.map(i => strs.get(i));
  const own = new Set();
  for (let i = 0; i < nc; i++) { const idx = u32(b, oc + i * 32); if (idx >= nt) throw new Error('INVALID_DEX_INDEX'); own.add(idx); }
  const counts = Object.fromEntries(Object.keys(groups).map(k => [k, 0]));
  const found = Object.fromEntries(Object.keys(probes).map(k => [k, false]));
  for (let i = 0; i < nm; i++) {
    const cls = u16(b, om + i * 8);
    if (cls >= nt) throw new Error('INVALID_DEX_INDEX');
    if (own.has(cls)) continue;
    const cname = types[cls];
    const method = strs.get(u32(b, om + i * 8 + 4));
    for (const [g, prefixes] of Object.entries(groups))
      if (prefixes.some(p => cname.startsWith(p))) counts[g]++;
    for (const [name, pair] of Object.entries(probes))
      if (cname === pair[0] && method === pair[1]) found[name] = true;
  }
  return { counts, probes: found, dex_method_id_count: nm, dex_declared_class_count: nc };
}

let table;
function crc32(b) {
  if (!table) table = Array.from({ length: 256 }, (_, i) => {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
    return c >>> 0;
  });
  let n = 0xffffffff;
  for (const x of b) n = (n >>> 8) ^ table[(n ^ x) & 0xff];
  return (n ^ 0xffffffff) >>> 0;
}
function readDexMembersFromApk(input) {
  const apk = Buffer.from(input);
  if (apk.length < 22 || apk.length > MAX_APK_BYTES) throw new Error('INVALID_APK_SIZE');
  const low = Math.max(0, apk.length - 22 - 65535);
  let eocd = -1;
  for (let p = apk.length - 22; p >= low; p--) {
    if (u32(apk, p) === 0x06054b50 && p + 22 + u16(apk, p + 20) === apk.length) { eocd = p; break; }
  }
  if (eocd < 0 || u16(apk, eocd + 4) || u16(apk, eocd + 6) || u16(apk, eocd + 8) !== u16(apk, eocd + 10))
    throw new Error('UNSUPPORTED_ZIP_ARCHIVE');
  const members = u16(apk, eocd + 10), size = u32(apk, eocd + 12), offset = u32(apk, eocd + 16);
  if (members > MAX_ZIP_MEMBERS || offset + size > eocd) throw new Error('INVALID_ZIP_CENTRAL_DIRECTORY');
  let p = offset;
  const dex = [];
  for (let i = 0; i < members; i++) {
    if (u32(apk, p) !== 0x02014b50) throw new Error('INVALID_ZIP_MEMBER');
    const flags = u16(apk, p + 8), method = u16(apk, p + 10), expectedCrc = u32(apk, p + 16),
      zipSize = u32(apk, p + 20), rawSize = u32(apk, p + 24), nameLen = u16(apk, p + 28),
      extraLen = u16(apk, p + 30), commentLen = u16(apk, p + 32), diskStart = u16(apk, p + 34), localOffset = u32(apk, p + 42);
    assertRange(apk, p, 46 + nameLen + extraLen + commentLen);
    const name = apk.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    p += 46 + nameLen + extraLen + commentLen;
    if (!/^classes(?:[2-9]\d*)?\.dex$/.test(name)) continue;
    if (diskStart || (flags & 1) || ![0, 8].includes(method) || rawSize > MAX_DEX_BYTES || zipSize > MAX_APK_BYTES)
      throw new Error('UNSUPPORTED_DEX_ZIP_MEMBER');
    if (u32(apk, localOffset) !== 0x04034b50) throw new Error('INVALID_ZIP_LOCAL_HEADER');
    // The central directory is untrusted too. A local entry that disagrees can
    // make provenance claims contradictory even when decompressed DEX CRC passes.
    const localFlags = u16(apk, localOffset + 6), localMethod = u16(apk, localOffset + 8);
    if (localFlags !== flags || localMethod !== method) throw new Error('ZIP_MEMBER_HEADER_MISMATCH');
    // GPBF bit 3 permits CRC and sizes to be absent from the local header;
    // in that case the central directory supplies them for post-inflate checks.
    if (!(flags & 0x0008) && (u32(apk, localOffset + 14) !== expectedCrc ||
        u32(apk, localOffset + 18) !== zipSize || u32(apk, localOffset + 22) !== rawSize))
      throw new Error('ZIP_MEMBER_HEADER_MISMATCH');
    const localNameLen = u16(apk, localOffset + 26), localExtraLen = u16(apk, localOffset + 28);
    assertRange(apk, localOffset, 30 + localNameLen + localExtraLen);
    if (apk.subarray(localOffset + 30, localOffset + 30 + localNameLen).toString('utf8') !== name)
      throw new Error('ZIP_MEMBER_NAME_MISMATCH');
    const start = localOffset + 30 + localNameLen + localExtraLen;
    assertRange(apk, start, zipSize);
    const compressed = apk.subarray(start, start + zipSize);
    const b = method === 0 ? compressed : inflateRawSync(compressed, { maxOutputLength: MAX_DEX_BYTES });
    if (b.length !== rawSize || crc32(b) !== expectedCrc) throw new Error('DEX_ZIP_CRC_OR_SIZE_MISMATCH');
    dex.push({ name, bytes: b });
  }
  if (p !== offset + size || dex.length === 0) throw new Error('NO_VALID_DEX_ARCHIVE');
  return dex;
}
export function inspectApkPublicApi(apk) {
  const data = Buffer.from(apk);
  const files = readDexMembersFromApk(data);
  const byDex = files.map(x => ({ member: x.name, ...parseDexPublicApi(x.bytes) }));
  const method_ids_by_category = Object.fromEntries(Object.keys(groups).map(g => [g, byDex.reduce((n, d) => n + d.counts[g], 0)]));
  const public_api_reference_presence = Object.fromEntries(Object.keys(probes).map(k => [k, byDex.some(d => d.probes[k])]));
  return {
    schema: 'dexcam-p02-public-api-audit-v1',
    classification: 'STATIC_METHOD_IDS_ONLY_NOT_EXECUTED_CALLS',
    apk_sha256: createHash('sha256').update(data).digest('hex'),
    apk_bytes: data.length,
    dex_members: byDex.map(d => d.member),
    dex_method_ids_total: byDex.reduce((n, d) => n + d.dex_method_id_count, 0),
    method_ids_by_category,
    public_api_reference_presence,
    runtime_usb_or_camera_or_deX_accepted: false,
  };
}
async function readPrivateApk(path) {
  const before = await lstat(path);
  if (!before.isFile() || before.size > MAX_APK_BYTES) throw new Error('INVALID_INPUT_FILE');
  const flags = fsFlags.O_RDONLY | fsFlags.O_NONBLOCK | (process.platform === 'win32' ? 0 : fsFlags.O_NOFOLLOW);
  const file = await open(path, flags);
  try {
    const after = await file.stat();
    if (!after.isFile() || after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size)
      throw new Error('INPUT_FILE_CHANGED');
    const buffer = Buffer.alloc(after.size);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    if (bytesRead !== buffer.length) throw new Error('INCOMPLETE_APK_READ');
    return buffer;
  } finally { await file.close(); }
}
export async function runP02(argv, write = s => process.stdout.write(s)) {
  if (argv.length !== 1 || !argv[0] || argv[0].startsWith('-')) {
    write(JSON.stringify({ ok: false, error: 'ONE_PRIVATE_APK_PATH_REQUIRED' }) + '\n');
    return 2;
  }
  try {
    const apk = await readPrivateApk(argv[0]);
    const result = inspectApkPublicApi(apk);
    write(JSON.stringify({ ok: true, ...result }) + '\n');
    return 0;
  } catch {
    // Never print private file paths, APK bytes, vendor class names, exception stack, or input tokens.
    write(JSON.stringify({ ok: false, error: 'LOCAL_APK_STATIC_AUDIT_FAILED' }) + '\n');
    return 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await runP02(process.argv.slice(2));
}
