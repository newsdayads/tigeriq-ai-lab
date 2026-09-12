import test from 'node:test';
import assert from 'node:assert';
import { isRetryableError } from '../apps/tigeriq-coding-lane/coding-lane.mjs';

test('isRetryableError identifies transient and malformed JSON errors', () => {
  assert.strictEqual(isRetryableError(new Error('EMPTY_RESPONSE')), true);
  assert.strictEqual(isRetryableError(new Error('JSON_OBJECT_INVALID')), true);
  assert.strictEqual(isRetryableError(new Error('SyntaxError: Unexpected token')), true);
  assert.strictEqual(isRetryableError(new Error('HTTP_429: rate limit')), true);
  assert.strictEqual(isRetryableError(new Error('HTTP_500: internal server error')), true);
  assert.strictEqual(isRetryableError(new Error('fetch failed')), true);
  assert.strictEqual(isRetryableError(new Error('ECONNRESET')), true);
  assert.strictEqual(isRetryableError(new Error('SOME_OTHER_FATAL')), false);
});
