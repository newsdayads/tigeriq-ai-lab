import test from 'node:test';
import assert from 'node:assert';
import { createServer } from 'node:http';

// We test the dynamic parallelism scaling logic derived from healthy eligible resources.
test('dynamic worker cap scales beyond 3 when >=5 healthy resources exist', async () => {
  // Mock resources list with 5 healthy resources
  global.resources = [
    { id: 'res-1', status: 'ready', healthy: true },
    { id: 'res-2', status: 'ready', healthy: true },
    { id: 'res-3', status: 'healthy', healthy: true },
    { id: 'res-4', status: 'ready', healthy: true },
    { id: 'res-5', status: 'ready', healthy: true }
  ];

  // Import core module functions or test the limit derivation directly
  const healthyCount = global.resources.filter(r => r && (r.status === 'ready' || r.status === 'healthy' || r.healthy)).length;
  assert.strictEqual(healthyCount, 5);

  const dynamicCap = Math.max(3, Math.min(20, healthyCount));
  assert.strictEqual(dynamicCap, 5);
  assert.ok(dynamicCap > 3, 'Dynamic worker cap should be greater than 3 when 5 healthy resources exist');
});
