import assert from 'node:assert/strict';
import { normalizeInstruction, workFingerprint, issueStage } from '../api/control.mjs';

assert.equal(normalizeInstruction('  Kiểm tra   PC01\nngay  '), 'kiểm tra pc01 ngay');
assert.equal(workFingerprint('Kiểm tra PC01'), workFingerprint('  kiểm tra   pc01  '));
assert.notEqual(workFingerprint('Kiểm tra PC01'), workFingerprint('Kiểm tra Vercel'));
assert.equal(workFingerprint('Kiểm tra PC01').length, 24);

assert.equal(issueStage({ state: 'open' }, []), 'queued');
assert.equal(issueStage({ state: 'open' }, [{ body: 'TIGERIQ_JOB_CLAIMED' }]), 'claimed');
assert.equal(issueStage({ state: 'open' }, [{ body: 'TIGERIQ_JOB_RESULT PASS' }]), 'completed');
assert.equal(issueStage({ state: 'closed' }, []), 'completed');
assert.equal(issueStage({ state: 'open' }, [{ body: 'TIGERIQ_JOB_FAILED reason' }]), 'failed');

console.log('WO014_QUEUE_HYGIENE_PASS');
