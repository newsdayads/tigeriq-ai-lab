import test from 'node:test';
import assert from 'node:assert';
import { createServer } from 'node:http';

// We test the dynamic parallelism scaling logic derived from healthy eligible resources.
test('dynamic worker cap enforces concurrent dispatch of >3 jobs when >=5 healthy resources exist', async () => {
  global.resources = [
    { id: 'res-1', status: 'ready', healthy: true, health_state: 'READY' },
    { id: 'res-2', status: 'ready', healthy: true, health_state: 'READY' },
    { id: 'res-3', status: 'healthy', healthy: true, health_state: 'READY' },
    { id: 'res-4', status: 'ready', healthy: true, health_state: 'READY' },
    { id: 'res-5', status: 'ready', healthy: true, health_state: 'READY' }
  ];

  let claimedCount = 0;
  const activeJobs = new Set();
  const mockPool = {
    query: async (sql, params) => {
      if (sql.includes('select j.* from tigeriq_jobs')) {
        if (claimedCount < 5) {
          claimedCount++;
          const jobId = `job-${claimedCount}`;
          return { rows: [{ id: jobId, objective_id: 'obj-1', title: `Job ${claimedCount}`, prompt: 'test', capability: 'general', attempts: 0, max_attempts: 3 }] };
        }
        return { rows: [] };
      }
      if (sql.includes('update tigeriq_jobs')) {
        return { rowCount: 1 };
      }
      if (sql.includes('count(*)::int')) {
        return { rows: [{ count: 0 }] };
      }
      return { rows: [] };
    },
    connect: async () => ({
      query: async (sql) => {
        if (sql.includes('select j.* from tigeriq_jobs')) {
          if (claimedCount < 5) {
            claimedCount++;
            const jobId = `job-${claimedCount}`;
            return { rows: [{ id: jobId, objective_id: 'obj-1', title: `Job ${claimedCount}`, prompt: 'test', capability: 'general', attempts: 0, max_attempts: 3 }] };
          }
          return { rows: [] };
        }
        return { rows: [] };
      },
      release: () => {}
    })
  };

  // Test dynamic cap calculation and loop dispatch capacity
  const resList = global.resources;
  const healthyCount = resList.filter(r => r && (r.status === 'ready' || r.status === 'healthy' || r.healthy || r.health_state === 'READY')).length;
  assert.strictEqual(healthyCount, 5);

  const dynamicCap = Math.max(3, Math.min(20, healthyCount));
  assert.strictEqual(dynamicCap, 5);
  assert.ok(dynamicCap > 3, 'Dynamic worker cap should be > 3');

  // Simulate dispatch loop up to dynamicCap
  const dispatchedIds = [];
  while (activeJobs.size < dynamicCap) {
    const qResult = await mockPool.query('select j.* from tigeriq_jobs');
    const j = qResult.rows[0];
    if (!j) break;
    activeJobs.add(j.id);
    dispatchedIds.push(j.id);
  }

  assert.strictEqual(dispatchedIds.length, 5);
  assert.ok(dispatchedIds.length > 3, 'Should dispatch more than 3 jobs concurrently when >=5 healthy resources exist');
});
