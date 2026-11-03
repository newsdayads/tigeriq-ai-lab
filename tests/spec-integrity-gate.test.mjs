import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SPEC_INTEGRITY_SCHEMA,
  SPEC_INTEGRITY_STATUS,
  validateSpecArtifacts,
  verifyTraceabilityMatrix,
  evaluateSpecIntegrity,
  assertSpecIntegrity
} from '../apps/tigeriq-core/spec-integrity-gate.mjs';

const VALID_SHA_A = 'a'.repeat(40);
const VALID_SHA_B = 'b'.repeat(40);
const VALID_URL = 'https://github.com/newsdayads/tigeriq-ai-lab/actions/runs/123';

test('1. API Contract: exports all required constants and functions', () => {
  assert.equal(SPEC_INTEGRITY_SCHEMA, 'TIGERIQ_SPEC_INTEGRITY_V1');
  assert.ok(SPEC_INTEGRITY_STATUS.ACCEPTED);
  assert.ok(SPEC_INTEGRITY_STATUS.BLOCKED);
  assert.ok(SPEC_INTEGRITY_STATUS.INCOMPLETE_ASSESSMENT);
  assert.equal(typeof validateSpecArtifacts, 'function');
  assert.equal(typeof verifyTraceabilityMatrix, 'function');
  assert.equal(typeof evaluateSpecIntegrity, 'function');
  assert.equal(typeof assertSpecIntegrity, 'function');
});

test('2. Robust null root input handling returns INCOMPLETE_ASSESSMENT without throw', () => {
  const res = evaluateSpecIntegrity(null);
  assert.equal(res.pass, false);
  assert.equal(res.status, 'INCOMPLETE_ASSESSMENT');
  assert.equal(res.code, 'INPUT_INVALID');
  assert.equal(res.checked, 0);
  assert.equal(res.total, 0);
});

test('3. Robust undefined root input handling', () => {
  const res = evaluateSpecIntegrity(undefined);
  assert.equal(res.pass, false);
  assert.equal(res.status, 'INCOMPLETE_ASSESSMENT');
});

test('4. Primitive root inputs (number, string, boolean)', () => {
  assert.equal(evaluateSpecIntegrity(123).status, 'INCOMPLETE_ASSESSMENT');
  assert.equal(evaluateSpecIntegrity('invalid').status, 'INCOMPLETE_ASSESSMENT');
  assert.equal(evaluateSpecIntegrity(true).status, 'INCOMPLETE_ASSESSMENT');
});

test('5. Array root input returns INPUT_INVALID', () => {
  const res = evaluateSpecIntegrity([]);
  assert.equal(res.pass, false);
  assert.equal(res.status, 'INCOMPLETE_ASSESSMENT');
  assert.equal(res.code, 'INPUT_INVALID');
});

test('6. Null or undefined options parameter does not crash', () => {
  const res = evaluateSpecIntegrity({}, null);
  assert.equal(res.pass, false);
  assert.equal(res.status, 'INCOMPLETE_ASSESSMENT');
});

test('7. Empty spec object returns SPEC_MISSING_REQUIREMENTS', () => {
  const res = evaluateSpecIntegrity({ spec: {} });
  assert.equal(res.pass, false);
  assert.equal(res.code, 'SPEC_MISSING_REQUIREMENTS');
});

test('8. Spec with unresolved questions (string array) returns UNRESOLVED_QUESTIONS_PRESENT', () => {
  const res = evaluateSpecIntegrity({
    spec: {
      requirements: ['FR-01: Login'],
      unresolved_questions: ['What timeout?']
    }
  });
  assert.equal(res.pass, false);
  assert.equal(res.code, 'UNRESOLVED_QUESTIONS_PRESENT');
  assert.equal(res.status, 'BLOCKED');
});

test('9. Spec with unresolved questions as object returns UNRESOLVED_QUESTIONS_PRESENT', () => {
  const res = evaluateSpecIntegrity({
    spec: {
      requirements: ['FR-01: Login'],
      unresolved_questions: { q1: 'pending question' }
    }
  });
  assert.equal(res.pass, false);
  assert.equal(res.code, 'UNRESOLVED_QUESTIONS_PRESENT');
});

test('10. Spec with unresolved questions as non-empty string returns UNRESOLVED_QUESTIONS_PRESENT', () => {
  const res = evaluateSpecIntegrity({
    spec: {
      requirements: ['FR-01: Login'],
      unresolved_questions: 'Need clarification from Owner'
    }
  });
  assert.equal(res.pass, false);
  assert.equal(res.code, 'UNRESOLVED_QUESTIONS_PRESENT');
});

test('11. Spec with unresolved questions containing object item returns UNRESOLVED_QUESTIONS_PRESENT', () => {
  const res = evaluateSpecIntegrity({
    spec: {
      requirements: ['FR-01: Login'],
      unresolved_questions: [{ id: 'Q1', text: 'TBD' }]
    }
  });
  assert.equal(res.pass, false);
  assert.equal(res.code, 'UNRESOLVED_QUESTIONS_PRESENT');
});

test('12. Spec with conflicts (array) returns SPEC_CONFLICTS_PRESENT', () => {
  const res = evaluateSpecIntegrity({
    spec: {
      requirements: ['FR-01: Login'],
      conflicts: ['Rule A conflicts with Rule B']
    }
  });
  assert.equal(res.pass, false);
  assert.equal(res.code, 'SPEC_CONFLICTS_PRESENT');
  assert.equal(res.status, 'BLOCKED');
});

test('13. Spec with conflicts (object) returns SPEC_CONFLICTS_PRESENT', () => {
  const res = evaluateSpecIntegrity({
    spec: {
      requirements: ['FR-01: Login'],
      conflicts: { c1: 'conflict' }
    }
  });
  assert.equal(res.pass, false);
  assert.equal(res.code, 'SPEC_CONFLICTS_PRESENT');
});

test('14. Spec with conflicts (string) returns SPEC_CONFLICTS_PRESENT', () => {
  const res = evaluateSpecIntegrity({
    spec: {
      requirements: ['FR-01: Login'],
      conflicts: 'Has conflicting requirements'
    }
  });
  assert.equal(res.pass, false);
  assert.equal(res.code, 'SPEC_CONFLICTS_PRESENT');
});

test('15. Acceptance placeholder "TBD" detected', () => {
  const res = evaluateSpecIntegrity({
    spec: {
      requirements: [{ id: 'FR-01', text: 'TBD performance' }]
    }
  });
  assert.equal(res.pass, false);
  assert.equal(res.code, 'ACCEPTANCE_PLACEHOLDER_DETECTED');
});

test('16. Acceptance placeholder "???" detected', () => {
  const res = evaluateSpecIntegrity({
    spec: {
      requirements: [{ id: 'FR-01', text: 'Auth flow ???' }]
    }
  });
  assert.equal(res.pass, false);
  assert.equal(res.code, 'ACCEPTANCE_PLACEHOLDER_DETECTED');
});

test('17. Acceptance placeholder "TODO" detected', () => {
  const res = evaluateSpecIntegrity({
    spec: {
      acceptance: ['TODO: write test plan']
    }
  });
  assert.equal(res.pass, false);
  assert.equal(res.code, 'ACCEPTANCE_PLACEHOLDER_DETECTED');
});

test('18. Acceptance placeholder "FIXME" detected', () => {
  const res = evaluateSpecIntegrity({
    spec: {
      acceptance: ['FIXME: needs review']
    }
  });
  assert.equal(res.pass, false);
  assert.equal(res.code, 'ACCEPTANCE_PLACEHOLDER_DETECTED');
});

test('19. require_plan=true option without plan fails with PLAN_REQUIRED_BUT_MISSING', () => {
  const res = evaluateSpecIntegrity(
    {
      spec: { requirements: [{ id: 'FR-01', text: 'Valid requirement' }] }
    },
    { require_plan: true }
  );
  assert.equal(res.pass, false);
  assert.equal(res.code, 'PLAN_REQUIRED_BUT_MISSING');
});

test('20. require_plan="true" string option without plan fails with PLAN_REQUIRED_BUT_MISSING (no fail-open)', () => {
  const res = evaluateSpecIntegrity(
    {
      spec: { requirements: [{ id: 'FR-01', text: 'Valid requirement' }] }
    },
    { require_plan: 'true' }
  );
  assert.equal(res.pass, false);
  assert.equal(res.code, 'PLAN_REQUIRED_BUT_MISSING');
});

test('21. require_plan="1" string option without plan fails with PLAN_REQUIRED_BUT_MISSING', () => {
  const res = evaluateSpecIntegrity(
    {
      spec: { requirements: [{ id: 'FR-01', text: 'Valid requirement' }] }
    },
    { require_plan: '1' }
  );
  assert.equal(res.pass, false);
  assert.equal(res.code, 'PLAN_REQUIRED_BUT_MISSING');
});

test('22. plan_decisions non-array format fails with PLAN_DECISIONS_INVALID_FORMAT', () => {
  const res = evaluateSpecIntegrity({
    spec: { requirements: [{ id: 'FR-01', text: 'Valid req' }] },
    plan: {
      tasks: [{ id: 'T001', requirements: ['FR-01'] }],
      plan_decisions: 'invalid_string_not_array'
    }
  });
  assert.equal(res.pass, false);
  assert.equal(res.code, 'PLAN_DECISIONS_INVALID_FORMAT');
});

test('23. plan_decisions object format fails with PLAN_DECISIONS_INVALID_FORMAT', () => {
  const res = evaluateSpecIntegrity({
    spec: { requirements: [{ id: 'FR-01', text: 'Valid req' }] },
    plan: {
      tasks: [{ id: 'T001', requirements: ['FR-01'] }],
      plan_decisions: { d1: 'decision' }
    }
  });
  assert.equal(res.pass, false);
  assert.equal(res.code, 'PLAN_DECISIONS_INVALID_FORMAT');
});

test('24. receipts non-array format fails with RECEIPTS_INVALID_FORMAT', () => {
  const res = evaluateSpecIntegrity({
    spec: { requirements: [{ id: 'FR-01', text: 'Valid req' }] },
    receipts: { r1: 'receipt' }
  });
  assert.equal(res.pass, false);
  assert.equal(res.code, 'RECEIPTS_INVALID_FORMAT');
});

test('25. receipts string format fails with RECEIPTS_INVALID_FORMAT', () => {
  const res = evaluateSpecIntegrity({
    spec: { requirements: [{ id: 'FR-01', text: 'Valid req' }] },
    receipts: 'receipt_string'
  });
  assert.equal(res.pass, false);
  assert.equal(res.code, 'RECEIPTS_INVALID_FORMAT');
});

test('26. Duplicate plan task IDs fails with PLAN_TASKS_DUPLICATED', () => {
  const res = evaluateSpecIntegrity({
    spec: { requirements: [{ id: 'FR-01', text: 'Valid req' }] },
    plan: {
      tasks: [
        { id: 'T001', requirements: ['FR-01'] },
        { id: 'T001', requirements: ['FR-01'] }
      ]
    }
  });
  assert.equal(res.pass, false);
  assert.equal(res.code, 'PLAN_TASKS_DUPLICATED');
  assert.equal(res.status, 'BLOCKED');
});

test('27. Plan task without ID fails with PLAN_TASK_INVALID', () => {
  const res = evaluateSpecIntegrity({
    spec: { requirements: [{ id: 'FR-01', text: 'Valid req' }] },
    plan: {
      tasks: [{ requirements: ['FR-01'] }]
    }
  });
  assert.equal(res.pass, false);
  assert.equal(res.code, 'PLAN_TASK_INVALID');
});

test('28. Unmapped requirements detected when plan tasks do not cover them', () => {
  const res = evaluateSpecIntegrity({
    spec: {
      requirements: [
        { id: 'FR-01', text: 'First req' },
        { id: 'FR-02', text: 'Second req' }
      ]
    },
    plan: {
      tasks: [{ id: 'T001', requirements: ['FR-01'] }]
    },
    receipts: [
      { requirement_id: 'FR-01', proof_url: VALID_URL, head_sha: VALID_SHA_A, status: 'completed', conclusion: 'success' },
      { requirement_id: 'FR-02', proof_url: VALID_URL, head_sha: VALID_SHA_A, status: 'completed', conclusion: 'success' }
    ],
    sourceHeadSha: VALID_SHA_A
  });
  assert.equal(res.pass, false);
  assert.ok(res.details.unmappedRequirements.includes('FR-02'));
});

test('29. Missing receipts for requirement returns MISSING_RECEIPTS', () => {
  const res = evaluateSpecIntegrity({
    spec: {
      requirements: [
        { id: 'FR-01', text: 'Req 1' },
        { id: 'FR-02', text: 'Req 2' }
      ]
    },
    receipts: [
      { requirement_id: 'FR-01', proof_url: VALID_URL, head_sha: VALID_SHA_A, status: 'completed', conclusion: 'success' }
    ],
    sourceHeadSha: VALID_SHA_A
  });
  assert.equal(res.pass, false);
  assert.ok(res.details.missingReceipts.includes('FR-02'));
  assert.equal(res.checked, 1);
  assert.equal(res.total, 2);
});

test('30. Stale receipt SHA (does not match sourceHeadSha) is detected', () => {
  const res = evaluateSpecIntegrity({
    spec: {
      requirements: [{ id: 'FR-01', text: 'Req 1' }]
    },
    receipts: [
      { requirement_id: 'FR-01', proof_url: VALID_URL, head_sha: VALID_SHA_B, status: 'completed', conclusion: 'success' }
    ],
    sourceHeadSha: VALID_SHA_A
  });
  assert.equal(res.pass, false);
  assert.equal(res.checked, 0);
  assert.equal(res.details.invalidReceipts[0].reason, 'STALE_SHA_DETECTED');
});

test('31. Malformed receipt SHA (not 40 hex chars) is rejected', () => {
  const res = evaluateSpecIntegrity({
    spec: {
      requirements: [{ id: 'FR-01', text: 'Req 1' }]
    },
    receipts: [
      { requirement_id: 'FR-01', proof_url: VALID_URL, head_sha: 'invalid-sha', status: 'completed', conclusion: 'success' }
    ],
    sourceHeadSha: VALID_SHA_A
  });
  assert.equal(res.pass, false);
  assert.equal(res.details.invalidReceipts[0].reason, 'SHA_INVALID');
});

test('32. Bare protocol "https://" proof_url is rejected', () => {
  const res = evaluateSpecIntegrity({
    spec: {
      requirements: [{ id: 'FR-01', text: 'Req 1' }]
    },
    receipts: [
      { requirement_id: 'FR-01', proof_url: 'https://', head_sha: VALID_SHA_A, status: 'completed', conclusion: 'success' }
    ],
    sourceHeadSha: VALID_SHA_A
  });
  assert.equal(res.pass, false);
  assert.equal(res.details.invalidReceipts[0].reason, 'PROOF_URL_INVALID');
});

test('33. Bare protocol "http://" proof_url is rejected', () => {
  const res = evaluateSpecIntegrity({
    spec: {
      requirements: [{ id: 'FR-01', text: 'Req 1' }]
    },
    receipts: [
      { requirement_id: 'FR-01', proof_url: 'http://', head_sha: VALID_SHA_A, status: 'completed', conclusion: 'success' }
    ],
    sourceHeadSha: VALID_SHA_A
  });
  assert.equal(res.pass, false);
  assert.equal(res.details.invalidReceipts[0].reason, 'PROOF_URL_INVALID');
});

test('34. Proof URL containing credentials is rejected', () => {
  const res = evaluateSpecIntegrity({
    spec: {
      requirements: [{ id: 'FR-01', text: 'Req 1' }]
    },
    receipts: [
      { requirement_id: 'FR-01', proof_url: 'https://user:password@github.com/run/1', head_sha: VALID_SHA_A, status: 'completed', conclusion: 'success' }
    ],
    sourceHeadSha: VALID_SHA_A
  });
  assert.equal(res.pass, false);
  assert.equal(res.details.invalidReceipts[0].reason, 'PROOF_URL_INVALID');
});

test('35. Invalid non-URL string as proof_url is rejected', () => {
  const res = evaluateSpecIntegrity({
    spec: {
      requirements: [{ id: 'FR-01', text: 'Req 1' }]
    },
    receipts: [
      { requirement_id: 'FR-01', proof_url: 'not-a-valid-url', head_sha: VALID_SHA_A, status: 'completed', conclusion: 'success' }
    ],
    sourceHeadSha: VALID_SHA_A
  });
  assert.equal(res.pass, false);
  assert.equal(res.details.invalidReceipts[0].reason, 'PROOF_URL_INVALID');
});

test('36. Non-success receipt conclusion (e.g. failure) is rejected', () => {
  const res = evaluateSpecIntegrity({
    spec: {
      requirements: [{ id: 'FR-01', text: 'Req 1' }]
    },
    receipts: [
      { requirement_id: 'FR-01', proof_url: VALID_URL, head_sha: VALID_SHA_A, status: 'completed', conclusion: 'failure' }
    ],
    sourceHeadSha: VALID_SHA_A
  });
  assert.equal(res.pass, false);
  assert.equal(res.details.invalidReceipts[0].reason, 'RECEIPT_NOT_SUCCESSFUL');
});

test('37. Non-completed receipt status is rejected', () => {
  const res = evaluateSpecIntegrity({
    spec: {
      requirements: [{ id: 'FR-01', text: 'Req 1' }]
    },
    receipts: [
      { requirement_id: 'FR-01', proof_url: VALID_URL, head_sha: VALID_SHA_A, status: 'in_progress', conclusion: 'success' }
    ],
    sourceHeadSha: VALID_SHA_A
  });
  assert.equal(res.pass, false);
  assert.equal(res.details.invalidReceipts[0].reason, 'RECEIPT_NOT_SUCCESSFUL');
});

test('38. Success Criteria (SC) items are tracked and require receipts', () => {
  const res = evaluateSpecIntegrity({
    spec: {
      sc: [{ id: 'SC-01', text: 'Latency < 200ms' }]
    },
    receipts: [
      { requirement_id: 'SC-01', proof_url: VALID_URL, head_sha: VALID_SHA_A, status: 'completed', conclusion: 'success' }
    ],
    sourceHeadSha: VALID_SHA_A
  });
  assert.equal(res.pass, true);
  assert.equal(res.status, 'ACCEPTED');
  assert.equal(res.checked, 1);
  assert.equal(res.total, 1);
});

test('39. Acceptance criteria items are tracked and require receipts', () => {
  const res = evaluateSpecIntegrity({
    spec: {
      acceptance: ['Clean startup with 0 errors']
    },
    receipts: [
      { requirement_id: 'AC-1', proof_url: VALID_URL, head_sha: VALID_SHA_A, status: 'completed', conclusion: 'success' }
    ],
    sourceHeadSha: VALID_SHA_A
  });
  assert.equal(res.pass, true);
  assert.equal(res.status, 'ACCEPTED');
  assert.equal(res.checked, 1);
  assert.equal(res.total, 1);
});

test('40. Positive end-to-end: valid spec, plan, receipts, matching SHA -> ACCEPTED', () => {
  const input = {
    spec: {
      requirements: [
        { id: 'FR-01', text: 'Validate spec artifacts' },
        { id: 'FR-02', text: 'Enforce fail-closed gate' }
      ]
    },
    plan: {
      tasks: [
        { id: 'T001', requirements: ['FR-01'] },
        { id: 'T002', requirements: ['FR-02'] }
      ],
      plan_decisions: ['Decision 1']
    },
    receipts: [
      { requirement_id: 'FR-01', proof_url: VALID_URL, head_sha: VALID_SHA_A, status: 'completed', conclusion: 'success' },
      { requirement_id: 'FR-02', proof_url: VALID_URL, head_sha: VALID_SHA_A, status: 'completed', conclusion: 'success' }
    ],
    sourceHeadSha: VALID_SHA_A
  };

  const res = evaluateSpecIntegrity(input, { require_plan: true });
  assert.equal(res.pass, true);
  assert.equal(res.status, 'ACCEPTED');
  assert.equal(res.code, 'SPEC_INTEGRITY_PASSED');
  assert.equal(res.checked, 2);
  assert.equal(res.total, 2);
  assert.equal(res.reasons.length, 0);
});

test('41. assertSpecIntegrity throws when evaluation fails', () => {
  assert.throws(
    () => assertSpecIntegrity({ spec: {} }),
    /SPEC_INTEGRITY_FAILED/
  );
});

test('42. assertSpecIntegrity returns result when evaluation passes', () => {
  const res = assertSpecIntegrity({
    spec: { requirements: [{ id: 'FR-01', text: 'Pass requirement' }] },
    receipts: [{ requirement_id: 'FR-01', proof_url: VALID_URL, head_sha: VALID_SHA_A, status: 'completed', conclusion: 'success' }],
    sourceHeadSha: VALID_SHA_A
  });
  assert.equal(res.pass, true);
  assert.equal(res.code, 'SPEC_INTEGRITY_PASSED');
});

test('43. Deterministic malformed inputs smoke (3,000 cases) -> zero unhandled exceptions', () => {
  const malformedValues = [
    null, undefined, 0, 1, -1, NaN, Infinity, '', ' ', 'true', 'false',
    {}, [], [null], { a: undefined }, () => {}, Symbol('test'),
    new Date(), /regex/, new Uint8Array([1, 2, 3])
  ];

  let tested = 0;
  for (let i = 0; i < 3000; i++) {
    const val = malformedValues[i % malformedValues.length];
    const val2 = malformedValues[(i * 3 + 1) % malformedValues.length];
    const val3 = malformedValues[(i * 7 + 2) % malformedValues.length];

    const input = {
      spec: val,
      plan: val2,
      receipts: val3,
      sourceHeadSha: val
    };

    const res = evaluateSpecIntegrity(input, { require_plan: val });
    assert.equal(typeof res, 'object');
    assert.equal(typeof res.pass, 'boolean');
    assert.ok(typeof res.status === 'string');
    tested++;
  }
  assert.equal(tested, 3000);
});
