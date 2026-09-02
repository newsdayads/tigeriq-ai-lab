import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const schema = JSON.parse(readFileSync('schemas/autonomous-handoff-v1.schema.json', 'utf8')) as Record<string, any>;
const policy = readFileSync('docs/architecture/TIGERIQ_AUTONOMOUS_HANDOFF_LOOP_V1.md', 'utf8');
const workflow = readFileSync('docs/company/02_TIGERIQ_WORKFLOW_v1.md', 'utf8');

function matchesType(value: unknown, type: string): boolean {
  if (type === 'object') return typeof value === 'object' && value !== null && !Array.isArray(value);
  if (type === 'array') return Array.isArray(value);
  if (type === 'string') return typeof value === 'string';
  if (type === 'boolean') return typeof value === 'boolean';
  if (type === 'integer') return typeof value === 'number' && Number.isInteger(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  return true;
}

function validatesJsonSchema(value: any, node: any): boolean {
  if (node === true || node == null) return true;
  if (node === false) return false;

  if (node.type && !matchesType(value, node.type)) return false;
  if (Object.prototype.hasOwnProperty.call(node, 'const') && value !== node.const) return false;
  if (node.enum && !node.enum.some((candidate: any) => candidate === value)) return false;

  if (typeof value === 'string') {
    if (node.minLength != null && value.length < node.minLength) return false;
    if (node.maxLength != null && value.length > node.maxLength) return false;
    if (node.pattern && !(new RegExp(node.pattern).test(value))) return false;
  }

  if (Array.isArray(value)) {
    if (node.minItems != null && value.length < node.minItems) return false;
    if (node.maxItems != null && value.length > node.maxItems) return false;
    if (node.uniqueItems) {
      const encoded = value.map((item) => JSON.stringify(item));
      if (new Set(encoded).size !== encoded.length) return false;
    }
    if (node.items && value.some((item) => !validatesJsonSchema(item, node.items))) return false;
  }

  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    if (node.required && node.required.some((key: string) => !Object.prototype.hasOwnProperty.call(value, key))) return false;
    if (node.properties) {
      for (const [key, childSchema] of Object.entries(node.properties)) {
        if (Object.prototype.hasOwnProperty.call(value, key) && !validatesJsonSchema(value[key], childSchema)) return false;
      }
      if (node.additionalProperties === false) {
        const allowed = new Set(Object.keys(node.properties));
        if (Object.keys(value).some((key) => !allowed.has(key))) return false;
      }
    }
  }

  if (node.not && validatesJsonSchema(value, node.not)) return false;
  if (node.allOf && !node.allOf.every((child: any) => validatesJsonSchema(value, child))) return false;
  if (node.anyOf && !node.anyOf.some((child: any) => validatesJsonSchema(value, child))) return false;
  if (node.oneOf && node.oneOf.filter((child: any) => validatesJsonSchema(value, child)).length !== 1) return false;
  if (node.if && validatesJsonSchema(value, node.if)) {
    if (node.then && !validatesJsonSchema(value, node.then)) return false;
  } else if (node.else && !validatesJsonSchema(value, node.else)) {
    return false;
  }

  return true;
}

function makeHandoff() {
  return {
    contract_version: 'TIGERIQ_AUTONOMOUS_HANDOFF_V1',
    handoff_id: 'HANDOFF-TEST-001',
    work_ref: 'ISSUE-TEST',
    from_role: 'NV04',
    to_role: 'NV05',
    accountable_executor: 'NV04',
    stage: 'HANDOFF_READY',
    risk_level: 'R1',
    gate_reason: 'Regression test',
    scope: 'Governance schema only',
    acceptance_criteria: ['Contract validates truthfully.'],
    exact_head_or_artifact_version: 'deadbeef',
    evidence_refs: ['CI-TEST'],
    evidence_set_hash: 'a'.repeat(64),
    review_fingerprint: 'fingerprint-test',
    requested_verdict: 'REVIEW_PASS_FAIL',
    constraints: [],
    next_state_on_pass: 'NEXT_STAGE',
    return_to_on_fail: 'NV04',
    review_required: false,
    owner_gate_required: false,
    owner_gate_status: 'NOT_REQUIRED',
  } as Record<string, any>;
}

describe('Autonomous Handoff R3 remediation', () => {
  it('represents reviewable and non-reviewable R4 truthfully', () => {
    const reviewable = makeHandoff();
    Object.assign(reviewable, {
      risk_level: 'R4',
      reviewability: 'REVIEWABLE',
      independent_review_hard_floor: false,
      review_required: true,
    });
    expect(validatesJsonSchema(reviewable, schema)).toBe(true);

    const reviewableButSkipped = { ...reviewable, review_required: false };
    expect(validatesJsonSchema(reviewableButSkipped, schema)).toBe(false);

    const nonReviewable = makeHandoff();
    Object.assign(nonReviewable, {
      risk_level: 'R4',
      reviewability: 'NOT_REVIEWABLE',
      non_reviewable_reason: 'Unavoidable physical observation cannot be independently reproduced.',
      independent_review_hard_floor: false,
      review_required: false,
    });
    expect(validatesJsonSchema(nonReviewable, schema)).toBe(true);
  });

  it('preserves Production/security/release independent-review hard floors', () => {
    const validHardFloor = makeHandoff();
    Object.assign(validHardFloor, {
      risk_level: 'R4',
      reviewability: 'REVIEWABLE',
      independent_review_hard_floor: true,
      independent_review_hard_floor_reason: 'PRODUCTION',
      review_required: true,
    });
    expect(validatesJsonSchema(validHardFloor, schema)).toBe(true);

    const bypassAttempt = makeHandoff();
    Object.assign(bypassAttempt, {
      risk_level: 'R4',
      reviewability: 'NOT_REVIEWABLE',
      non_reviewable_reason: 'Attempted bypass',
      independent_review_hard_floor: true,
      independent_review_hard_floor_reason: 'SECURITY',
      review_required: false,
    });
    expect(validatesJsonSchema(bypassAttempt, schema)).toBe(false);

    const missingReason = { ...validHardFloor };
    delete missingReason.independent_review_hard_floor_reason;
    expect(validatesJsonSchema(missingReason, schema)).toBe(false);
  });

  it('requires a bounded machine-readable EXTERNAL_WAIT resume contract', () => {
    const wait = makeHandoff();
    Object.assign(wait, {
      stage: 'EXTERNAL_WAIT',
      wait_reason: 'External quota reset required.',
      resume_condition: 'Quota is available again.',
      last_checked_at: '2026-09-03T05:00:00+07:00',
    });
    expect(validatesJsonSchema(wait, schema)).toBe(true);

    for (const field of ['wait_reason', 'resume_condition', 'last_checked_at']) {
      const invalid = { ...wait };
      delete invalid[field];
      expect(validatesJsonSchema(invalid, schema)).toBe(false);
    }
  });

  it('allows a pending Owner decision without fabricated approval evidence', () => {
    const pending = makeHandoff();
    Object.assign(pending, {
      stage: 'AWAITING_OWNER',
      requested_verdict: 'OWNER_DECISION',
      owner_gate_required: true,
      owner_gate_status: 'PENDING',
    });
    expect(validatesJsonSchema(pending, schema)).toBe(true);

    const fabricated = { ...pending, owner_approval_ref: 'NOT-YET-APPROVED' };
    expect(validatesJsonSchema(fabricated, schema)).toBe(false);
  });

  it('requires the exact immutable Owner approval ref before post-approval advancement', () => {
    const missingRef = makeHandoff();
    Object.assign(missingRef, {
      stage: 'NEXT_STAGE',
      owner_gate_required: true,
      owner_gate_status: 'APPROVED',
    });
    expect(validatesJsonSchema(missingRef, schema)).toBe(false);

    const approved = { ...missingRef, owner_approval_ref: 'OWNER-APPROVAL-EXACT-001' };
    expect(validatesJsonSchema(approved, schema)).toBe(true);
    expect(schema.properties.owner_approval_ref['x-tigeriq-immutable']).toBe(true);
  });

  it('keeps prose and schema aligned for all three remediated invariants', () => {
    expect(policy).toContain('R4 | Critical/Owner-reserved assurance | Yes when reviewable');
    expect(policy).toContain('`EXTERNAL_WAIT` must include `wait_reason`, `resume_condition`, and `last_checked_at`');
    expect(workflow).toContain('`reviewability` is explicit');
    expect(workflow).toContain('Production, security and release assurance are hard-floor reasons');
    expect(workflow).toContain('must not contain a fabricated `owner_approval_ref`');
    expect(workflow).toContain('`EXTERNAL_WAIT` is an explicit non-terminal state');
  });
});
