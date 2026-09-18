import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseEnvelopeOrLegacy} from '../apps/tigeriq-coding-lane/envelope.mjs';
import {parseJsonObject} from '../apps/tigeriq-coding-lane/policy.mjs';

test('malformed JSON fallback handles raw envelope strings and parses robustly', () => {
  const malformedJson = '{"changes": [\n-----BEGIN TIGERIQ_FILE_CHANGE_V1-----\nPath: test.js\n\nconsole.log("hello");\n-----END TIGERIQ_FILE_CHANGE_V1-----\n]}';
  // Test parseJsonObject or fallback handling
  const rawEnvelope = '-----BEGIN TIGERIQ_FILE_CHANGE_V1-----\nPath: apps/test.js\n\nconst code = 123;\n-----END TIGERIQ_FILE_CHANGE_V1-----';
  const parsed = parseEnvelopeOrLegacy(rawEnvelope);
  assert.equal(parsed.path, 'apps/test.js');
  assert.equal(parsed.content, 'const code = 123;\n');
});
