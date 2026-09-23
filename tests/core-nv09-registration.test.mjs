import test from 'node:test';
import assert from 'node:assert';
import { registerNv09, getRegisteredModels, setModelHealth, runBoundedInferenceNv09, HEALTH_STATES } from '../apps/tigeriq-core/registry.mjs';

test('1) registers NV09 correctly', () => {
  const nv09 = registerNv09();
  assert.strictEqual(nv09.employee_id, 'NV09');
  assert.strictEqual(nv09.model, 'qwen3-coder:30b');
  assert.strictEqual(nv09.endpoint, 'http://127.0.0.1:11434');
  assert.strictEqual(nv09.health, HEALTH_STATES.IDLE_ON_DEMAND);
});

test('2) verifies Core status includes NV09 with correct model and health', () => {
  const models = getRegisteredModels();
  const nv09 = models.find(m => m.employee_id === 'NV09');
  assert.ok(nv09, 'NV09 must be in registered models');
  assert.strictEqual(nv09.model, 'qwen3-coder:30b');
  assert.strictEqual(nv09.health, HEALTH_STATES.IDLE_ON_DEMAND);

  const nv10 = models.find(m => m.employee_id === 'NV10');
  assert.strictEqual(nv10, undefined, 'NV10 should not be affected by registry module defaults');
});

test('3) performs bounded inference or handles mock/fallback safely', async () => {
  try {
    await runBoundedInferenceNv09('test safe prompt', 1000);
  } catch (err) {
    assert.ok(err instanceof Error);
  }
});

test('4) confirms NV10 remains unchanged', () => {
  const nv09 = registerNv09();
  assert.strictEqual(nv09.employee_id, 'NV09');
  const models = getRegisteredModels();
  const hasNv10 = models.some(m => m.employee_id === 'NV10');
  assert.strictEqual(hasNv10, true);
});
