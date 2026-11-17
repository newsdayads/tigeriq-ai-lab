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
  if (c.v1Baseline?.sha256 !== 'D8B8DE0A454ACB88E911AD11331EFF91884714466EF8B4554807D8D3447F82FC') {
    reasons.push('CURRENT_V1_1231_APK_SHA_NOT_PINNED');
  }
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
