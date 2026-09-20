import test from 'node:test';
import assert from 'node:assert';
import { RESOLUTION_MATRIX } from '../scripts/web-control-audit/resolution-matrix.mjs';
import { generateRepairHandoff } from '../scripts/web-control-audit/repair-handoff.mjs';
import { runAudit } from '../scripts/web-control-audit/hourly-runner.mjs';
import fs from 'node:fs';

test('Resolution Matrix includes required formats', () => {
  assert.ok(RESOLUTION_MATRIX.find(r => r.name === 'FullHD'));
  assert.ok(RESOLUTION_MATRIX.find(r => r.name === '4K'));
  assert.ok(RESOLUTION_MATRIX.find(r => r.name === '2K'));
  assert.ok(RESOLUTION_MATRIX.find(r => r.name === 'Tablet'));
  assert.ok(RESOLUTION_MATRIX.find(r => r.name === 'Mobile'));
});

test('Repair handoff generates machine-readable file and deduplicates', () => {
  const mockAudit = { failures: [{ resolution: '4K', error: 'fail' }], metrics: {} };
  const testDir = 'Evidence/test-handoffs';
  fs.rmSync(testDir, { recursive: true, force: true });
  const res1 = generateRepairHandoff(mockAudit, testDir);
  assert.ok(fs.existsSync(res1.filePath));
  assert.strictEqual(res1.deduplicated, false);
  
  const res2 = generateRepairHandoff(mockAudit, testDir);
  assert.strictEqual(res2.deduplicated, true);
  assert.strictEqual(res1.handoff.id, res2.handoff.id);
  fs.rmSync(testDir, { recursive: true, force: true });
});

test('Hourly runner executes successfully', async () => {
  const res = await runAudit('http://127.0.0.1:8796');
  assert.ok(res);
  assert.ok(Array.isArray(res.results));
});
