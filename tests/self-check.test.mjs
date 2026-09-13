import test from 'node:test';
import assert from 'node:assert';
import { startSelfCheck } from '../apps/tigeriq-core/core.mjs';

test('SelfCheck module schedules light and deep audits and persists results', async () => {
  let currentTime = 1000000;
  const persisted = [];
  
  const mockRuntime = {
    now: () => currentTime,
    lightIntervalMs: 600000,
    deepIntervalMs: 1800000,
    store: {
      persist: async (type, data) => {
        persisted.push({ type, data, ts: currentTime });
      },
      query: async (sql, params) => {
        persisted.push({ type: params[0], data: JSON.parse(params[1]), ts: currentTime });
        return { rows: [] };
      }
    }
  };

  // Initial call sets baseline
  await startSelfCheck(mockRuntime);
  assert.strictEqual(persisted.length, 2, 'Light and deep audits should run initially');

  // Advance time by 5 minutes (not enough for light or deep)
  currentTime += 300000;
  await startSelfCheck(mockRuntime);
  assert.strictEqual(persisted.length, 2, 'No new audits should trigger before intervals');

  // Advance time past 10 minutes from start
  currentTime += 400000;
  await startSelfCheck(mockRuntime);
  assert.strictEqual(persisted.length, 3, 'Light audit should trigger after 10 minutes');
  assert.strictEqual(persisted[2].type, 'SELF_CHECK_LIGHT');

  // Advance time past 30 minutes from start
  currentTime += 1200000;
  await startSelfCheck(mockRuntime);
  assert.ok(persisted.length >= 4, 'Deep audit should trigger after 30 minutes');
});
