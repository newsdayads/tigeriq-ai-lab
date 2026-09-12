import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import { RotatingIdleAuditor } from '../apps/tigeriq-core/rotating-idle-auditor.mjs';
import * as core from '../apps/tigeriq-core/core.mjs';

describe('RotatingIdleAuditor', () => {
  let auditor;

  beforeEach(() => {
    mock.method(core, 'callNvApi', async () => [
      { id: 'INC-1', status: 'idle' },
      { id: 'INC-2', status: 'idle' }
    ]);
    mock.method(core, 'event', async () => ({}));
  });

  afterEach(() => {
    if (auditor) auditor.stop();
    mock.reset();
  });

  test('initializes and schedules light scan', async () => {
    auditor = new RotatingIdleAuditor({ lightInterval: 300000, deepInterval: 1800000 });
    await auditor.start();
    
    const res = await core.pool.query("SELECT data->>'currentAuditor' as ca, data->>'nextLightScan' as nls FROM tigeriq_truth WHERE id = 'runtime_truth'");
    assert.ok(res.rows[0].ca);
    assert.ok(res.rows[0].nls);
  });

  test('updates lastDeepScan during deep scan', async () => {
    auditor = new RotatingIdleAuditor();
    await auditor.start();
    
    await auditor.runScan('deep');
    const res = await core.pool.query("SELECT data->>'lastDeepScan' as lds FROM tigeriq_truth WHERE id = 'runtime_truth'");
    assert.ok(res.rows[0].lds);
  });

  test('handles anomaly event with immediate scan', async () => {
    auditor = new RotatingIdleAuditor();
    await auditor.start();
    
    const before = Date.now();
    await auditor.handleAnomalyEvent();
    const res = await core.pool.query("SELECT data->>'lastScan' as ls FROM tigeriq_truth WHERE id = 'runtime_truth'");
    assert.ok(res.rows[0].ls);
  });
});
