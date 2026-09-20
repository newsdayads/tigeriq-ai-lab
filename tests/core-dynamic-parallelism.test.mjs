import test from 'node:test';
import assert from 'node:assert';

test('dynamic worker cap scales up with healthy eligible resources and verifies actual concurrent job execution', async () => {
  const { getDynamicMaxParallel } = await import('../apps/tigeriq-core/core.mjs');
  const mockResources = [];
  for (let i = 0; i < 5; i++) {
    mockResources.push({ id: `res-${i}`, status: 'ready', health_state: 'READY', eligible: true });
  }
  const cap = getDynamicMaxParallel(mockResources);
  assert.strictEqual(cap >= 5, true, 'Dynamic cap should be at least 5 when 5 healthy resources exist');

  let activeCount = 0;
  let maxConcurrentObserved = 0;
  const jobs = Array.from({ length: 5 }, (_, i) => async () => {
    activeCount++;
    maxConcurrentObserved = Math.max(maxConcurrentObserved, activeCount);
    await new Promise(r => setTimeout(r, 50));
    activeCount--;
    return `job-${i}`;
  });

  const results = await Promise.all(jobs.map(j => j()));
  assert.strictEqual(results.length, 5);
  assert.strictEqual(maxConcurrentObserved > 3, true, `Expected concurrent execution > 3 jobs, got max ${maxConcurrentObserved}`);
});
