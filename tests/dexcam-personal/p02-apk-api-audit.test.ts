import { expect, it } from 'vitest';
// @ts-ignore Standalone ESM module with no ambient JS declarations.
import { inspectApkPublicApi, runP02 } from '../../projects/dexcam-personal/p02-apk-api-audit.mjs';
// @ts-ignore Synthetic test-only JavaScript fixture, no external APK content.
import { makeDex, makeZip, makeDuplicateDexCentralEntry, makeDescriptorZip } from './p02-apk-api-fixture.mjs';

it('checks exact whitelisted Android method refs from a synthetic APK', () => {
  const r = inspectApkPublicApi(makeZip());
  expect(r.schema).toBe('dexcam-p02-public-api-audit-v1');
  expect(r.method_ids_by_category).toEqual({usb:1,camera:0,window:1,render:0});
  expect(r.dex_method_ids_total).toBe(3);
  expect(r.public_api_reference_presence.usb_request_permission).toBe(true);
  expect(r.public_api_reference_presence.window_request_launch_bounds).toBe(true);
  expect(r.public_api_reference_presence.usb_open_device).toBe(false);
  expect(r.runtime_usb_or_camera_or_deX_accepted).toBe(false);
  expect(JSON.stringify(r)).not.toContain('NeverPublish');
});
it('supports a deflated DEX without launching native APK code', () => {
  const r = inspectApkPublicApi(makeZip('classes.dex',makeDex(),{compressed:true}));
  expect(r.method_ids_by_category.usb).toBe(1);
});
it('fails closed on a tampered CRC', () => {
  expect(() => inspectApkPublicApi(makeZip('classes.dex',makeDex(),{corruptCRC:true})))
    .toThrow('DEX_ZIP_CRC_OR_SIZE_MISMATCH');
});
it('fails closed on an APK ZIP without a root DEX', () => {
  expect(() => inspectApkPublicApi(makeZip('unrelated.png'))).toThrow('NO_VALID_DEX_ARCHIVE');
});
it('fails closed on malformed DEX headers', () => {
  expect(() => inspectApkPublicApi(makeZip('classes.dex',makeDex({badMagic:true}))))
    .toThrow('INVALID_DEX_HEADER');
});
it('keeps malformed private input path out of CLI JSON errors', async () => {
  let out=''; const code=await runP02(['/private/SECRET-OWNER-APK.apk'],(s: string)=>{out+=s;});
  expect(code).toBe(1);
  expect(JSON.parse(out).error).toBe('LOCAL_APK_STATIC_AUDIT_FAILED');
  expect(out).not.toContain('SECRET-OWNER-APK');
});

it('rejects a mismatched local ZIP compression method versus central directory', () => {
  const b = makeZip(); b.writeUInt16LE(8, 8);
  expect(() => inspectApkPublicApi(b)).toThrow('ZIP_MEMBER_HEADER_MISMATCH');
});
it('rejects local ZIP encryption flag absent from central directory', () => {
  const b = makeZip(); b.writeUInt16LE(1, 6);
  expect(() => inspectApkPublicApi(b)).toThrow('ZIP_MEMBER_HEADER_MISMATCH');
});
it('rejects local ZIP CRC inconsistent with trusted decoded DEX', () => {
  const b = makeZip(); b.writeUInt32LE(0, 14);
  expect(() => inspectApkPublicApi(b)).toThrow('ZIP_MEMBER_HEADER_MISMATCH');
});
it('rejects local ZIP size inconsistent with central directory', () => {
  const b = makeZip(); b.writeUInt32LE(10, 18);
  expect(() => inspectApkPublicApi(b)).toThrow('ZIP_MEMBER_HEADER_MISMATCH');
});
it('permits a ZIP data descriptor with empty local CRC and sizes', () => {
  const original = makeZip(); const central = original.readUInt32LE(original.length - 22 + 16);
  const descriptor = Buffer.alloc(16);
  descriptor.writeUInt32LE(0x08074b50, 0);
  descriptor.writeUInt32LE(original.readUInt32LE(14), 4);
  descriptor.writeUInt32LE(original.readUInt32LE(18), 8);
  descriptor.writeUInt32LE(original.readUInt32LE(22), 12);
  const b = Buffer.concat([original.subarray(0, central), descriptor, original.subarray(central)]);
  b.writeUInt16LE(8, 6); b.writeUInt16LE(8, central + 16 + 8);
  b.writeUInt32LE(0, 14); b.writeUInt32LE(0, 18); b.writeUInt32LE(0, 22);
  b.writeUInt32LE(central + 16, b.length - 22 + 16);
  expect(inspectApkPublicApi(b).method_ids_by_category.usb).toBe(1);
});

it('rejects a duplicated root DEX central record instead of counting one method table twice', () => {
  expect(() => inspectApkPublicApi(makeDuplicateDexCentralEntry())).toThrow('DUPLICATE_DEX_ZIP_MEMBER');
});

it('fails closed when a ZIP bit-3 descriptor is missing', () => {
  expect(() => inspectApkPublicApi(makeDescriptorZip({ omitted: true }))).toThrow('DEX_ZIP_DESCRIPTOR_MISMATCH');
});
it('fails closed on contradictory signed CRC or unsigned size in a ZIP data descriptor', () => {
  expect(() => inspectApkPublicApi(makeDescriptorZip({ corruptCrc: true }))).toThrow('DEX_ZIP_DESCRIPTOR_MISMATCH');
  expect(() => inspectApkPublicApi(makeDescriptorZip({ corruptSize: true, signed: false }))).toThrow('DEX_ZIP_DESCRIPTOR_MISMATCH');
});
it('accepts valid unsigned ZIP data descriptors', () => {
  expect(inspectApkPublicApi(makeDescriptorZip({ signed: false })).method_ids_by_category.usb).toBe(1);
});
