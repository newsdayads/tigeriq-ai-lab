import assert from 'node:assert/strict';
import { normalizeInstruction, workFingerprint, issueStage, issueEvidenceSummary } from '../api/control.mjs';

assert.equal(normalizeInstruction('  Kiểm tra   PC01\nngay  '), 'kiểm tra pc01 ngay');
assert.equal(workFingerprint('Kiểm tra PC01'), workFingerprint('  kiểm tra   pc01  '));
assert.notEqual(workFingerprint('Kiểm tra PC01'), workFingerprint('Kiểm tra Vercel'));
assert.equal(workFingerprint('Kiểm tra PC01').length, 24);

assert.equal(issueStage({ state: 'open' }, []), 'queued');
assert.equal(issueStage({ state: 'open' }, [{ body: 'TIGERIQ_JOB_CLAIMED' }]), 'claimed');
assert.equal(issueStage({ state: 'open' }, [{ body: 'TIGERIQ_JOB_RESULT PASS' }]), 'completed');
assert.equal(issueStage({ state: 'closed' }, []), 'completed');
assert.equal(issueStage({ state: 'closed', state_reason: 'not_planned' }, []), 'cancelled');
assert.equal(issueStage({ state: 'closed', state_reason: 'duplicate' }, []), 'cancelled');
assert.equal(issueStage({ state: 'open' }, [{ body: 'TIGERIQ_JOB_FAILED reason' }]), 'failed');
assert.deepEqual(issueEvidenceSummary([{ body: 'TIGERIQ_JOB_CLAIMED\nREVIEW_PASS' }, { body: 'TIGERIQ_JOB_RESULT PASS\nJUDGE_PASS' }]), { claimed: true, result: true, failed: false, reviewPass: true, judgePass: true });

console.log('WO014_QUEUE_HYGIENE_PASS');
