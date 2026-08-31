import assert from 'node:assert/strict';
import { normalizeInstruction, workFingerprint, issueStage, issueEvidenceSummary, issuePriority, issueType, workItemSummary, lifecycleEvents, latestLifecycleStage } from '../api/control.mjs';

const gate = (id, body, created_at) => ({ id, body, created_at, performed_via_github_app: { slug: 'chatgpt-codex-connector' } });
const ref = `sha256:${'a'.repeat(64)}`;
const otherRef = `sha256:${'b'.repeat(64)}`;

assert.equal(normalizeInstruction('  Kiểm tra   PC01\nngay  '), 'kiểm tra pc01 ngay');
assert.equal(workFingerprint('Kiểm tra PC01'), workFingerprint('  kiểm tra   pc01  '));
assert.notEqual(workFingerprint('Kiểm tra PC01'), workFingerprint('Kiểm tra Vercel'));
assert.equal(workFingerprint('Kiểm tra PC01').length, 24);

assert.equal(issueStage({ state: 'open' }, []), 'queued');
assert.equal(issueStage({ state: 'open' }, [{ body: 'TIGERIQ_JOB_CLAIMED' }]), 'claimed');
assert.equal(issueStage({ state: 'open' }, [{ body: `TIGERIQ_JOB_RESULT\nEVIDENCE_REF ${ref}` }]), 'review_pending');
assert.equal(issueStage({ state: 'open' }, [{ body: 'TIGERIQ_JOB_RESULT PASS' }]), 'evidence_pending');
assert.equal(issueStage({ state: 'closed' }, []), 'closed_unverified');
assert.equal(issueStage({ state: 'closed', state_reason: 'not_planned' }, []), 'cancelled');
assert.equal(issueStage({ state: 'closed', state_reason: 'duplicate' }, []), 'cancelled');
assert.equal(issueStage({ state: 'open' }, [{ body: 'TIGERIQ_JOB_FAILED reason' }]), 'failed');

const complete = [
  { id: 1, body: 'TIGERIQ_JOB_CLAIMED', created_at: '2026-08-30T10:00:00Z' },
  { id: 2, body: `TIGERIQ_JOB_RESULT\nEVIDENCE_REF ${ref}`, created_at: '2026-08-30T10:01:00Z' },
  gate(3, `REVIEW_PASS\nEVIDENCE_REF ${ref}`, '2026-08-30T10:02:00Z'),
  gate(4, `JUDGE_PASS\nEVIDENCE_REF ${ref}`, '2026-08-30T10:03:00Z'),
];
assert.equal(issueStage({ state: 'open' }, complete), 'completed');
assert.deepEqual(issueEvidenceSummary(complete), {
  claimed: true, result: true, resultEvidence: true, resultEvidenceRef: ref, failed: false,
  reviewPass: true, judgePass: true,
  trustedReviewApp: 'chatgpt-codex-connector', trustedJudgeApp: 'chatgpt-codex-connector',
  completionReady: true,
});

assert.equal(issueStage({ state: 'open' }, [{ body: 'TIGERIQ_JOB_RESULT\nREVIEW_PASS\nJUDGE_PASS' }]), 'evidence_pending');
assert.equal(issueStage({ state: 'open' }, [{ body: 'TIGERIQ_JOB_RESULT status=ok\nREVIEW_PASS\nJUDGE_PASS' }]), 'evidence_pending');
assert.equal(issueStage({ state: 'open' }, [
  { id: 11, body: `TIGERIQ_JOB_RESULT\nEVIDENCE_REF ${ref}`, created_at: '2026-08-30T10:00:00Z' },
  gate(12, `REVIEW_PASS\nEVIDENCE_REF ${ref}`, '2026-08-30T10:01:00Z'),
]), 'gate_pending');
assert.equal(issueStage({ state: 'closed' }, [{ body: `TIGERIQ_JOB_RESULT\nEVIDENCE_REF ${ref}\nREVIEW_PASS` }]), 'closed_unverified');
assert.equal(issueStage({ state: 'closed' }, complete), 'completed');

const mismatch = [
  { id: 13, body: `TIGERIQ_JOB_RESULT\nEVIDENCE_REF ${ref}`, created_at: '2026-08-30T10:00:00Z' },
  gate(14, `REVIEW_PASS\nEVIDENCE_REF ${otherRef}`, '2026-08-30T10:01:00Z'),
  gate(15, `JUDGE_PASS\nEVIDENCE_REF ${otherRef}`, '2026-08-30T10:02:00Z'),
];
assert.equal(issueStage({ state: 'open' }, mismatch), 'review_pending');
assert.equal(issueEvidenceSummary(mismatch).completionReady, false);

const untrustedSelfGate = [
  { id: 20, body: `TIGERIQ_JOB_RESULT\nEVIDENCE_REF ${ref}`, created_at: '2026-08-30T10:00:00Z' },
  { id: 21, body: `REVIEW_PASS\nEVIDENCE_REF ${ref}`, created_at: '2026-08-30T10:01:00Z' },
  { id: 22, body: `JUDGE_PASS\nEVIDENCE_REF ${ref}`, created_at: '2026-08-30T10:02:00Z' },
];
assert.equal(issueStage({ state: 'open' }, untrustedSelfGate), 'review_pending');
assert.equal(issueEvidenceSummary(untrustedSelfGate).reviewPass, false);
assert.equal(issueEvidenceSummary(untrustedSelfGate).judgePass, false);

const sameCommentSelfGate = [
  gate(30, `TIGERIQ_JOB_RESULT\nEVIDENCE_REF ${ref}\nREVIEW_PASS\nJUDGE_PASS`, '2026-08-30T10:00:00Z'),
];
assert.equal(issueStage({ state: 'open' }, sameCommentSelfGate), 'review_pending');

const retryComments = [
  { body: 'TIGERIQ_JOB_CLAIMED', created_at: '2026-08-30T10:00:00Z' },
  { body: 'TIGERIQ_JOB_FAILED reason', created_at: '2026-08-30T10:05:00Z' },
  { body: 'TIGERIQ_JOB_CLAIMED', created_at: '2026-08-30T10:10:00Z' },
];
assert.equal(issueStage({ state: 'open' }, retryComments), 'claimed');
assert.equal(latestLifecycleStage(retryComments), 'claimed');
assert.equal(issueEvidenceSummary(retryComments).failed, true);
assert.equal(issueEvidenceSummary(retryComments).claimed, true);

const recoveredComments = [
  { id: 40, body: 'TIGERIQ_JOB_FAILED reason', created_at: '2026-08-30T10:05:00Z' },
  { id: 41, body: `TIGERIQ_JOB_RESULT\nEVIDENCE_REF ${ref}`, created_at: '2026-08-30T10:15:00Z' },
  gate(42, `REVIEW_PASS\nEVIDENCE_REF ${ref}`, '2026-08-30T10:16:00Z'),
  gate(43, `JUDGE_PASS\nEVIDENCE_REF ${ref}`, '2026-08-30T10:17:00Z'),
];
assert.equal(issueStage({ state: 'open' }, recoveredComments), 'completed');

const reverseOrdered = [
  { body: 'TIGERIQ_JOB_CLAIMED', created_at: '2026-08-30T11:00:00Z' },
  { body: 'TIGERIQ_JOB_FAILED reason', created_at: '2026-08-30T10:00:00Z' },
];
assert.equal(issueStage({ state: 'open' }, reverseOrdered), 'claimed');
assert.equal(lifecycleEvents(reverseOrdered).at(-1).stage, 'claimed');

const proseOnly = [
  { body: 'Recovery note: previous TIGERIQ_JOB_FAILED marker was disproven.' },
  { body: '`TIGERIQ_JOB_CLAIMED` is the marker name, not a claim.' },
];
assert.equal(issueStage({ state: 'open' }, proseOnly), 'queued');
assert.deepEqual(issueEvidenceSummary(proseOnly), {
  claimed: false, result: false, resultEvidence: false, resultEvidenceRef: null, failed: false,
  reviewPass: false, judgePass: false, trustedReviewApp: null, trustedJudgeApp: null,
  completionReady: false,
});

assert.equal(issueStage({ state: 'closed', state_reason: 'not_planned' }, retryComments), 'cancelled');
assert.equal(issueStage({ state: 'closed' }, [{ body: 'TIGERIQ_JOB_FAILED reason' }]), 'failed');

const boardIssue = {
  number: 77,
  title: '[P0] [TigerIQ AI] Work Board sample',
  body: 'TIGERIQ_JOB_V1\n\n## Priority\nP0',
  state: 'open',
  state_reason: null,
  updated_at: '2026-08-30T12:00:00.000Z',
  html_url: 'https://github.com/newsdayads/tigeriq-ai-lab/issues/77',
};
assert.equal(issuePriority(boardIssue), 'P0');
assert.equal(issueType(boardIssue), 'work-order');
const boardSummary = workItemSummary(boardIssue, [{ body: 'TIGERIQ_JOB_CLAIMED\nREVIEW_PASS' }], Date.parse('2026-08-30T13:00:00.000Z'));
assert.equal(boardSummary.stage, 'claimed');
assert.equal(boardSummary.ageMinutes, 60);
assert.equal(boardSummary.stale, true);
assert.equal(boardSummary.evidence.reviewPass, false);
assert.equal(Object.hasOwn(boardSummary, 'body'), false);
assert.equal(Object.hasOwn(boardSummary, 'comments'), false);

console.log('WO014_QUEUE_HYGIENE_PASS');
