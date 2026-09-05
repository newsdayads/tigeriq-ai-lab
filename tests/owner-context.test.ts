import { describe, expect, it } from 'vitest';
import { OwnerContextStore } from '../packages/owner-context/src/index.js';

function store() {
  const s = new OwnerContextStore();
  s.addOperatingRule({ id: 'r1', text: 'Goal-first, execute without repeating known questions.', tags: ['global', 'workflow'], priority: 100, source: 'EXPLICIT_OWNER' });
  s.addOperatingRule({ id: 'r2', text: 'Do not claim DONE without evidence.', tags: ['global', 'evidence'], priority: 100, source: 'EXPLICIT_OWNER' });
  return s;
}

describe('OwnerContextStore', () => {
  it('supersedes decisions deterministically', () => {
    const s = store();
    s.addDecision({ id: 'd1', topic: 'deployment', statement: 'No production deployment.', tags: ['deployment'], state: 'ACTIVE', createdAt: 1 });
    s.addDecision({ id: 'd2', topic: 'deployment', statement: 'Production requires explicit Owner gate.', tags: ['deployment'], state: 'ACTIVE', createdAt: 2, supersedes: 'd1' });
    const compiled = s.compile({ employeeId: 'NV02', taskTags: ['deployment'], maxItems: 10 });
    expect(compiled.decisions.map((x) => x.id)).toEqual(['d2']);
  });

  it('suppresses a rejected repeated suggestion until expiry', () => {
    const s = store();
    s.addRejection({ id: 'x1', fingerprint: 'manual-repetitive-powershell', reason: 'Owner rejected repeated manual steps', tags: ['workflow'], createdAt: 1, expiresAt: 100 });
    expect(s.shouldSuppress('manual-repetitive-powershell', 50)).toBe(true);
    expect(s.shouldSuppress('manual-repetitive-powershell', 101)).toBe(false);
  });

  it('keeps one-off observations as candidate learning', () => {
    const s = store();
    s.observeLearning({ id: 'l1', fingerprint: 'prefer-short-status', statement: 'Prefer concise status reports', tags: ['workflow'], evidenceRefs: [], explicitOwner: false });
    expect(() => s.promoteLearning('prefer-short-status')).toThrow('LEARNING_NOT_VERIFIED');
  });

  it('promotes explicit Owner learning immediately', () => {
    const s = store();
    s.observeLearning({ id: 'l1', fingerprint: 'goal-first', statement: 'Owner delegates goals, not micro-steps', tags: ['workflow'], evidenceRefs: [], explicitOwner: true });
    expect(s.promoteLearning('goal-first', 10).state).toBe('VERIFIED');
  });

  it('promotes repeated evidence-backed learning', () => {
    const s = store();
    s.observeLearning({ id: 'l1', fingerprint: 'f1', statement: 'Repeated pattern', tags: ['workflow'], evidenceRefs: ['e1'], explicitOwner: false });
    s.observeLearning({ id: 'l1', fingerprint: 'f1', statement: 'Repeated pattern', tags: ['workflow'], evidenceRefs: ['e2'], explicitOwner: false });
    expect(s.promoteLearning('f1').state).toBe('VERIFIED');
  });

  it('blocks sensitive personal memory from repository context', () => {
    const s = store();
    expect(() => s.addOperatingRule({ id: 'bad', text: 'private', tags: ['medical'], priority: 1, source: 'EXPLICIT_OWNER' })).toThrow('SENSITIVE_MEMORY_BLOCKED:medical');
    expect(() => s.addDecision({ id: 'bad2', topic: 'x', statement: 'private', tags: ['credential'], state: 'ACTIVE', createdAt: 1 })).toThrow('SENSITIVE_MEMORY_BLOCKED:credential');
  });

  it('compiles only relevant context under budget', () => {
    const s = store();
    s.addDecision({ id: 'd1', topic: 'app', statement: 'Keep app work OFF-MAIN until gated.', tags: ['app'], state: 'ACTIVE', createdAt: 1 });
    s.addDecision({ id: 'd2', topic: 'sales', statement: 'Unrelated business decision.', tags: ['sales'], state: 'ACTIVE', createdAt: 1 });
    s.addGoal({ id: 'g1', title: 'Build self-operating TigerIQ', tags: ['global', 'architecture'], state: 'ACTIVE', priority: 100 });
    const compiled = s.compile({ employeeId: 'NV02', taskTags: ['app'], maxItems: 4 });
    expect(compiled.itemCount).toBeLessThanOrEqual(4);
    expect(compiled.decisions.map((x) => x.id)).toContain('d1');
    expect(compiled.decisions.map((x) => x.id)).not.toContain('d2');
    expect(compiled.operatingRules.length).toBeGreaterThan(0);
  });

  it('produces deterministic cross-chat handoff context', () => {
    const s = store();
    s.addGoal({ id: 'g1', title: 'Self-operating TigerIQ', tags: ['global'], state: 'ACTIVE', priority: 100 });
    const a = s.compile({ employeeId: 'NV04', taskTags: ['workflow'], maxItems: 10, now: 50 });
    const b = s.compile({ employeeId: 'NV04', taskTags: ['workflow'], maxItems: 10, now: 50 });
    expect(a).toEqual(b);
  });
});
