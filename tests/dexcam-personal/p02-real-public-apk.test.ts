import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
// @ts-ignore Standalone ESM module without ambient TypeScript declarations.
import { inspectApkPublicApi } from '../../projects/dexcam-personal/p02-apk-api-audit.mjs';

// Immutable Git-blob digest, not an unverified "latest" sample. This fixture is
// publicly hosted in androguard/androguard. NEVER use the private UltraCar APK
// on a GitHub runner or attach APK/DEX bytes to the test output.
const PUBLIC_SAMPLE_URL =
  'https://raw.githubusercontent.com/androguard/androguard/master/tests/data/APK/TestActivity.apk';
const PUBLIC_GIT_BLOB_SHA = 'b43a1d3da7b68c8a3aa94bed8534ea3bfce80e1b';
const PUBLIC_APK_BYTES = 174896;

it('P02 parses an exact-hash public Android APK, not merely synthetic ZIP/DEX fixtures', async () => {
  const response = await fetch(PUBLIC_SAMPLE_URL, {
    headers: { 'User-Agent': 'TigerIQ-DeXCam-P02-public-fixture' },
    signal: AbortSignal.timeout(20_000),
  });
  expect(response.status).toBe(200);
  const apk = Buffer.from(await response.arrayBuffer());
  expect(apk.length).toBe(PUBLIC_APK_BYTES);
  // Git hashes content with an object-type/byte-length prefix; pin exact bytes.
  const blobSha = createHash('sha1').update(`blob ${apk.length}\0`).update(apk).digest('hex');
  expect(blobSha).toBe(PUBLIC_GIT_BLOB_SHA);

  const result = inspectApkPublicApi(apk);
  expect(result.schema).toBe('dexcam-p02-public-api-audit-v1');
  expect(result.apk_bytes).toBe(PUBLIC_APK_BYTES);
  expect(result.dex_members).toEqual(['classes.dex']);
  expect(result.dex_method_ids_total).toBeGreaterThan(0);
  expect(result.runtime_usb_or_camera_or_deX_accepted).toBe(false);
  expect(result.classification).toBe('STATIC_METHOD_IDS_ONLY_NOT_EXECUTED_CALLS');
}, 30_000);
