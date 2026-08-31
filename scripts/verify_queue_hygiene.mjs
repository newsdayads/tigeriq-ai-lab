import assert from 'node:assert/strict';
import { normalizeInstruction, workFingerprint, issueStage, issueEvidenceSummary, issuePriority, issueType, workItemSummary, lifecycleEvents, latestLifecycleStage } from '../api/control.mjs';

assert.equal(normalizeInstruction('  Kiểm tra   PC01\nngay  '), 'kiểm tra pc01 ngay');
assert.equal(workFingerprint('Kiểm tra PC01'), workFingerprint('  kiểm tra   pc01  '));
assert.notEqual(workFingerprint('Kiểm tra PC01'), workFingerprint('Kiểm tra Vercel'));
assert.equal(workFingerprint('Kiểm tra PC01').length, 24);

assert.equal(issueStage({ state: 'open' }, []), 'queued');
assert.equal(issueStage({ state: 'open' }, [{ body: 'TIGERIQ_JOB_CLAIMED' }]), 'claimed');
assert.equal(issueStage({ state: 'open' }, [{ body: 'TIGERIQ_JOB_RESULT PASS' }]), 'review_pending');
assert.equal(issueStage({ state: 'closed' }, []), 'closed_unverified');
assert.equal(issueStage({ state: 'closed', state_reason: 'not_planned' }, []), 'cancelled');
assert.equal(issueStage({ state: 'closed', state_reason: 'duplicate' }, []), 'cancelled');
assert.equal(issueStage({ state: 'open' }, [{ body: 'TIGERIQ_JOB_FAILED reason' }]), 'failed');

const complete = [{ body: 'TIGERIQ_JOB_CLAIMED' }, { body: 'TIGERIQ_JOB_RESULT\nstatus=ok\nREVIEW_PASS\nJUDGE_PASS' }];
assert.equal(issueStage({ state: 'open' }, complete), 'completed');
assert.deepEqual(issueEvidenceSummary(complete), {
  claimed: true, result: true, resultEvidence: true, failed: false,
  reviewPass: true, judgePass: true, completionReady: true,
});

assert.equal(issueStage({ state: 'open' }, [{ body: 'TIGERIQ_JOB_RESULT\nREVIEW_PASS\nJUDGE_PASS' }]), 'evidence_pending');
assert.equal(issueStage({ state: 'open' }, [{ body: 'TIGERIQ_JOB_RESULT status=ok\nREVIEW_PASS' }]), 'gate_pending');
assert.equal(issueStage({ state: 'closed' }, [{ body: 'TIGERIQ_JOB_RESULT status=ok\nREVIEW_PASS' }]), 'closed_unverified');
assert.equal(issueStage({ state: 'closed' }, complete), 'completed');

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
  { body: 'TIGERIQ_JOB_FAILED reason', created_at: '2026-08-30T10:05:00Z' },
  { body: 'TIGERIQ_JOB_RESULT status=ok\nREVIEW_PASS\nJUDGE_PASS', created_at: '2026-08-30T10:15:00Z' },
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
  claimed: false, result: false, resultEvidence: false, failed: false,
  reviewPass: false, judgePass: false, completionReady: false,
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
