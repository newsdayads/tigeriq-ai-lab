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
    { employee_id: 'R3', enabled: true, work_state: 'IDLE', health_state: 'RATE_LIMITED', failure_count: 0, last_seen_at: new Date() },
    { employee_id: 'R4', enabled: true, work_state: 'ERROR', health_state: 'READY', failure_count: 0, last_seen_at: new Date() },
    { employee_id: 'R5', enabled: true, work_state: 'OFFLINE', health_state: 'READY', failure_count: 0, last_seen_at: new Date() },
    { employee_id: 'R6', enabled: true, work_state: 'WAIT_KEY', health_state: 'READY', failure_count: 0, last_seen_at: new Date() }
  ];
  const pool = new FakePool(resources);
  const auditor = new RotatingIdleAuditor({ emit: () => {} }, pool);
  const selected = await auditor.selectEligibleResource();
  assert.strictEqual(selected.employee_id, 'R2');
});

test('RotatingIdleAuditor rotates selection based on load and idle time among multiple eligible resources', async () => {
  const now = Date.now();
  const resources = [
    { employee_id: 'RA', enabled: true, work_state: 'IDLE', health_state: 'READY', failure_count: 2, last_latency_ms: 100, last_seen_at: new Date(now - 10000) },
    { employee_id: 'RB', enabled: true, work_state: 'IDLE', health_state: 'READY', failure_count: 0, last_latency_ms: 50, last_seen_at: new Date(now - 50000) }
  ];
  const pool = new FakePool(resources);
  const auditor = new RotatingIdleAuditor({ emit: () => {} }, pool);
  const selected = await auditor.selectEligibleResource();
  assert.strictEqual(selected.employee_id, 'RB');
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

test('RotatingIdleAuditor verifies deep scan triggering and snapshot fields', async () => {
  const resources = [
    { employee_id: 'RD10', enabled: true, work_state: 'IDLE', health_state: 'READY', failure_count: 0, provider: 'ollama', last_seen_at: new Date() }
  ];
  const pool = new FakePool(resources);
  const eventBus = { emit: () => {} };
  const auditor = new RotatingIdleAuditor(eventBus, pool, { lightScanMs: 100, deepScanMs: 200 });
  
  const finding = await auditor.runScan(true);
  assert.notStrictEqual(finding, null);
  assert.strictEqual(finding.scanType, 'deep');
  assert.ok(auditor.lastDeepScan);
  assert.ok(auditor.lastScan);
  assert.strictEqual(auditor.currentAuditorId, 'NV12');
  assert.notStrictEqual(auditor.implementer, auditor.reviewer);
});

test('RotatingIdleAuditor deduplicates findings and dispatches single handoff with fake clock', async () => {
  const originalSetInterval = global.setInterval;
  const originalClearInterval = global.clearInterval;
  const intervals = [];
  global.setInterval = (cb, ms) => {
    intervals.push({ cb, ms });
    return intervals.length;
  };
  global.clearInterval = (id) => {};

  const resources = [
    { employee_id: 'R10', enabled: true, work_state: 'IDLE', health_state: 'READY', failure_count: 0, provider: 'ollama', last_seen_at: new Date()
    }
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
  assert.strictEqual(intervals.length, 2);

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
