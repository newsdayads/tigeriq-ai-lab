import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseEnvelopeOrLegacy, wrapFileChange} from '../apps/tigeriq-coding-lane/envelope.mjs';

test('generation flows handle TIGERIQ_FILE_CHANGE_V1 raw block envelopes', () => {
  const block = wrapFileChange('apps/demo/gen.js', 'export const generated = true;\n');
  const parsed = parseEnvelopeOrLegacy(block);
  assert.equal(parsed.path, 'apps/demo/gen.js');
  assert.equal(parsed.content, 'export const generated = true;\n');
});
