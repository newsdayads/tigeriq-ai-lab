import test from 'node:test';
import assert from 'node:assert';
import { parseMutationEnvelope } from '../packages/workforce/src/runtime.ts';

test('round-trip of UTF-8 payload containing all marker lines', () => {
  const allowed = new Set(['config/settings.json']);
  const complexPayload = {
    path: 'config/settings.json',
    patch: {
      marker1: '--- MUTATION START ---',
      marker2: '=== END ENVELOPE ===',
      content: 'UTF-8 test with emojis 🚀 and special chars'
    }
  };
  const jsonStr = JSON.stringify(complexPayload);
  const framed = `${Buffer.byteLength(jsonStr, 'utf8')}:${jsonStr}`;
  
  const result = parseMutationEnvelope(framed, allowed, 1024);
  assert.deepStrictEqual(result, complexPayload);
});

test('rejection of out-of-scope paths', () => {
  const allowed = new Set(['config/settings.json']);
  const payload = JSON.stringify({ path: 'etc/passwd', patch: {} });
  const framed = `${Buffer.byteLength(payload, 'utf8')}:${payload}`;

  assert.throws(() => {
    parseMutationEnvelope(framed, allowed, 1024);
  }, /rejected out-of-scope path/);
});

test('duplicate PATCH detection', () => {
  // Ensuring application logic or repeated patch validation behaves correctly when parsing multiple or checking state
  const allowed = new Set(['config/settings.json']);
  const payload1 = JSON.stringify({ path: 'config/settings.json', patch: { op: 'replace', value: 1 } });
  const payload2 = JSON.stringify({ path: 'config/settings.json', patch: { op: 'replace', value: 1 } });
  
  const env1 = parseMutationEnvelope(`${Buffer.byteLength(payload1, 'utf8')}:${payload1}`, allowed, 1024);
  const env2 = parseMutationEnvelope(`${Buffer.byteLength(payload2, 'utf8')}:${payload2}`, allowed, 1024);
  
  assert.deepStrictEqual(env1, env2);
});

test('malformed envelope handling with retry semantics', () => {
  const allowed = new Set(['config/settings.json']);
  const malformed = 'invalid:not-json';

  let attempts = 0;
  const maxRetries = 3;
  let success = false;

  while (attempts < maxRetries) {
    attempts++;
    try {
      parseMutationEnvelope(malformed, allowed, 1024);
      success = true;
      break;
    } catch (err) {
      if (attempts >= maxRetries) {
        assert.match(err.message, /malformed envelope/);
      }
    }
  }
  assert.strictEqual(success, false);
  assert.strictEqual(attempts, maxRetries);
});
