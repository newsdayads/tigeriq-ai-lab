import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectApkPublicApi, runP02 } from '../../projects/dexcam-personal/p02-apk-api-audit.mjs';
import { makeDex, makeZip, makeDuplicateDexCentralEntry, makeDescriptorZip } from './p02-apk-api-fixture.mjs';

test('offline stored DEX counts public references without leaking vendor identifiers', () => {
  const r = inspectApkPublicApi(makeZip());
  assert.deepEqual(r.method_ids_by_category, { usb:1, camera:0, window:1, render:0 });
  assert.equal(r.dex_method_ids_total, 3);
  assert.equal(r.public_api_reference_presence.usb_request_permission, true);
  assert.equal(r.public_api_reference_presence.window_request_launch_bounds, true);
  assert.equal(r.public_api_reference_presence.usb_open_device, false);
  assert.equal(r.runtime_usb_or_camera_or_deX_accepted,false);
  assert.ok(!JSON.stringify(r).includes('NeverPublish'));
  assert.equal(r.dex_members[0],'classes.dex');
});
test('deflated DEX member audited without shell or temporary file', () => {
  const r=inspectApkPublicApi(makeZip('classes.dex',makeDex(),{compressed:true}));
  assert.equal(r.method_ids_by_category.usb,1);
});
test('malformed ZIP rejected, no fallback to guessing', () => assert.throws(()=>inspectApkPublicApi(Buffer.from('not an apk')),/INVALID_APK_SIZE/));
test('APK missing DEX rejected', () => assert.throws(()=>inspectApkPublicApi(makeZip('picture.png')),/NO_VALID_DEX_ARCHIVE/));
test('untrusted DEX CRC mismatch rejected', () => assert.throws(()=>inspectApkPublicApi(makeZip('classes.dex',makeDex(),{corruptCRC:true})),/DEX_ZIP_CRC_OR_SIZE_MISMATCH/));
test('encrypted DEX member rejected', () => assert.throws(()=>inspectApkPublicApi(makeZip('classes.dex',makeDex(),{encrypted:true})),/UNSUPPORTED_DEX_ZIP_MEMBER/));
test('malformed DEX header rejected', () => assert.throws(()=>inspectApkPublicApi(makeZip('classes.dex',makeDex({badMagic:true}))),/INVALID_DEX_HEADER/));
test('ZIP nonroot DEX entry ignored and rejected', () => assert.throws(()=>inspectApkPublicApi(makeZip('private/classes.dex')),/NO_VALID_DEX_ARCHIVE/));
test('CLI rejects missing path without printing local context', async () => {
  let out='';const code=await runP02([],s=>{out+=s;});
  assert.equal(code,2); assert.equal(JSON.parse(out).error,'ONE_PRIVATE_APK_PATH_REQUIRED');
});
test('CLI fails closed and sanitizes missing private path',async()=>{
  const path='/private/SENSITIVE_APK_IDENTIFIER_9988.apk';let out='';
  const code=await runP02([path],s=>{out+=s;});
  assert.equal(code,1);assert.equal(JSON.parse(out).error,'LOCAL_APK_STATIC_AUDIT_FAILED');
  assert.ok(!out.includes('SENSITIVE_APK_IDENTIFIER_9988'));
});

test('rejects ZIP local method mismatch even if central DEX and CRC parse normally', () => {
  const b = makeZip(); b.writeUInt16LE(8, 8); // local says deflated; central says stored
  assert.throws(() => inspectApkPublicApi(b), /ZIP_MEMBER_HEADER_MISMATCH/);
});
test('rejects local encryption bit set when central entry claims plain DEX', () => {
  const b = makeZip(); b.writeUInt16LE(1, 6);
  assert.throws(() => inspectApkPublicApi(b), /ZIP_MEMBER_HEADER_MISMATCH/);
});
test('rejects forged local CRC while central CRC matches decompressed DEX', () => {
  const b = makeZip(); b.writeUInt32LE(0, 14);
  assert.throws(() => inspectApkPublicApi(b), /ZIP_MEMBER_HEADER_MISMATCH/);
});
test('rejects forged local size despite correct central sizes', () => {
  const b = makeZip(); b.writeUInt32LE(10, 18);
  assert.throws(() => inspectApkPublicApi(b), /ZIP_MEMBER_HEADER_MISMATCH/);
});
test('supports ZIP data-descriptor bit with unset local sizes as permitted by APPNOTE', () => {
  const orig = makeZip();
  const oldCentral = orig.readUInt32LE(orig.length - 22 + 16);
  // Genuine signed data descriptor: central offset shifts past the 16-byte descriptor.
  const descriptor = Buffer.alloc(16);
  descriptor.writeUInt32LE(0x08074b50, 0);
  descriptor.writeUInt32LE(orig.readUInt32LE(14), 4);
  descriptor.writeUInt32LE(orig.readUInt32LE(18), 8);
  descriptor.writeUInt32LE(orig.readUInt32LE(22), 12);
  const b = Buffer.concat([orig.subarray(0, oldCentral), descriptor, orig.subarray(oldCentral)]);
  b.writeUInt16LE(8, 6); b.writeUInt16LE(8, oldCentral + 16 + 8);
  b.writeUInt32LE(0, 14); b.writeUInt32LE(0, 18); b.writeUInt32LE(0, 22);
  b.writeUInt32LE(oldCentral + 16, b.length - 22 + 16);
  const r = inspectApkPublicApi(b);
  assert.equal(r.method_ids_by_category.usb, 1);
});

test('rejects duplicated central-directory DEX entry rather than double-counting public APIs', () => {
  assert.throws(() => inspectApkPublicApi(makeDuplicateDexCentralEntry()), /DUPLICATE_DEX_ZIP_MEMBER/);
});

test('fails closed when ZIP bit-3 declares a missing data descriptor', () => {
  assert.throws(() => inspectApkPublicApi(makeDescriptorZip({ omitted: true })), /DEX_ZIP_DESCRIPTOR_MISMATCH/);
});
test('fails closed when ZIP bit-3 descriptor disagrees with the verified DEX CRC or size', () => {
  assert.throws(() => inspectApkPublicApi(makeDescriptorZip({ corruptCrc: true })), /DEX_ZIP_DESCRIPTOR_MISMATCH/);
  assert.throws(() => inspectApkPublicApi(makeDescriptorZip({ corruptSize: true, signed: false })), /DEX_ZIP_DESCRIPTOR_MISMATCH/);
});
test('accepts a valid unsigned ZIP data descriptor', () => {
  assert.equal(inspectApkPublicApi(makeDescriptorZip({ signed: false })).method_ids_by_category.usb, 1);
});
