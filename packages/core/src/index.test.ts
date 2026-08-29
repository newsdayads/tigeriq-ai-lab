import { describe, expect, it } from 'vitest';
import { canVerify, type GateDecision } from './index.js';

const decision: GateDecision = {
  gateId: 'gate-1', status: 'PASSED', evaluatedBy: 'gate-agent', evaluatedAt: '2026-08-29T00:00:00Z',
  evidence: [{ id: 'ev-1', kind: 'test-report', uri: 'ci://run/1', collectedAt: '2026-08-29T00:00:00Z' }],
};

describe('canVerify', () => {
  it('requires independent evidence', () => expect(canVerify(decision, 'coding-agent')).toBe(true));
  it('rejects self-approval', () => expect(canVerify({ ...decision, evaluatedBy: 'coding-agent' }, 'coding-agent')).toBe(false));
  it('rejects evidence-free approval', () => expect(canVerify({ ...decision, evidence: [] }, 'coding-agent')).toBe(false));
});
