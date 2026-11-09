import { describe, expect, it } from 'vitest';
// @ts-expect-error TigerIQ Core runtime module is JavaScript and intentionally has no TypeScript declaration file.
import { evaluateSpecIntegrity } from '../apps/tigeriq-core/spec-integrity-gate.mjs';

const VALID_SHA = 'a'.repeat(40);
const VALID_URL = 'https://github.com/newsdayads/tigeriq-ai-lab/actions/runs/123';

describe('GH-5606 M07 duplicate requirement ID traceability regression', () => {
  it('fails closed when two distinct requirements reuse the same ID', () => {
    const result = evaluateSpecIntegrity({
      spec: {
        requirements: [
          { id: 'FR-DUP', text: 'First independent requirement' },
          { id: 'FR-DUP', text: 'Second independent requirement' },
        ],
      },
      plan: {
        tasks: [{ id: 'T-DUP', requirements: ['FR-DUP'] }],
      },
      receipts: [
        {
          requirement_id: 'FR-DUP',
          proof_url: VALID_URL,
          head_sha: VALID_SHA,
          status: 'completed',
          conclusion: 'success',
        },
      ],
      sourceHeadSha: VALID_SHA,
    });

    expect(result.pass).toBe(false);
    expect(result.status).toBe('BLOCKED');
    expect(result.code).toBe('SPEC_REQUIREMENT_IDS_DUPLICATED');
    expect(result.reasons).toEqual(['DUPLICATE_REQUIREMENT_ID:FR-DUP']);
  });
});
