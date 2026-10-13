import test from 'node:test';
import assert from 'node:assert/strict';
import { assessPc01ReleasePreflight } from '../scripts/tigeriq-core/pc01-release-preflight.mjs';

const sha1 = 'a'.repeat(40);
const previous = 'b'.repeat(40);
const artifact = 'c'.repeat(64);
function inputs() {
  return {
    request: {
      schema: 'TIGERIQ_PC01_RELEASE_CANDIDATE_V1',
      requestId: 'PC01-PILOT-0001',
      targetSha: sha1,
      expectedInstalledSha: previous,
      rollbackSha: previous,
      artifact: { sha256: artifact },
      components: ['core', 'openclaw', 'pc_operator', 'updater'],
      resourceScopes: ['TIGERIQ_PC01_GATED_RELEASE_NO_RDC_PHASE1'],
      allowRdc: false, allowShell: false, allowCodex: false,
    },
    observed: { installedSha: previous, resourceScopeBusy: false, concurrentWriter: false, pc01Online: true },
    verifiedEvidence: {
      sourceSha: sha1, artifactSha256: artifact,
      exactHeadCi: true, qualityGate: true, rollbackKnownGood: true,
      authoritativeWorkOrder: true, validSourceProvenance: true,
    },
  };
}
function check(change, expected) {
  const x = inputs(); change(x);
  const result = assessPc01ReleasePreflight(x);
  assert.equal(result.eligible, false);
  assert.equal(result.reason, expected);
}

test('passes only the source preflight and never claims installation authorization', () => {
  const r = assessPc01ReleasePreflight(inputs());
  assert.equal(r.eligible, true);
  assert.equal(r.reason, 'READY_FOR_SEPARATE_RELEASE_AUTHORIZATION');
  assert.equal('authorized' in r, false);
  assert.equal('installed' in r, false);
});
test('rejects missing release candidate', () => check(x => { x.request = null; }, 'REQUEST_MISSING'));
test('rejects unpinned target SHA', () => check(x => { x.request.targetSha = 'main'; }, 'TARGET_SHA_INVALID'));
test('rejects App Chrome and cross-project component', () => check(x => { x.request.components.push('app_chrome'); }, 'COMPONENT_OUT_OF_SCOPE'));
test('rejects duplicate release components', () => check(x => { x.request.components.push('core'); }, 'DUPLICATE_COMPONENTS'));
test('rejects forbidden resource scope', () => check(x => { x.request.resourceScopes.push('security_permission'); }, 'FORBIDDEN_SCOPE'));
test('rejects remote shell or credential escalation', () => check(x => { x.request.allowShell = true; }, 'BOUNDARY_EXPANSION_FORBIDDEN'));
test('rejects concurrent writer', () => check(x => { x.observed.concurrentWriter = true; }, 'RESOURCE_ALREADY_OWNED'));
test('rejects PC01 offline', () => check(x => { x.observed.pc01Online = false; }, 'PC01_OFFLINE'));
test('rejects stale installed state', () => check(x => { x.observed.installedSha = sha1; }, 'INSTALLED_SHA_CHANGED'));
test('rejects mismatched source head', () => check(x => { x.verifiedEvidence.sourceSha = previous; }, 'SOURCE_HEAD_MISMATCH'));
test('rejects wrong artifact digest', () => check(x => { x.verifiedEvidence.artifactSha256 = 'd'.repeat(64); }, 'ARTIFACT_HASH_MISMATCH'));
test('rejects CI without rollback proof', () => check(x => { x.verifiedEvidence.rollbackKnownGood = false; }, 'TECHNICAL_GATE_INCOMPLETE'));
test('rejects unattested work order', () => check(x => { x.verifiedEvidence.authoritativeWorkOrder = false; }, 'AUTHORITY_UNVERIFIED'));
test('rejects absent observations', () => check(x => { x.observed = null; }, 'LIVE_EVIDENCE_MISSING'));
