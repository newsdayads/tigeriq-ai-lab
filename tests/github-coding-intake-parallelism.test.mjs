import test from 'node:test';
import assert from 'node:assert';
import { checkCodingParallelismCapacity, parseCodingScope } from '../apps/tigeriq-core/github-coding-intake.mjs';

test('parallelism capacity and non-overlapping scope enforcement', async () => {
  const capRes = await checkCodingParallelismCapacity({ concurrencyCap: 3, activeTasks: [1, 2] });
  assert.strictEqual(capRes.allowed, true);
  assert.strictEqual(capRes.freeSlots, 1);

  const fullRes = await checkCodingParallelismCapacity({ concurrencyCap: 2, activeTasks: [1, 2] });
  assert.strictEqual(fullRes.allowed, false);
  assert.strictEqual(fullRes.freeSlots, 0);

  const scopeA = parseCodingScope('ALLOW_PATH_PREFIX=apps/a');
  const scopeB = parseCodingScope('ALLOW_PATH_PREFIX=apps/b');
  assert.deepStrictEqual(scopeA.paths, ['apps/a']);
  assert.deepStrictEqual(scopeB.paths, ['apps/b']);
});
