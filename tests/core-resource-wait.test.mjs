import { test, expect, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import * as core from '../apps/tigeriq-core/core.mjs';

let originalRunJob;
let logs = [];

beforeEach(() => {
  // Capture console.log output
  logs = [];
  const origLog = console.log;
  console.log = (...args) => {
    logs.push(args.join(' '));
    origLog.apply(console, args);
  };
  // Stub runJob to simulate temporary busy error on first call
  originalRunJob = core.runJob;
  let callCount = 0;
  core.runJob = async (job) => {
    if (callCount === 0) {
      callCount++;
      throw new Error('Resource busy: temporary contention');
    }
    // succeed on retry
    return Promise.resolve();
  };
});

afterEach(() => {
  // Restore originals
  console.log = console.__proto__.log;
  core.runJob = originalRunJob;
});

test('executeJobWithRetry handles temporary resource busy with backoff and emits evidence', async () => {
  const dummyJob = { id: 'test-job-1' };
  const start = Date.now();
  await core.executeJobWithRetry(dummyJob);
  const duration = Date.now() - start;
  // Expect at least one backoff (minimum 1000ms)
  assert.ok(duration >= 900, 'Backoff delay should have occurred');
  // Verify emitted events in order
  const queuedLog = logs.find(l => l.includes('RESOURCE_WAIT_QUEUED'));
  const releasedLog = logs.find(l => l.includes('RESOURCE_WAIT_RELEASED'));
  assert.ok(queuedLog, 'Should log RESOURCE_WAIT_QUEUED');
  assert.ok(releasedLog, 'Should log RESOURCE_WAIT_RELEASED');
  // Ensure the queued event appears before released
  assert.ok(logs.indexOf(queuedLog) < logs.indexOf(releasedLog), 'Queued event should precede released');
});
