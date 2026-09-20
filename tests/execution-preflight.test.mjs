import test from 'node:test';
import assert from 'node:assert';
import { runExecutionPreflight } from '../apps/tigeriq-core/execution-preflight.mjs';

test('execution-preflight passes with valid parameters', () => {
  const res = runExecutionPreflight({
    skill: { name: 'coding-assistant' },
    tool: { name: 'bash' },
    state: { status: 'running' }
  });
  assert.strictEqual(res.ok, true);
  assert.deepStrictEqual(res.errors, []);
});

test('execution-preflight catches invalid skill format', () => {
  const res = runExecutionPreflight({ skill: 'not-an-object' });
  assert.strictEqual(res.ok, false);
  assert.ok(res.errors.includes('INVALID_SKILL_FORMAT'));
});

test('execution-preflight catches missing skill identifier', () => {
  const res = runExecutionPreflight({ skill: {} });
  assert.strictEqual(res.ok, false);
  assert.ok(res.errors.includes('SKILL_MISSING_IDENTIFIER'));
});

test('execution-preflight catches invalid tool format', () => {
  const res = runExecutionPreflight({ tool: 123 });
  assert.strictEqual(res.ok, false);
  assert.ok(res.errors.includes('INVALID_TOOL_FORMAT'));
});

test('execution-preflight catches missing tool identifier', () => {
  const res = runExecutionPreflight({ tool: {} });
  assert.strictEqual(res.ok, false);
  assert.ok(res.errors.includes('TOOL_MISSING_IDENTIFIER'));
});

test('execution-preflight catches invalid state format or blocked status', () => {
  const res1 = runExecutionPreflight({ state: 'bad' });
  assert.strictEqual(res1.ok, false);
  assert.ok(res1.errors.includes('INVALID_STATE_FORMAT'));

  const res2 = runExecutionPreflight({ state: { status: 'blocked' } });
  assert.strictEqual(res2.ok, false);
  assert.ok(res2.errors.some(e => e.startsWith('STATE_TERMINATED_OR_BLOCKED')));
});
