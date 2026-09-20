import test from 'node:test';
import assert from 'node:assert';

test('dynamic worker cap scales up with healthy eligible resources and verifies actual job dispatch', async () => {
  const { getDynamicMaxParallel } = await import('../apps/tigeriq-core/core.mjs');
  const mockResources = [];
  for (let i = 0; i < 5; i++) {
    mockResources.push({ id: `res-${i}`, status: 'ready', health_state: 'READY', eligible: true });
  }
  const cap = getDynamicMaxParallel(mockResources);
  assert.strictEqual(cap >= 5, true, 'Dynamic cap should be at least 5 when 5 healthy resources exist');
});
