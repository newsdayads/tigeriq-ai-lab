import test, { mock } from 'node:test';
import assert from 'node:assert';
import { selectIdleWorkers } from '../scripts/web-control-audit/worker-selection.mjs';
import { getViewportPolicy } from '../scripts/web-control-audit/viewport-policy.mjs';
import { runBrowserAudit } from '../scripts/web-control-audit/browser-audit-adapter.mjs';

test('worker selection fails closed', async (t) => {
  await mock.method(global, 'fetch', async () => ({ ok: false }));
  assert.throws(() => selectIdleWorkers(), /fail closed/);
});

test('viewport policy rotates', () => {
  const p0 = getViewportPolicy(0);
  const p1 = getViewportPolicy(1);
  assert.strictEqual(p0.rotation.label, '4K');
  assert.strictEqual(p1.rotation.label, '2K');
});

test('audit adapter real contract call', async (t) => {
  await mock.method(global, 'fetch', async () => ({ ok: true, json: async () => ({ status: 'audit_complete' }) }));
  const res = await runBrowserAudit('http://example.com', { width: 1920 });
  assert.strictEqual(res.status, 'audit_complete');
});

test('repair handoff dedupe and rotation', async (t) => {
  await mock.method(global, 'fetch', async () => ({ ok: true, json: async () => ({ workers: [{ status: 'online', state: 'idle', cost: 0 }], status: 'audit_complete', sweepVerified: true }) }));
  const { processRepairHandoff } = await import('../scripts/web-control-audit/repair-handoff.mjs');
  const off1 = await processRepairHandoff('http://test.com', 1);
  const off2 = await processRepairHandoff('http://test.com', 1);
  assert.notStrictEqual(off1, null);
  assert.strictEqual(off2, null); // deduped second call returns null
});

test('hourly runner executes audit cycle', async (t) => {
  await mock.method(global, 'fetch', async () => ({ ok: true, json: async () => ({ workers: [{ status: 'online', state: 'idle', cost: 0 }], status: 'audit_complete', sweepVerified: true }) }));
  const { runHourlyAuditCycle } = await import('../scripts/web-control-audit/hourly-runner.mjs');
  const results = await runHourlyAuditCycle(['http://example.com']);
  assert.strictEqual(results.length, 1);
  assert.strictEqual(results[0].status, 'success');
});
