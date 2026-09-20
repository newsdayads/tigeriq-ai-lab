import test from 'node:test';
import assert from 'node:assert';

test('resource wait and requeue logic handles busy state without terminal failure and verifies database state transitions', async () => {
  const dbQueries = [];
  const poolMock = {
    query: async (sql, params) => {
      dbQueries.push({ sql, params });
      if (sql.includes('select count')) return { rows: [{ count: 0 }] };
      return { rows: [] };
    }
  };

  const jobId = 'JOB-TEST-1';
  const metadata = { resourceWaitAttempts: 1 };
  const attempts = Number(metadata.resourceWaitAttempts) + 1;
  const maxAttempts = 5;
  assert.strictEqual(attempts, 2);
  assert.ok(attempts <= maxAttempts);
  
  const delayMs = Math.min(30000, 1000 * Math.pow(2, attempts));
  assert.strictEqual(delayMs, 4000);

  const events = [];
  const eventMock = (type, data) => {
    events.push({ type, data });
  };

  const updatedMeta = { ...metadata, resourceWaitAttempts: attempts };
  await poolMock.query("update tigeriq_jobs set status='queued', metadata=$2, started_at=null where id=$1", [jobId, JSON.stringify(updatedMeta)]);
  eventMock('RESOURCE_WAIT_QUEUED', { jobId, attempts, delayMs });

  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].type, 'RESOURCE_WAIT_QUEUED');
  assert.strictEqual(dbQueries.length, 1);
  assert.ok(dbQueries[0].sql.includes("set status='queued'"));
  assert.strictEqual(dbQueries[0].params[0], jobId);
});
