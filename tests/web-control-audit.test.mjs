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

test('Repair handoff generates machine-readable file', () => {
  const mockAudit = { failures: [{ resolution: '4K', error: 'fail' }], metrics: {} };
  const testDir = 'Evidence/test-handoffs';
  const { filePath, handoff } = generateRepairHandoff(mockAudit, testDir);
  assert.ok(fs.existsSync(filePath));
  assert.strictEqual(handoff.failures.length, 1);
  fs.rmSync(testDir, { recursive: true, force: true });
});

test('Hourly runner executes successfully', async () => {
  const res = await runAudit('http://127.0.0.1:8796');
  assert.ok(res);
  assert.ok(Array.isArray(res.results));
});
