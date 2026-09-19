import test from 'node:test';
import assert from 'node:assert';
import { detectDestructiveChange } from '../apps/tigeriq-coding-lane/safety-guard.mjs';

test('detectDestructiveChange - Truncation failure', () => {
  const before = Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n');
  const after = 'line 0\nline 1';
  const res = detectDestructiveChange(before, after, 'test.js');
  assert.strictEqual(res.allowed, false);
  assert.ok(res.reason);
});

test('detectDestructiveChange - Large block replacement failure', () => {
  const before = Array.from({ length: 300 }, (_, i) => `original line ${i}`).join('\n');
  const replacement = Array.from({ length: 250 }, (_, i) => `completely different replacement line ${i}`).join('\n');
  const res = detectDestructiveChange(before, replacement, 'test.js');
  assert.strictEqual(res.allowed, false);
  assert.ok(res.reason.includes('Replaced large contiguous block'));
});

test('detectDestructiveChange - Small edit success', () => {
  const before = Array.from({ length: 50 }, (_, i) => `line ${i}`).join('\n');
  const after = before.replace('line 10', 'modified line 10');
  const res = detectDestructiveChange(before, after, 'test.js');
  assert.strictEqual(res.allowed, true);
});

test('detectDestructiveChange - New file creation success', () => {
  const before = '';
  const after = 'export const foo = true;\n';
  const res = detectDestructiveChange(before, after, 'new-file.js');
  assert.strictEqual(res.allowed, true);
});
