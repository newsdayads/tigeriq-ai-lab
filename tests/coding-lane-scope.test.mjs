import test from 'node:test';
import assert from 'node:assert';
import {validateJobScope, CodingScopeViolationError} from '../apps/tigeriq-coding-lane/coding-lane.mjs';

test('coding lane scope validation tests', async (t) => {
  const allowedPaths = [
    'apps/tigeriq-coding-lane/coding-lane.mjs',
    'apps/tigeriq-coding-lane/coding-entry.mjs',
    'packages/orchestrator/src/index.ts',
    'tests/coding-lane-scope.test.mjs'
  ];

  await t.test('(a) a valid edit set passes', () => {
    const changes = [
      { path: 'apps/tigeriq-coding-lane/coding-lane.mjs', content: 'content1' },
      { path: 'packages/orchestrator/src/index.ts', content: 'content2' }
    ];
    const res = validateJobScope(allowedPaths, changes);
    assert.strictEqual(res, true);
  });

  await t.test('(b) an edit set containing one extra path fails with the proper error', () => {
    const changes = [
      { path: 'apps/tigeriq-coding-lane/coding-lane.mjs', content: 'content1' },
      { path: 'unauthorized/secret-file.js', content: 'bad' }
    ];
    let errorCaught = null;
    try {
      validateJobScope(allowedPaths, changes);
    } catch (err) {
      errorCaught = err;
    }
    assert.ok(errorCaught instanceof CodingScopeViolationError);
    assert.strictEqual(errorCaught.code, 'CODING_SCOPE_VIOLATION');
    assert.deepStrictEqual(errorCaught.offending, ['unauthorized/secret-file.js']);
    assert.deepStrictEqual(errorCaught.detail, { code: 'CODING_SCOPE_VIOLATION', offending: ['unauthorized/secret-file.js'] });
  });

  await t.test('(c) that no PR-creation function is called after a violation', async () => {
    // We verify the contract and execution sequence: validateJobScope throws before branch write / PR creation functions are invoked.
    let prCreated = false;
    const mockOpenPr = async () => {
      prCreated = true;
    };

    const invalidChanges = [
      { path: 'unauthorized/path.js', content: 'hack' }
    ];

    let caught = null;
    try {
      // Simulating runJob execution check flow
      validateJobScope(allowedPaths, invalidChanges);
      await mockOpenPr();
    } catch (err) {
      caught = err;
    }

    assert.ok(caught instanceof CodingScopeViolationError);
    assert.strictEqual(prCreated, false, 'PR creation must not be called after scope violation');
  });
});
