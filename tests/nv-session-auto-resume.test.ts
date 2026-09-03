import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const policy = readFileSync('docs/governance/TIGERIQ_NV_SESSION_AUTO_RESUME_V1.md', 'utf8');
const schema = JSON.parse(readFileSync('schemas/nv-session-resume-v1.schema.json', 'utf8')) as Record<string, any>;

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
    if (node.pattern != null && !(new RegExp(node.pattern).test(value))) return false;
    if (node.format === 'date-time' && !Number.isFinite(Date.parse(value))) return false;
  }
  if (typeof value === 'number') {
    if (node.minimum != null && value < node.minimum) return false;
    if (node.maximum != null && value > node.maximum) return false;
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

function validatesResumeContract(value: any): boolean {
  if (!validatesJsonSchema(value, schema)) return false;
  if (value.result !== 'CONTINUE') return true;
  const guard = value.mutation_guard;
  if (!guard) return false;
  if (guard.snapshot_binding !== 'NV-RESUME-MUTATION-GUARD-BINDING-V1') return false;
  if (guard.expected_work_ref !== value.selected_work_ref) return false;
  if (guard.expected_work_state !== value.work_state) return false;
  const selectedVersion = value.exact_head_or_artifact_version;
  const guardedVersion = guard.expected_exact_head_or_artifact_version;
  return selectedVersion === undefined ? guardedVersion === undefined : guardedVersion === selectedVersion;
}

function makeContinue() {
  return {
    contract_version: 'TIGERIQ_NV_SESSION_RESUME_V1', employee_id: 'NV04', identity_registered: true,
    queue_audit_complete: true, result: 'CONTINUE', candidate_count: 1, selected_work_ref: 'Issue #165',
    work_state: 'ACTIVE', priority: 'P0', exact_head_or_artifact_version: '48329cfe4ba9759232637f3f97f8371f0d39df22',
    next_safe_action: 'Continue scoped governance implementation.', observed_at: '2026-09-03T00:30:00+07:00',
    source_refs: ['Issue #165', 'PR #166'], mutation_guard: { reread_before_mutation: true,
      snapshot_binding: 'NV-RESUME-MUTATION-GUARD-BINDING-V1', expected_work_ref: 'Issue #165',
      expected_work_state: 'ACTIVE', expected_exact_head_or_artifact_version: '48329cfe4ba9759232637f3f97f8371f0d39df22',
      duplicate_state_check: true }
  };
}

function makeWaiting() {
  return { contract_version: 'TIGERIQ_NV_SESSION_RESUME_V1', employee_id: 'NV06', identity_registered: true,
    queue_audit_complete: true, result: 'WAITING', candidate_count: 1, selected_work_ref: 'Issue #156',
    work_state: 'WAITING_PHYSICAL_GATE', wait_reason: 'Physical gate is not yet satisfied.',
    resume_condition: 'Resume when authoritative physical-gate evidence is present.', observed_at: '2026-09-03T00:30:00+07:00',
    source_refs: ['Issue #156'] };
}

describe('NV Session Auto-Resume V1 governance contract', () => {
  it('anchors fresh NV identity and immediate continuation', () => {
    expect(policy).toContain('NV 04` → `NV04');
    expect(policy).toContain('Mandatory restore audit');
    expect(policy).toContain('explicit current CHAT00 assignment precedence');
    expect(policy).toContain('P0` before `P1` before `P2');
    expect(policy).toContain('ĐANG TIẾP TỤC');
    expect(policy).toContain('NV_SESSION_AUTO_RESUME_READY');
  });

  it('keeps Autonomous Handoff canonical', () => {
    expect(policy).toContain('extends the Autonomous Handoff Loop');
    expect(policy).toContain('must not ask Sếp to return to NV00');
    expect(policy).toContain('Sếp does not relay normal AI-to-AI handoffs');
  });

  it('accepts a bound mutation guard', () => {
    expect(validatesResumeContract(makeContinue())).toBe(true);
    expect(schema['x-tigeriq-cross-field-invariants'][0].id).toBe('NV-RESUME-MUTATION-GUARD-BINDING-V1');
    expect(schema['x-tigeriq-cross-field-invariants'][1].id).toBe('NV-RESUME-MUTATION-AUTHORITY-SCOPE-V1');
  });

  it('rejects missing whole guard', () => {
    const candidate = makeContinue();
    delete (candidate as any).mutation_guard;
    expect(validatesResumeContract(candidate)).toBe(false);
  });

  it('rejects missing expected version for a versioned snapshot', () => {
    const candidate = makeContinue();
    delete (candidate as any).mutation_guard.expected_exact_head_or_artifact_version;
    expect(validatesJsonSchema(candidate, schema)).toBe(false);
    expect(validatesResumeContract(candidate)).toBe(false);
  });

  it('rejects work-ref mismatch', () => {
    const candidate = makeContinue();
    candidate.mutation_guard.expected_work_ref = 'Issue #999';
    expect(validatesResumeContract(candidate)).toBe(false);
  });

  it('rejects work-state mismatch', () => {
    const candidate = makeContinue();
    candidate.mutation_guard.expected_work_state = 'WAITING_REVIEW';
    expect(validatesResumeContract(candidate)).toBe(false);
  });

  it('rejects exact-version mismatch', () => {
    const candidate = makeContinue();
    candidate.mutation_guard.expected_exact_head_or_artifact_version = 'different-head';
    expect(validatesResumeContract(candidate)).toBe(false);
  });

  it('rejects fabricated guard version for unversioned snapshot', () => {
    const candidate = makeContinue();
    delete (candidate as any).exact_head_or_artifact_version;
    candidate.mutation_guard.expected_exact_head_or_artifact_version = 'invented-version';
    expect(validatesResumeContract(candidate)).toBe(false);
  });

  it('allows matching unversioned snapshot', () => {
    const candidate = makeContinue();
    delete (candidate as any).exact_head_or_artifact_version;
    delete (candidate as any).mutation_guard.expected_exact_head_or_artifact_version;
    expect(validatesResumeContract(candidate)).toBe(true);
  });

  it('rejects stale mutation authority on IDLE, WAITING, and BLOCKED states', () => {
    const guard = makeContinue().mutation_guard;
    const idle = { contract_version: 'TIGERIQ_NV_SESSION_RESUME_V1', employee_id: 'NV03', identity_registered: true,
      queue_audit_complete: true, result: 'IDLE', candidate_count: 0, observed_at: '2026-09-03T00:30:00+07:00',
      source_refs: ['authoritative queue audit'], mutation_guard: guard };
    expect(validatesResumeContract(idle)).toBe(false);
    expect(validatesResumeContract({ ...makeWaiting(), mutation_guard: guard })).toBe(false);
    const blocked = { contract_version: 'TIGERIQ_NV_SESSION_RESUME_V1', employee_id: 'NV05', identity_registered: true,
      queue_audit_complete: true, result: 'BLOCKED', candidate_count: 1, selected_work_ref: 'Issue #200', work_state: 'BLOCKED',
      blocker: 'External authorization required.', resume_condition: 'Resume after explicit authorization.',
      observed_at: '2026-09-03T00:30:00+07:00', source_refs: ['Issue #200'], mutation_guard: guard };
    expect(validatesResumeContract(blocked)).toBe(false);
  });

  it('rejects contradictory wait/block fields on CONTINUE', () => {
    expect(validatesResumeContract({ ...makeContinue(), wait_reason: 'still waiting' })).toBe(false);
    expect(validatesResumeContract({ ...makeContinue(), blocker: 'still blocked' })).toBe(false);
    expect(validatesResumeContract({ ...makeContinue(), resume_condition: 'later' })).toBe(false);
  });

  it('rejects invalid observed_at timestamp instead of treating format as documentation only', () => {
    expect(validatesResumeContract({ ...makeContinue(), observed_at: 'not-a-date' })).toBe(false);
  });

  it('rejects unregistered NV identity', () => {
    const candidate = makeContinue();
    candidate.employee_id = 'NV07';
    expect(validatesResumeContract(candidate)).toBe(false);
  });

  it('allows RẢNH only after zero-candidate audit', () => {
    const idle = { contract_version: 'TIGERIQ_NV_SESSION_RESUME_V1', employee_id: 'NV03', identity_registered: true,
      queue_audit_complete: true, result: 'IDLE', candidate_count: 0, observed_at: '2026-09-03T00:30:00+07:00',
      source_refs: ['authoritative queue audit'] };
    expect(validatesResumeContract(idle)).toBe(true);
    expect(validatesResumeContract({ ...idle, candidate_count: 1 })).toBe(false);
    expect(validatesResumeContract({ ...idle, selected_work_ref: 'Issue #999' })).toBe(false);
  });

  it('preserves waiting work with resume condition', () => {
    const waiting = makeWaiting();
    expect(validatesResumeContract(waiting)).toBe(true);
    expect(validatesResumeContract({ ...waiting, resume_condition: undefined })).toBe(false);
  });

  it('documents exact stale-session binding', () => {
    expect(policy).toContain('optimistic concurrency');
    expect(policy).toContain('Before each mutation');
    expect(policy).toContain('H1 != H2');
    expect(policy).toContain('expected_work_ref == selected_work_ref');
    expect(policy).toContain('expected_work_state == work_state');
    expect(policy).toContain('expected_exact_head_or_artifact_version` is mandatory and must equal it exactly');
  });
});
