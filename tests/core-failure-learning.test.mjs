import test from 'node:test';
import assert from 'node:assert';
import { computeFailureSignature, generateFailureCandidate, deduplicateCandidates, governRegistryState } from '../apps/tigeriq-core/failure-learning.mjs';

test('computeFailureSignature computes consistent sha256 hash', () => {
  const failure1 = { errorCode: 'RATE_LIMIT', taskKind: 'manager', profile: 'AUTO' };
  const failure2 = { errorCode: 'rate_limit', taskKind: 'manager', profile: 'AUTO' };
  const sig1 = computeFailureSignature(failure1);
  const sig2 = computeFailureSignature(failure2);
  assert.strictEqual(sig1, sig2);
  assert.strictEqual(sig1.length, 64);
});

generateFailureCandidate
test('generateFailureCandidate creates structured candidate with provenance', () => {
  const failure = { errorCode: 'TIMEOUT', taskKind: 'coding', message: 'Request timed out' };
  const candidate = generateFailureCandidate(failure, { batchId: 'batch-999', sourceLog: 'logs/test.md' });
  assert.strictEqual(candidate.state, 'CANDIDATE');
  assert.strictEqual(candidate.provenance_batch, 'batch-999');
  assert.strictEqual(candidate.source_log, 'logs/test.md');
  assert.ok(candidate.error_signature);
  assert.ok(candidate.evidence);
});

test('deduplicateCandidates detects existing entries', () => {
  const existing = [{ id: 'failure-candidate-123', error_signature: 'abc123sig' }];
  const candidate = { id: 'failure-candidate-999', error_signature: 'abc123sig' };
  const result = deduplicateCandidates(existing, candidate);
  assert.strictEqual(result.isDuplicate, true);
  assert.deepStrictEqual(result.existing, existing[0]);
});

test('governRegistryState updates valid states correctly', () => {
  const registry = {
    states: ['CANDIDATE', 'VALIDATED', 'ACTIVE', 'DEPRECATED', 'REJECTED'],
    skills: [{ id: 'test-skill', state: 'CANDIDATE' }]
  };
  const res = governRegistryState(registry, 'test-skill', 'ACTIVE');
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.skill.state, 'ACTIVE');

  assert.throws(() => {
    governRegistryState(registry, 'test-skill', 'INVALID_STATE');
  }, /INVALID_REGISTRY_STATE/);
});
