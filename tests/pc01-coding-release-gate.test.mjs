import { it, expect } from 'vitest';
import {
  parsePc01OwnerApproval,
  impactForPc01ReleaseFiles,
  validatePc01ApprovalEvidence,
} from '../apps/tigeriq-core/pc01-release-approval.mjs';

// Source-only contract; never creates a live release ticket or touches PC01.
// The protected PowerShell release guard remains an independent required gate.
const installed = '1'.repeat(40);
const target = '2'.repeat(40);
const ownerComment = [
  'TIGERIQ_PC01_RELEASE_APPROVE_V1',
  'TARGET_SHA=' + target,
  'EXPECTED_INSTALLED_SHA=' + installed,
  'COMPONENTS=coding',
].join('\n');
const files = [
  { filename: 'apps/tigeriq-coding-lane/coding-lane.mjs' },
  { filename: 'tests/coding-lane-foundation.test.mjs' },
];
function fixture() {
  const at = '2026-10-13T04:00:00.000Z';
  const comment = { id: 123456789, user: { login: 'newsdayads' },
    issue_url: 'https://api.github.com/repos/newsdayads/tigeriq-ai-lab/issues/4725',
    body: ownerComment, created_at: at, updated_at: at };
  const identity = { actor: 'newsdayads', runId: '38340000001',
    claims: { actor: 'newsdayads', event_name: 'issue_comment', run_attempt: '1' } };
  const payload = { action: 'created',
    repository: { full_name: 'newsdayads/tigeriq-ai-lab' },
    issue: { number: 4725 }, sender: { login: 'newsdayads' },
    comment: { id: comment.id, user: { login: 'newsdayads' }, body: ownerComment } };
  const compare = { status: 'ahead', behind_by: 0, ahead_by: 1, total_commits: 1, files };
  return { identity, eventName: 'issue_comment', payload,
    verifiedComment: comment, installedSha: installed,
    mainSha: target, compare, nowMs: Date.parse(at) + 1000 };
}
it('authoritative exact Coding Lane source maps only to coding component', () => {
  expect(impactForPc01ReleaseFiles(files)).toEqual(['coding']);
  expect(impactForPc01ReleaseFiles([
    { filename: 'apps/tigeriq-coding-lane/coding-lane.mjs' },
    { filename: 'apps/tigeriq-core/pc01-release-approval.mjs' },
  ])).toEqual(['coding', 'core']);
});
it('Owner approval component is explicitly coding and requires exact SHA', () => {
  expect(parsePc01OwnerApproval(ownerComment)).toEqual({
    targetSha: target, expectedInstalledSha: installed, components: ['coding'],
  });
  expect(() => parsePc01OwnerApproval(ownerComment.replace('COMPONENTS=coding','COMPONENTS=browser'))).toThrow('COMPONENTS_INVALID');
});
it('signed evidence contract accepts only genuine Owner GitHub comment metadata for coding', () => {
  const result = validatePc01ApprovalEvidence(fixture());
  expect(result.components).toEqual(['coding']);
  expect(result.targetSha).toBe(target);
  expect(result.expectedInstalledSha).toBe(installed);
  expect(result.requestId).toContain('GH-38340000001-123456789');
});
it('denies any impersonation or edited Owner comment', () => {
  const altered = fixture(); altered.identity.actor = 'other-user';
  expect(() => validatePc01ApprovalEvidence(altered)).toThrow('OWNER_OIDC_REQUIRED');
  const edited = fixture(); edited.verifiedComment.updated_at = '2026-10-13T04:00:01.000Z';
  expect(() => validatePc01ApprovalEvidence(edited)).toThrow('OWNER_COMMENT_SOURCE_INVALID');
});
it('rejects Coding Lane ticket when changed files include forbidden surfaces', () => {
  const bad = fixture(); bad.compare.files.push({ filename: 'apps/chrome-controller/local.mjs' });
  expect(() => validatePc01ApprovalEvidence(bad)).toThrow('FILE_OUT_OF_SCOPE');
  const wrong = fixture(); wrong.compare.files.push({ filename: 'apps/tigeriq-core/core.mjs' });
  expect(() => validatePc01ApprovalEvidence(wrong)).toThrow('IMPACT_MISMATCH');
});
it('denies unsupported or test-only release without an executable component', () => {
  expect(() => impactForPc01ReleaseFiles([{ filename: 'tests/coding-lane-foundation.test.mjs' }]))
    .toThrow('NO_COMPONENT_IMPACT');
  expect(() => impactForPc01ReleaseFiles([{ filename: 'apps/tigeriq-coding-lane/secrets/private.mjs' }]))
    .toThrow('FILE_OUT_OF_SCOPE');
  expect(() => impactForPc01ReleaseFiles([{ filename: 'apps/tigeriq-core/web-control-index.mjs' }]))
    .toThrow('FILE_OUT_OF_SCOPE');
});
