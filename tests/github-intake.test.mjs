import test from 'node:test';
import assert from 'node:assert';
import { processGitHubIssue, classifyRisk, isZeroCost } from '../apps/tigeriq-coding-lane/github-intake.mjs';

test('isZeroCost checks label correctly', () => {
  assert.strictEqual(isZeroCost([{ name: 'zero-cost-reversible' }]), true);
  assert.strictEqual(isZeroCost(['other', 'zero-cost-reversible']), true);
  assert.strictEqual(isZeroCost(['bug']), false);
  assert.strictEqual(isZeroCost([]), false);
});

test('classifyRisk detects high and low risk keywords', () => {
  assert.strictEqual(classifyRisk('Fix typo', 'just a doc update'), 'low');
  assert.strictEqual(classifyRisk('Delete production database', 'urgent'), 'high');
  assert.strictEqual(classifyRisk('Update credential configuration', ''), 'high');
});

test('successful intake of a valid zero-cost issue', () => {
  const result = processGitHubIssue({
    issue: {
      number: 42,
      title: 'Add a helpful helper',
      body: 'No risk changes',
      labels: [{ name: 'zero-cost-reversible' }]
    }
  });
  assert.strictEqual(result.phase, 'plan');
  assert.strictEqual(result.status, 'ready');
  assert.strictEqual(result.owner, 'autonomous-manager');
  assert.strictEqual(result.authorizationNeeded, false);
  assert.strictEqual(result.issueNumber, 42);
});

test('rejection of missing label', () => {
  const result = processGitHubIssue({
    issue: {
      number: 43,
      title: 'Missing label issue',
      body: 'No labels',
      labels: [{ name: 'bug' }]
    }
  });
  assert.deepStrictEqual(result, { phase: 'rejected', status: 'blocked' });
});

test('high-risk detection sets authorizationNeeded and awaiting-review', () => {
  const result = processGitHubIssue({
    issue: {
      number: 44,
      title: 'Delete production deployment',
      body: 'Dangerous operation',
      labels: ['zero-cost-reversible']
    }
  });
  assert.strictEqual(result.phase, 'intake');
  assert.strictEqual(result.status, 'awaiting-review');
  assert.strictEqual(result.authorizationNeeded, true);
  assert.strictEqual(result.owner, null);
});

test('persistence verification through injected evidence sink', () => {
  const evidence = [];
  processGitHubIssue(
    {
      issue: {
        number: 45,
        title: 'Test persistence',
        body: 'Evidence check',
        labels: ['zero-cost-reversible']
      }
    },
    { storeEvidence: r => evidence.push(r) }
  );
  // Expect two evidence records: gate record and task record
  assert.strictEqual(evidence.length, 2);
  const [gateRec, taskRec] = evidence;
  assert.strictEqual(gateRec.gate, 'github-intake');
  assert.strictEqual(gateRec.status, 'pass');
  assert.strictEqual(taskRec.gate, 'github-intake-task');
  assert.strictEqual(taskRec.status, 'pass');
});
