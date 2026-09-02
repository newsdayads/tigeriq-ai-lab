import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const policy = readFileSync('docs/architecture/TIGERIQ_CHIEF_OF_STAFF_POLICY_V2.md', 'utf8');
const mission = readFileSync('docs/templates/COMPANY-001-MISSION-V2.md', 'utf8');
const schema = JSON.parse(readFileSync('schemas/prompt-architect-business-input-v2.schema.json', 'utf8')) as Record<string, any>;

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

function makeBusinessInput() {
  return {
    contract_version: 'TIGERIQ_PROMPT_ARCHITECT_BUSINESS_INPUT_V2',
    mission_ref: 'MISSION-TEST',
    work_intent_ref: 'INTENT-TEST',
    action_ref: 'ACTION-TEST',
    goal_ref: 'GOAL-TEST',
    business_objective: 'Prepare an internal evidence-backed proposal.',
    department: 'Research',
    employee: {
      employee_ref: 'EMP-RESEARCH-01',
      role: 'Research analyst',
      capabilities: ['research'],
    },
    authority: {
      authority_gate_ref: 'AUTH-GATE-TEST',
      decision: 'AUTHORIZE',
      owner_delegation_ref: 'DELEGATION-TEST',
      mission_policy_ref: 'MISSION-POLICY-TEST',
      employee_permission_ref: 'EMP-PERM-TEST',
      tool_permission_ref: 'TOOL-PERM-TEST',
      risk_policy_ref: 'RISK-POLICY-TEST',
      owner_reserved_action: false,
      allowed_actions: ['internal-research'],
      allowed_tools: [],
    },
    risk: {
      level: 'R1',
      hard_floor_reason: 'Internal reversible research/proposal work.',
      assurance: {
        reviewer_required: false,
        judge_required: false,
        owner_required: false,
      },
    },
    acceptance_criteria: ['Evidence is traceable.'],
    evidence_requirements: ['Source refs for material factual claims.'],
    constraints: {
      prohibitions: ['paid service', 'customer contact', 'Production change'],
      max_business_attempts: 3,
      max_correction_cycles: 2,
      source_provenance_required: true,
    },
  };
}

describe('Chief of Staff Policy V2', () => {
  it('keeps Chief above runtime without turning #111 into the company brain', () => {
    expect(policy).toContain('Chief of Staff is **not**:');
    expect(policy).toContain('AI Coordinator / Prompt Architect #111');
    expect(policy).toContain('It does not decide company strategy');
    expect(policy).toContain('does not become company brain');
  });

  it('fails closed on authority and preserves Owner-reserved actions', () => {
    expect(policy).toContain('Effective authority is always the intersection');
    expect(policy).toContain('Owner delegation ∩ Process/Mission policy ∩ Employee permissions ∩ Tool permissions ∩ Risk/approval policy');
    expect(policy).toContain('purchase, paid subscription, borrowing, investment or any financial commitment');
    expect(policy).toContain('Production release/promotion');
    expect(policy).toContain('CẦN_SẾP');
    expect(policy).toContain('Missing information that is required to prove authority or risk safety resolves to **BLOCK / CẦN SẾP**');
  });

  it('maps action-level R0-R4 assurance and independence', () => {
    for (const level of ['R0', 'R1', 'R2', 'R3', 'R4']) expect(policy).toContain(`| ${level} |`);
    expect(policy).toContain('Risk is classified **per action**');
    expect(policy).toContain('Executor must not be its own Reviewer');
    expect(policy).toContain('Prompt Architect must not Review/Judge the result of a Prompt it produced');
    expect(policy).toContain('Chief of Staff must not satisfy an independent review/judge requirement for its own authored decision/output');
  });

  it('links Mission to runtime Jobs by references instead of duplicating runtime state', () => {
    expect(policy).toContain('Mission is business state. Job is runtime execution state. They are linked, not duplicated.');
    expect(policy).toContain('`Mission.job_refs` stores refs/relations only');
    expect(policy).toContain('Job lifecycle, Lease, Result, Evidence and Review remain authoritative in runtime');
  });

  it('bounds retry and correction', () => {
    expect(policy).toContain('2 retries after the first attempt (3 attempts total)');
    expect(policy).toContain('2 correction cycles');
    expect(policy).toContain('retry/correction ceiling exhausted');
    expect(policy).toContain('Chief/A5 may correct only within the **same approved authority envelope**');
  });
});

describe('Prompt Architect Business Input V2', () => {
  it('requires authorized business context without provider secrets', () => {
    expect(schema.properties.contract_version.const).toBe('TIGERIQ_PROMPT_ARCHITECT_BUSINESS_INPUT_V2');
    expect(schema.required).toEqual(expect.arrayContaining([
      'mission_ref', 'action_ref', 'goal_ref', 'business_objective', 'department', 'employee',
      'authority', 'risk', 'acceptance_criteria', 'evidence_requirements', 'constraints',
    ]));
    expect(schema.properties.authority.properties.decision.const).toBe('AUTHORIZE');
    expect(schema.properties.authority.required).toContain('owner_reserved_action');
    expect(schema.properties.risk.properties.level.enum).toEqual(['R0', 'R1', 'R2', 'R3', 'R4']);
    expect(schema.properties.constraints.properties.max_business_attempts.maximum).toBe(3);
    expect(schema.properties.constraints.properties.max_correction_cycles.maximum).toBe(2);
    expect(JSON.stringify(schema).toLowerCase()).not.toContain('api_key');
    expect(JSON.stringify(schema).toLowerCase()).not.toContain('password');
    expect(JSON.stringify(schema).toLowerCase()).not.toContain('credential_value');
  });

  it('requires exactly one runtime Job ref or pre-dispatch work-intent ref', () => {
    expect(schema.oneOf).toHaveLength(2);
    expect(schema.oneOf[0].required).toEqual(['job_ref']);
    expect(schema.oneOf[1].required).toEqual(['work_intent_ref']);
  });

  it('fails schema validation when R4 AUTHORIZE lacks immutable Owner approval evidence', () => {
    const input = makeBusinessInput();
    input.risk.level = 'R4';
    input.risk.assurance.owner_required = true;
    expect(validatesJsonSchema(input, schema)).toBe(false);
  });

  it('fails schema validation when owner_required=true lacks Owner approval evidence', () => {
    const input = makeBusinessInput();
    input.risk.assurance.owner_required = true;
    expect(validatesJsonSchema(input, schema)).toBe(false);
  });

  it('fails schema validation when an Owner-reserved action is AUTHORIZE without approval evidence', () => {
    const input = makeBusinessInput();
    input.authority.owner_reserved_action = true;
    expect(validatesJsonSchema(input, schema)).toBe(false);
  });

  it('rejects an empty approval ref and accepts non-empty immutable evidence ref', () => {
    const emptyRef = makeBusinessInput() as any;
    emptyRef.risk.level = 'R4';
    emptyRef.risk.assurance.owner_required = true;
    emptyRef.authority.owner_reserved_action = true;
    emptyRef.authority.owner_approval_ref = '';
    expect(validatesJsonSchema(emptyRef, schema)).toBe(false);

    const approved = makeBusinessInput() as any;
    approved.risk.level = 'R4';
    approved.risk.assurance.owner_required = true;
    approved.authority.owner_reserved_action = true;
    approved.authority.owner_approval_ref = 'DECISION-OWNER-IMMUTABLE-001';
    expect(validatesJsonSchema(approved, schema)).toBe(true);
    expect(schema.properties.authority.properties.owner_approval_ref['x-tigeriq-immutable']).toBe(true);
    expect(schema.properties.authority.properties.owner_approval_ref.minLength).toBe(1);
  });
});

describe('COMPANY-001 Mission V2', () => {
  it('keeps Research Product Finance Sales and Chief bounded', () => {
    for (const department of ['Research', 'Product', 'Finance', 'Sales', 'Chief']) {
      expect(mission).toContain(`## Work package — ${department}`);
    }
    expect(mission).toContain('paid service');
    expect(mission).toContain('customer/prospect contact');
    expect(mission).toContain('Production release/change');
    expect(mission).toContain('fixed-rubric TOP 3');
    expect(mission).toContain('business Outcome recorded, not only `job done`');
    expect(mission).toContain('produces `CẦN SẾP` before execution');
  });
});
