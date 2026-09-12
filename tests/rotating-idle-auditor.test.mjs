import test from 'node:test';
import assert from 'node:assert';
import { RotatingIdleAuditor } from '../apps/tigeriq-core/core.mjs';

class FakePool {
  constructor(rows = []) {
    this.rows = rows;
  }
  async query(sql, params) {
    return { rows: this.rows };
  }
}

test('RotatingIdleAuditor implementer and reviewer are distinct', () => {
  const auditor = new RotatingIdleAuditor({ emit: () => {} }, new FakePool());
  assert.notStrictEqual(auditor.implementer, auditor.reviewer);
});

test('RotatingIdleAuditor selects eligible resource with proper exclusions', async () => {
  const resources = [
    { employee_id: 'R1', enabled: true, work_state: 'BUSY', health_state: 'READY', failure_count: 0, last_seen_at: new Date() },
    { employee_id: 'R2', enabled: true, work_state: 'IDLE', health_state: 'READY', failure_count: 0, last_seen_at: new Date() },
    { employee_id: 'R3', enabled: true, work_state: 'IDLE', health_state: 'RATE_LIMITED', failure_count: 0, last_seen_at: new Date() }
  ];
  const pool = new FakePool(resources);
  const auditor = new RotatingIdleAuditor({ emit: () => {} }, pool);
  const selected = await auditor.selectEligibleResource();
  assert.strictEqual(selected.employee_id, 'R2');
});

test('RotatingIdleAuditor emits AUDIT_DEFERRED_NO_IDLE_RESOURCE when no resource qualifies', async () => {
  const pool = new FakePool([]);
  let eventEmitted = null;
  const eventBus = {
    emit: (type, data) => {
      eventEmitted = { type, data };
    }
  };
  const auditor = new RotatingIdleAuditor(eventBus, pool);
  const finding = await auditor.runScan(false);
  assert.strictEqual(finding, null);
  assert.strictEqual(eventEmitted.type, 'AUDIT_DEFERRED_NO_IDLE_RESOURCE');
});

test('RotatingIdleAuditor deduplicates findings and dispatches single handoff with fake clock', async () => {
  const originalSetInterval = global.setInterval;
  const originalClearInterval = global.clearInterval;
  let intervalCallback = null;
  global.setInterval = (cb, ms) => { intervalCallback = cb; return 123; };
  global.clearInterval = (id) => {};

  const resources = [
    { employee_id: 'R10', enabled: true, work_state: 'IDLE', health_state: 'READY', failure_count: 0, provider: 'ollama', last_seen_at: new Date() }
  ];
  const pool = new FakePool(resources);
  let handoffs = 0;
  const eventBus = {
    emit: (type, data) => {
      if (type === 'AUDITOR_FINDING_HANDOFF') handoffs++;
    }
  };
  const auditor = new RotatingIdleAuditor(eventBus, pool, { lightScanMs: 300000, deepScanMs: 1800000 });
  auditor.start();
  assert.strictEqual(typeof intervalCallback, 'function');

  const f1 = await auditor.runScan(false);
  const f2 = await auditor.runScan(false);
  assert.notStrictEqual(f1, null);
  assert.strictEqual(f2, null);
  assert.strictEqual(handoffs, 1);
  assert.strictEqual(auditor.openIncidents, 1);
  assert.ok(auditor.latestFinding);
  auditor.stop();
  global.setInterval = originalSetInterval;
  global.clearInterval = originalClearInterval;
});
