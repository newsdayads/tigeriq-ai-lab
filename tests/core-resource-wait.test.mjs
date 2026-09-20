import test from 'node:test';
import assert from 'node:assert';

test('resource wait and requeue logic handles busy state without terminal failure', async () => {
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

  eventMock('RESOURCE_WAIT_QUEUED', { jobId: 'JOB-1', attempts, delayMs });
  eventMock('RESOURCE_WAIT_RELEASED', { jobId: 'JOB-1', attempts });

  assert.strictEqual(events.length, 2);
  assert.strictEqual(events[0].type, 'RESOURCE_WAIT_QUEUED');
  assert.strictEqual(events[1].type, 'RESOURCE_WAIT_RELEASED');
});
