import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const policy = readFileSync('docs/architecture/TIGERIQ_CHIEF_OF_STAFF_POLICY_V2.md', 'utf8');
const mission = readFileSync('docs/templates/COMPANY-001-MISSION-V2.md', 'utf8');
const schema = JSON.parse(readFileSync('schemas/prompt-architect-business-input-v2.schema.json', 'utf8')) as Record<string, any>;

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
