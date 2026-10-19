/**
 * DeXCam P01 — classify redacted REA Windows native failures, without executing
 * REA, reading device paths, changing DACLs, or accepting Android milestones.
 *
 * Source basis: morluto/rea native/windows/src/filesystem.cc verifyPrivate()
 * blob f8b88aabc164e51f65480f7a8ed79becf582b3ee (researched 2026-10-19).
 * This is not an attestation of the installed REA binary on PC01.
 */
const allowed = new Set(['errorText', 'reaVersion', 'processContext', 'observedAceCount']);
const contexts = new Set(['UNKNOWN', 'LOCAL_SYSTEM', 'INTERACTIVE_USER']);
const daclSignature = 'Private DACL contains unexpected trustees';
const deletionSignature = 'Delete owned object by handle failed';

const base = {
  p01Accepted: false,
  androidApkInspected: false,
  requiresPc01Authorization: true,
  safeToRetryUnchanged: false,
};

export function triageReaDacl(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).some(k => !allowed.has(k)) ||
      typeof input.errorText !== 'string' || input.errorText.length < 6 ||
      input.errorText.length > 4096 ||
      (input.reaVersion !== undefined && (typeof input.reaVersion !== 'string' ||
        !/^[0-9]+[.][0-9]+[.][0-9]+$/.test(input.reaVersion))) ||
      (input.processContext !== undefined && !contexts.has(input.processContext)) ||
      (input.observedAceCount !== undefined && input.observedAceCount !== null &&
        (!Number.isInteger(input.observedAceCount) || input.observedAceCount < 0 ||
          input.observedAceCount > 1024))) {
    return { ...base, status: 'INVALID_INPUT', failureClass: 'UNVERIFIED',
      next: 'REDACT_AND_VALIDATE_METADATA' };
  }

  const error = input.errorText;
  const hasDacl = error.includes(daclSignature);
  const hasDeletion = error.includes(deletionSignature);
  if (hasDacl && hasDeletion) {
    return { ...base, status: 'AMBIGUOUS_MULTIPLE_FAILURES',
      failureClass: 'UNVERIFIED', next: 'SPLIT_INDIVIDUAL_RUN_RECEIPTS' };
  }
  if (hasDacl) {
    // In upstream main, this string is emitted at the strict AceCount != 2
    // guard. A caller-supplied ACE count is not independently authenticated.
    if (input.observedAceCount === 2) {
      return { ...base, status: 'CONTRADICTORY_OBSERVATIONS',
        failureClass: 'DACL_ACE_COUNT_GUARD', next: 'CHECK_ARTIFACT_PROVENANCE_AND_OBSERVATION_CONTEXT' };
    }
    return { ...base, status: 'BLOCKED_NATIVE_DACL',
      failureClass: 'DACL_ACE_COUNT_GUARD',
      systemSidOverlapHypothesis: input.processContext === 'LOCAL_SYSTEM'
        ? 'POSSIBLE_NOT_CONFIRMED' : 'NOT_ASSESSED',
      next: 'MATCH_INSTALLED_ADDON_TO_UPSTREAM_THEN_AUTHORIZE_READ_ONLY_ACE_READBACK' };
  }
  if (hasDeletion) {
    return { ...base, status: 'BLOCKED_NATIVE_CLEANUP',
      failureClass: 'HANDLE_DELETE_SHARE_FAILURE',
      next: 'CHECK_INSTALLED_VERSION_AND_SEPARATE_VENDOR_FIX_EVIDENCE' };
  }
  return { ...base, status: 'UNCLASSIFIED',
    failureClass: 'UNVERIFIED', next: 'REVIEW_REDACTED_VENDOR_FAILURE_CODE' };
}
