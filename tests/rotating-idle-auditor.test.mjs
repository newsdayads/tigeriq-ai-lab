import test from 'node:test';
import assert from 'node:assert';

test('rotating idle auditor mock test suite', async () => {
  const originalNow = Date.now;
  let fakeTime = 1000000;
  Date.now = () => fakeTime;

  try {
    assert.strictEqual(typeof Date.now(), 'number');
  } finally {
    Date.now = originalNow;
  }
});
