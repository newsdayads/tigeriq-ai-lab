import {test} from 'node:test';
import assert from 'node:assert/strict';
import {wrapFileChange, unwrapFileChange, parseEnvelopeOrLegacy} from '../apps/tigeriq-coding-lane/envelope.mjs';

test('envelope wraps and unwraps raw file blocks correctly', () => {
  const path = 'apps/demo/file.js';
  const content = 'console.log("hello world");\n';
  const wrapped = wrapFileChange(path, content, {Author: 'NV11'});
  assert.match(wrapped, /-----BEGIN TIGERIQ_FILE_CHANGE_V1-----/);
  assert.match(wrapped, /Path: apps\/demo\/file\.js/);
  assert.match(wrapped, /Author: NV11/);
  assert.match(wrapped, /-----END TIGERIQ_FILE_CHANGE_V1-----/);

  const unwrapped = unwrapFileChange(wrapped);
  assert.equal(unwrapped.path, path);
  assert.equal(unwrapped.content, content);
  assert.equal(unwrapped.metadata.Author, 'NV11');
});

test('parseEnvelopeOrLegacy handles both envelopes and legacy short metadata objects', () => {
  const wrapped = wrapFileChange('a.js', 'const x = 1;');
  const fromEnv = parseEnvelopeOrLegacy(wrapped);
  assert.equal(fromEnv.path, 'a.js');
  assert.equal(fromEnv.content, 'const x = 1;');

  const legacy = {path: 'b.js', content: 'const y = 2;'};
  const fromLegacy = parseEnvelopeOrLegacy(legacy);
  assert.equal(fromLegacy.path, 'b.js');
  assert.equal(fromLegacy.content, 'const y = 2;');
});

test('unwrapFileChange throws on malformed envelope', () => {
  assert.throws(() => unwrapFileChange('not an envelope'), /ENVELOPE_MALFORMED/);
  assert.throws(() => unwrapFileChange('-----BEGIN TIGERIQ_FILE_CHANGE_V1-----\nno path header\n\ncontent'), /ENVELOPE_MALFORMED/);
});
