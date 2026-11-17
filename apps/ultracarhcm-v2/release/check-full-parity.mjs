// Owner GH-5135: fail-closed full-parity gate. Native QA artifacts remain private.
// This does not execute Android or prove evidence authenticity; callers must independently
// verify APK SHA, apk-signer certificate and physical device evidence.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const mandatoryFeatureIds = Object.freeze(
  Array.from({ length: 22 }, (_, index) => 'F' + String(index + 1).padStart(2, '0')),
);
export const mandatoryRegressionIds = Object.freeze(
  Array.from({ length: 10 }, (_, index) => 'D' + String(index + 1).padStart(2, '0')),
);
export const mandatoryHardwareIds = Object.freeze([
  'S10_OR_FOLD2', 'DEX_EXTERNAL', 'USB_UVC_PHYSICAL', 'BT_REMOTE_PHYSICAL',
  'GEAR_R_PHYSICAL', 'APP_COEXISTENCE',
]);
const isSha = (s) => typeof s === 'string' && /^[a-f0-9]{64}$/i.test(s);
const objectRecord = (a) => a !== null && typeof a === 'object' && !Array.isArray(a);

/**
 * Evidence is accepted only if it names the EXACT signed APK, a device, a
 * timestamp, and a checkable artifact. A source-only test cannot be accepted.
 */
export function assessFullParityRelease(candidate) {
  const reasons = [];
  const c = objectRecord(candidate) ? candidate : {};
  const signed = c.signedApk || {};
  const apkSha = signed.sha256;
  if (signed.packageName !== 'ai.tigeriq.ultracarhcm.v2') reasons.push('SIGNED_APK_PACKAGE_INVALID');
  if (!isSha(apkSha)) reasons.push('SIGNED_APK_SHA_MISSING');
  if (!isSha(signed.certificateSha256) || signed.verifiedV2 !== true ||
      signed.verifiedV3 !== true) reasons.push('ANDROID_SIGNATURE_V2_V3_NOT_VERIFIED');
  if (!isSha(c.sourceGitSha)) reasons.push('SOURCE_SHA_UNVERIFIED');
  // Owner's release metadata labels the accepted Golden V1 v1.2.23/Build369.
  // On 17 Nov 2026, aapt2 dump badging AND binary XMLTREE both confirmed
  // the exact signed Golden SHA below actually embeds 1.2.16/Build362.
  // This conflict must NOT invalidate Owner's historical UI acceptance, but
  // until a separately governed provenance reconciliation it must block a
  // V2 release claiming full parity with a falsely attested V1 baseline.
  if (c.v1Baseline?.sha256 !== '07FA280005D71C0D4E38C085C3077ED01B66497E1E3EB54B0C2ED4D7999F038E' ||
      c.v1Baseline?.versionCode !== 369 ||
      c.v1Baseline?.versionName !== '1.2.23') {
    reasons.push('GOLDEN_V1_1223_BUILD369_IDENTITY_NOT_PINNED');
  }
  // Verified by two independent parsers, not just the untrusted APK filename.
  // Exact PC01 receipt hash: 8EDCFA452DCB750F732ABFE6992FDB7D7702FBDAF329BE8D8B64C37F2991784E.
  // Never auto-clear using mock accepted flags; owner-governed resolution is
  // required to update this gate and its source/receipt tests.
  reasons.push('GOLDEN_V1_BUILD369_RELEASE_LABEL_VS_EMBEDDED_BUILD362_UNRESOLVED');
  const validRecord = (record, id) =>
    objectRecord(record) && record.id === id && record.status === 'ACCEPTED' &&
    record.signedApkSha256 === apkSha && typeof record.deviceId === 'string' &&
    record.deviceId.length > 0 && isSha(record.evidenceSha256) &&
    typeof record.acceptedAt === 'string' && record.acceptedAt.length >= 10;

  for (const id of mandatoryFeatureIds) {
    if (!validRecord(c.features?.[id], id)) reasons.push(id + '_MISSING_DEVICE_ACCEPTANCE');
  }
  for (const id of mandatoryRegressionIds) {
    if (!validRecord(c.regressions?.[id], id)) reasons.push(id + '_MISSING_DEVICE_ACCEPTANCE');
  }
  for (const id of mandatoryHardwareIds) {
    if (!validRecord(c.hardware?.[id], id)) reasons.push(id + '_MISSING_PHYSICAL_EVIDENCE');
  }
  if (c.ownerMediaRightsVerified !== true) reasons.push('OWNER_MEDIA_RIGHTS_UNVERIFIED');
  if (c.adminLicenseBackendVerified !== true) reasons.push('ADMIN_LICENSE_BACKEND_UNVERIFIED');
  if (c.ownerFinalAcceptance !== true) reasons.push('OWNER_FINAL_ACCEPTANCE_MISSING');
  return Object.freeze({ canPublish: reasons.length === 0, blockerCount: reasons.length, blockers: reasons });
}

// Example: node check-full-parity.mjs D:/TigerIQ/Evidence/ultracar-v2-acceptance.json
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let candidate = null;
  const path = process.argv[2];
  if (path) {
    try { candidate = JSON.parse(readFileSync(path, 'utf8')); }
    catch { candidate = null; }
  }
  const outcome = assessFullParityRelease(candidate);
  process.stdout.write(JSON.stringify(outcome) + '\n');
  if (!outcome.canPublish) process.exitCode = 2;
}
