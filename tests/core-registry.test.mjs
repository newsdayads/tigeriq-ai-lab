import assert from 'node:assert';
import { getRegisteredModels, HEALTH_STATES } from '../apps/tigeriq-core/registry.mjs';

const models = getRegisteredModels();
const nv09 = models.find(m => m.employee_id === 'NV09');
assert.ok(nv09, 'NV09 resource should be registered');
assert.strictEqual(nv09.model, 'qwen3-coder:30b');
assert.deepStrictEqual(nv09.capability, ['coding','review']);
assert.strictEqual(nv09.health, HEALTH_STATES.IDLE_ON_DEMAND);
