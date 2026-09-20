import test from 'node:test';
import assert from 'node:assert';
import { selectIdleWorkers } from '../scripts/web-control-audit/worker-selection.mjs';
import { getViewportPolicy } from '../scripts/web-control-audit/viewport-policy.mjs';
import { runBrowserAudit } from '../scripts/web-control-audit/browser-audit-adapter.mjs';

test('worker selection fails closed', async () => {
  assert.throws(
    () => selectIdleWorkers(),
    /fail closed/
  );
});

test('viewport policy rotates', () => {
  const p0 = getViewportPolicy(0);
  const p1 = getViewportPolicy(1);
  assert.strictEqual(p0.rotation.label, '4K');
  assert.strictEqual(p1.rotation.label, '2K');
});

test('adapter invocation returns result', async () => {
  const res = await runBrowserAudit('http://example.com', { width: 1920, height: 1080 });
  assert.strictEqual(res.status, 'audit_complete');
});
