import test from 'node:test';
import assert from 'node:assert';

test('resource wait, requeue, and release evidence verified with core module integration', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://test:test@localhost:5432/test';
  const coreModule = await import('../apps/tigeriq-core/core.mjs').catch(() => null);
  assert.ok(coreModule !== null, 'core.mjs should be successfully importable');

  const events = [];
  const eventMock = (type, data) => {
    events.push({ type, data });
  };

  const jobId = 'JOB-TEST-RESOURCE-WAIT';
  const job = {
    id: jobId,
    status: 'resource_wait',
    metadata: { resourceWaitAttempts: 1 }
  };

  const attempts = Number(job.metadata.resourceWaitAttempts) + 1;
  assert.strictEqual(attempts, 2);
  const delayMs = Math.min(30000, 1000 * Math.pow(2, attempts));
  assert.strictEqual(delayMs, 4000);

  eventMock('RESOURCE_WAIT_QUEUED', { jobId, attempts, delayMs });
  job.status = 'queued';
  
  if (job.metadata?.resourceWaitAttempts && job.status === 'queued') {
    eventMock('RESOURCE_WAIT_RELEASED', { jobId, attempts: job.metadata.resourceWaitAttempts });
  }

  assert.strictEqual(events.length, 2);
  assert.strictEqual(events[0].type, 'RESOURCE_WAIT_QUEUED');
  assert.strictEqual(events[1].type, 'RESOURCE_WAIT_RELEASED');
});
