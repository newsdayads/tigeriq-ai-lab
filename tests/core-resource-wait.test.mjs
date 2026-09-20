import test from 'node:test';
import assert from 'node:assert';
import { setTimeout as sleep } from 'node:timers/promises';

test('core resource wait and recovery simulation', async () => {
  const events = [];
  const mockState = {
    active: new Set(),
    pendingCount: 1,
    resourcesBusy: true
  };

  function simulateAllocation() {
    if (mockState.resourcesBusy) {
      return { status: 'TEMPORARILY_BUSY', retryAfterMs: 50 };
    }
    return { status: 'OK', resourceId: 'res-1' };
  }

  let attempt = 0;
  let recovered = false;
  while (attempt < 5) {
    attempt++;
    const res = simulateAllocation();
    events.push(res.status);
    if (res.status === 'TEMPORARILY_BUSY') {
      await sleep(res.retryAfterMs || 20);
      if (attempt >= 2) {
        mockState.resourcesBusy = false;
      }
    } else if (res.status === 'OK') {
      recovered = true;
      break;
    }
  }

  assert.strictEqual(recovered, true);
  assert.ok(events.includes('TEMPORARILY_BUSY'));
  assert.ok(events.includes('OK'));
});
