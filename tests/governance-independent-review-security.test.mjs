import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { hasStructuredIndependentPass, isQualifyingIndependentReview } from '../scripts/verify-independent-review-gate.mjs';

const HEAD = '1234567890abcdef1234567890abcdef12345678';
const STALE = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const pull = { user: { login: 'builder-user' }, head: { sha: HEAD } };
const passBody = [
  'TIGERIQ_INDEPENDENT_REVIEW_PASS',
  'REVIEW_ROLE: 07',
  `Exact head: \`${HEAD}\``,
  `EVIDENCE_REF: commit:${HEAD}`,
].join('\n');

function review(overrides = {}) {
  return {
    state: 'APPROVED',
    commit_id: HEAD,
    user: { login: 'independent-reviewer' },
    body: passBody,
    ...overrides,
  };
}

describe('Governance independent review security policy', () => {
  it('accepts only a structured exact-head formal approval by a distinct actor', () => {
    expect(hasStructuredIndependentPass(passBody, HEAD)).toBe(true);
    expect(isQualifyingIndependentReview(review(), pull, HEAD)).toBe(true);
  });

  it('rejects self-review even when every textual marker is forged correctly', () => {
    expect(isQualifyingIndependentReview(review({ user: { login: 'BUILDER-USER' } }), pull, HEAD)).toBe(false);
  });

  it('rejects COMMENTED or otherwise non-approved review states', () => {
    expect(isQualifyingIndependentReview(review({ state: 'COMMENTED' }), pull, HEAD)).toBe(false);
    expect(isQualifyingIndependentReview(review({ state: 'DISMISSED' }), pull, HEAD)).toBe(false);
  });

  it('rejects approval bound to a stale commit', () => {
    expect(isQualifyingIndependentReview(review({ commit_id: STALE }), pull, HEAD)).toBe(false);
  });

  it('rejects missing typed evidence even from an independent approver', () => {
    const body = passBody.replace(`EVIDENCE_REF: commit:${HEAD}`, 'No evidence supplied');
    expect(hasStructuredIndependentPass(body, HEAD)).toBe(false);
    expect(isQualifyingIndependentReview(review({ body }), pull, HEAD)).toBe(false);
  });

  it('runs the gate from trusted base context and never checks out PR head code', () => {
    const workflow = readFileSync(new URL('../.github/workflows/governance-independent-review.yml', import.meta.url), 'utf8');
    expect(workflow).toContain('pull_request_target:');
    expect(workflow).not.toContain('pull_request_review:');
    expect(workflow).toContain('ref: ${{ github.event.pull_request.base.sha }}');
    expect(workflow).not.toContain('ref: ${{ github.event.pull_request.head.sha }}');
    expect(workflow).toContain('persist-credentials: false');
    expect(workflow).toContain('pull-requests: read');
    expect(workflow).not.toContain('issues: write');
    expect(workflow).not.toContain('contents: write');
  });
});
