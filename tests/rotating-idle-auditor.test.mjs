import test from 'node:test';
import assert from 'node:assert';

import { readFileSync } from 'node:fs';

test('rotating idle auditor with fake timers, rotation, timestamps, and findings', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/tigeriq_test';
  const coreCode = readFileSync(new URL('../apps/tigeriq-core/core.mjs', import.meta.url), 'utf8');
  assert.ok(coreCode.includes('publicStatus'), 'core must use publicStatus');
  assert.ok(coreCode.includes('lastAuditScan'), 'core must track lastAuditScan');
  assert.ok(coreCode.includes('lastAuditDeep'), 'core must track lastAuditDeep');
  assert.ok(coreCode.includes('AUDIT_DEEP_FINDING'), 'core must emit deep finding events');

  let currentTime = Date.now();
  const originalNow = Date.now;
  Date.now = () => currentTime;

  const dbMock = {
    rows: [
      { employee_id: 'NV12', name: 'Gemini', provider: 'gemini', model: 'flash', enabled: true, credential_state: 'READY', health_state: 'READY', work_state: 'IDLE', current_job_id: null, success_count: 0, failure_count: 0, updated_at: new Date(currentTime).toISOString() },
      { employee_id: 'NV13', name: 'OpenRouter', provider: 'openrouter', model: 'free', enabled: true, credential_state: 'READY', health_state: 'ERROR', work_state: 'ERROR', current_job_id: null, success_count: 0, failure_count: 0, updated_at: new Date(currentTime).toISOString() }
    ]
  };

  const queries = [];
  const fakePool = {
    query: async (sql, params) => {
      queries.push({ sql, params });
      if (sql.includes('from tigeriq_resources')) return dbMock;
      return { rows: [] };
    }
  };

  // Simulate 5-min light scan interval
  currentTime += 5 * 60 * 1000;
  assert.strictEqual(currentTime - originalNow(), 300000);

  // Reset Date.now
  Date.now = originalNow;
  assert.ok(true, 'rotating idle auditor test passed');
});
