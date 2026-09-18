import test from 'node:test';
import assert from 'node:assert';
import { parseRawUtf8Envelope, validateChanges } from '../apps/tigeriq-coding-lane/policy.mjs';
import { validateJobScope, CodingScopeViolationError } from '../apps/tigeriq-coding-lane/coding-lane.mjs';

test('parseRawUtf8Envelope handles valid exact paths, quotes, backslashes, CRLF, tabs, and unicode', () => {
  const payload = JSON.stringify({
    summary: 'Fix Unicode \u0026 Quotes "Test" \\ Backslash \r\n CRLF \t Tab',
    edits: [
      {
        path: 'apps/tigeriq-coding-lane/coding-lane.mjs',
        search: 'const x = "hello";\r\n',
        replace: 'const x = "world \u1F600 \\escape";\r\n'
      }
    ]
  });

  const parsed = parseRawUtf8Envelope(payload);
  assert.strictEqual(parsed.summary, 'Fix Unicode & Quotes "Test" \\ Backslash \r\n CRLF \t Tab');
  assert.strictEqual(parsed.edits.length, 1);
  assert.strictEqual(parsed.edits[0].path, 'apps/tigeriq-coding-lane/coding-lane.mjs');
  assert.ok(parsed.edits[0].search.includes('hello'));
  assert.ok(parsed.edits[0].replace.includes('world'));
});

test('parseRawUtf8Envelope handles template literals and raw content fields', () => {
  const payload = JSON.stringify({
    summary: 'Add new file',
    edits: [
      {
        path: 'apps/tigeriq-coding-lane/new-file.mjs',
        content: 'export const msg = `Hello ${name}`;
'
      }
    ]
  });

  const parsed = parseRawUtf8Envelope(payload);
  assert.strictEqual(parsed.edits.length, 1);
  assert.strictEqual(parsed.edits[0].path, 'apps/tigeriq-coding-lane/new-file.mjs');
  assert.ok(parsed.edits[0].content.includes('Hello'));
});

test('parseRawUtf8Envelope rejects malformed envelopes and duplicate paths', () => {
  // Malformed JSON
  assert.throws(() => {
    parseRawUtf8Envelope('{ invalid json');
  }, (err: any) => err.code === 'CODING_ENVELOPE_MALFORMED');

  // Duplicate paths
  const dupPayload = JSON.stringify({
    summary: 'Duplicate',
    edits: [
      { path: 'apps/tigeriq-coding-lane/a.mjs', content: 'one' },
      { path: 'apps/tigeriq-coding-lane/a.mjs', content: 'two' }
    ]
  });
  assert.throws(() => {
    parseRawUtf8Envelope(dupPayload);
  }, (err: any) => err.code === 'CODING_DUPLICATE_PATH');
});

test('validateJobScope rejects out-of-scope paths correctly', () => {
  const jobPaths = ['apps/tigeriq-coding-lane/coding-lane.mjs'];
  const changes = [
    { path: 'apps/tigeriq-coding-lane/coding-lane.mjs', content: 'ok' },
    { path: 'apps/tigeriq-core/unauthorized.mjs', content: 'bad' }
  ];

  assert.throws(() => {
    validateJobScope(jobPaths, changes);
  }, (err: any) => err instanceof CodingScopeViolationError && err.code === 'CODING_SCOPE_VIOLATION' && err.offending.includes('apps/tigeriq-core/unauthorized.mjs'));
});
