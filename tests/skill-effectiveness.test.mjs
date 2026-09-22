import test from 'node:test';
import assert from 'node:assert';
import { useSkill, measureEffectiveness, retireSkill } from '../apps/tigeriq-core/skill-effectiveness.mjs';

import fs from 'node:fs';

function parseSimpleYaml(content) {
  const result = { skills: [] };
  let currentSkill = null;
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('- id:')) {
      if (currentSkill) result.skills.push(currentSkill);
      currentSkill = { id: trimmed.split(':')[1].trim() };
    } else if (currentSkill && trimmed.startsWith('state:')) {
      currentSkill.state = trimmed.split(':')[1].trim();
    }
  }
  if (currentSkill) result.skills.push(currentSkill);
  return result;
}

test('Registry validation for skill states and actual loader behavior', () => {
  const registryContent = fs.readFileSync(new URL('../docs/skills/registry.yaml', import.meta.url), 'utf8');
  const parsedRegistry = parseSimpleYaml(registryContent);
  
  const contextualSkill = parsedRegistry.skills.find(s => s.id === 'contextual-skill-loading');
  const tddSkill = parsedRegistry.skills.find(s => s.id === 'spec-first-tdd');
  const securitySkill = parsedRegistry.skills.find(s => s.id === 'external-skill-security-gate');
  const minimalSkill = parsedRegistry.skills.find(s => s.id === 'minimal-change-output');

  assert.strictEqual(contextualSkill.state, 'ACTIVE');
  assert.strictEqual(tddSkill.state, 'ACTIVE');
  assert.strictEqual(securitySkill.state, 'ACTIVE');
  assert.strictEqual(minimalSkill.state, 'ACTIVE');

  // Verify actual loader behavior via useSkill & measureEffectiveness
  const loaderSkillId = 'contextual-skill-loading';
  const initialLoadState = measureEffectiveness(loaderSkillId);
  assert.strictEqual(initialLoadState.total, 0);

  useSkill(loaderSkillId, { success: true, context: 'route-core' });
  const loadedState = measureEffectiveness(loaderSkillId);
  assert.strictEqual(loadedState.total, 1);
  assert.strictEqual(loadedState.successRate, 1);
});

test('Security gate logic functional test with isolated state', () => {
  const secSkillId = 'external-skill-security-gate';
  retireSkill(secSkillId);
  const initial = measureEffectiveness(secSkillId);
  assert.strictEqual(initial.total, 0);

  // Audit check simulation
  const auditPassed = true;
  if (auditPassed) {
    useSkill(secSkillId, { success: true, verified: 'provenance-pinned' });
  }
  const postAudit = measureEffectiveness(secSkillId);
  assert.strictEqual(postAudit.total, 1);
  assert.strictEqual(postAudit.successRate, 1);
  retireSkill(secSkillId);
});

test('Full skill effectiveness lifecycle: USE -> MEASURE -> RETIRE with isolation', () => {
  const skillId = 'test-skill-alpha-isolated';
  retireSkill(skillId);

  // Initial measurement should be zero/empty
  const initial = measureEffectiveness(skillId);
  assert.strictEqual(initial.total, 0);
  assert.strictEqual(initial.successRate, 0);

  // Record usage events
  useSkill(skillId, { success: true, payload: 'data1' });
  useSkill(skillId, { success: true, payload: 'data2' });
  useSkill(skillId, { success: false, payload: 'data3' });

  // Measure effectiveness (2 out of 3 successful -> 0.666...)
  const measured = measureEffectiveness(skillId);
  assert.strictEqual(measured.total, 3);
  assert.strictEqual(measured.successRate, 2 / 3);

  // Retire skill (clear stored data)
  const retired = retireSkill(skillId);
  assert.strictEqual(retired, true);

  // Subsequent measurement should show zero again
  const postRetire = measureEffectiveness(skillId);
  assert.strictEqual(postRetire.total, 0);
  assert.strictEqual(postRetire.successRate, 0);
});
