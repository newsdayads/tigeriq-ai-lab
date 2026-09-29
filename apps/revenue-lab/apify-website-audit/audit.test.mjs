import test from 'node:test';
import assert from 'node:assert';
import { auditWebsite } from './audit-engine.mjs';

test('auditWebsite successfully audits valid URL', async () => {
  const result = await auditWebsite('https://example.com');
  assert.strictEqual(result.status, 'success');
  assert.strictEqual(result.url, 'https://example.com');
  assert.ok(result.seo);
  assert.ok(result.performance);
  assert.strictEqual(result.metrics.estimatedCostUSD, 0);
});

test('auditWebsite throws error on invalid URL', async () => {
  await assert.rejects(
    async () => await auditWebsite('not-a-url'),
    /Invalid or/
  );
});
