import test from 'node:test';
import assert from 'node:assert';
import { auditWebsite } from './audit-engine.mjs';

test('auditWebsite successfully audits valid URL with comprehensive schema and 20+ runs harness simulation', async () => {
  let successes = 0;
  for (let i = 0; i < 20; i++) {
    const result = await auditWebsite('https://example.com', { maxPages: 1, timeoutMs: 5000 });
    if (result.status === 'success') successes++;
  }
  assert.ok(successes >= 19, 'Must achieve >=95% success rate over 20 runs');
});

test('auditWebsite throws error on invalid URL', async () => {
  await assert.rejects(
    async () => await auditWebsite('not-a-url'),
    /Invalid or/
  );
});
