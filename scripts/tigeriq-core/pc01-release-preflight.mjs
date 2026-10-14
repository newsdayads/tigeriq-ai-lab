/**
 * Source-only PC01 release preflight. Not a release authorization service.
 * The caller must independently verify authenticated Owner approval,
 * exact-head GitHub checks, resource lease, and artifact provenance.
 * This module never installs, changes permissions, or executes PC01 actions.
 */
const SHA1 = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const COMPONENTS = new Set(['core', 'openclaw', 'pc_operator', 'updater']);
const BLOCKED_SCOPES = new Set([
  'app_chrome', 'android', 'vercel_production', 'windows_os',
  'credential', 'security_permission', 'paid', 'destructive',
]);

function denied(reason) {
  return Object.freeze({ eligible: false, reason });
}

/**
 * Returns readiness for a *separate trusted release authorization* step.
 * eligible=true does not authorize installation by itself.
 */
export function assessPc01ReleasePreflight({ request, observed, verifiedEvidence }) {
  if (!request || typeof request !== 'object') return denied('REQUEST_MISSING');
  if (request.schema !== 'TIGERIQ_PC01_RELEASE_CANDIDATE_V1') return denied('SCHEMA_INVALID');
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{3,119}$/.test(request.requestId ?? '')) return denied('REQUEST_ID_INVALID');
  if (!SHA1.test(request.targetSha ?? '')) return denied('TARGET_SHA_INVALID');
  if (!SHA1.test(request.expectedInstalledSha ?? '')) return denied('EXPECTED_INSTALLED_SHA_INVALID');
  if (!SHA1.test(request.rollbackSha ?? '')) return denied('ROLLBACK_SHA_INVALID');
  if (!request.artifact || !SHA256.test(request.artifact.sha256 ?? '')) return denied('ARTIFACT_SHA256_INVALID');
  if (!Array.isArray(request.components) || request.components.length === 0) return denied('COMPONENTS_MISSING');
  if (request.components.length !== new Set(request.components).size) return denied('DUPLICATE_COMPONENTS');
  if (request.components.some(component => !COMPONENTS.has(component))) return denied('COMPONENT_OUT_OF_SCOPE');
  if (!Array.isArray(request.resourceScopes) || request.resourceScopes.length === 0) return denied('RESOURCE_SCOPE_MISSING');
  if (request.resourceScopes.some(scope => BLOCKED_SCOPES.has(scope))) return denied('FORBIDDEN_SCOPE');
  if (request.allowRdc || request.allowShell || request.allowCodex || request.allowCredentialChange || request.allowSecurityChange || request.allowDestructiveAction || request.allowPaidService) return denied('BOUNDARY_EXPANSION_FORBIDDEN');
  if (!observed || !verifiedEvidence) return denied('LIVE_EVIDENCE_MISSING');
  if (observed.installedSha !== request.expectedInstalledSha) return denied('INSTALLED_SHA_CHANGED');
  if (observed.resourceScopeBusy || observed.concurrentWriter) return denied('RESOURCE_ALREADY_OWNED');
  if (!observed.pc01Online) return denied('PC01_OFFLINE');
  if (verifiedEvidence.sourceSha !== request.targetSha) return denied('SOURCE_HEAD_MISMATCH');
  if (verifiedEvidence.artifactSha256 !== request.artifact.sha256) return denied('ARTIFACT_HASH_MISMATCH');
  if (!verifiedEvidence.exactHeadCi || !verifiedEvidence.qualityGate || !verifiedEvidence.rollbackKnownGood) return denied('TECHNICAL_GATE_INCOMPLETE');
  if (!verifiedEvidence.authoritativeWorkOrder || !verifiedEvidence.validSourceProvenance) return denied('AUTHORITY_UNVERIFIED');
  return Object.freeze({
    eligible: true,
    reason: 'READY_FOR_SEPARATE_RELEASE_AUTHORIZATION',
    targetSha: request.targetSha,
    expectedInstalledSha: request.expectedInstalledSha,
    components: Object.freeze([...request.components]),
    requestId: request.requestId,
  });
}
