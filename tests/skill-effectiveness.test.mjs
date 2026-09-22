import test from 'node:test';
import assert from 'node:assert';
import { useSkill, measureEffectiveness, retireSkill } from '../apps/tigeriq-core/skill-effectiveness.mjs';

import fs from 'node:fs';
import yaml from 'node:yaml'; // fallback or simple parse if needed, or read registry via fs

test('Registry validation for candidate skills (contextual-skill-loading, spec-first-tdd, minimal-change-output, external-skill-security-gate)', () => {
  const registryContent = fs.readFileSync(new URL('../docs/skills/registry.yaml', import.meta.url), 'utf8');
  assert.ok(registryContent.includes('id: contextual-skill-loading\n    title: Contextual Skill Loading\n    state: CANDIDATE'));
  assert.ok(registryContent.includes('id: spec-first-tdd\n    title: SPEC-First and TDD When Appropriate\n    state: CANDIDATE'));
  assert.ok(registryContent.includes('id: external-skill-security-gate\n    title: External Skill Security Gate\n    state: CANDIDATE'));
  assert.ok(registryContent.includes('id: minimal-change-output\n    title: Minimal Change Output\n    state: CANDIDATE'));
});

test('Full skill effectiveness lifecycle: USE -> MEASURE -> RETIRE', () => {
  const skillId = 'test-skill-alpha';

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
