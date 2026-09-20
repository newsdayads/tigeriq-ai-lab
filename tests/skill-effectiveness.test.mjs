import test from 'node:test';
import assert from 'node:assert';
import { useSkill, measureEffectiveness, retireSkill } from '../apps/tigeriq-core/skill-effectiveness.mjs';

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
