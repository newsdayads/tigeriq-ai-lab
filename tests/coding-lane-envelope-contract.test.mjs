import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {isRetryableAiError} from '../apps/tigeriq-coding-lane/policy.mjs';

test('Coding Lane source payload contract uses raw mutation envelopes, not whole-file JSON',()=>{
  const src=readFileSync('apps/tigeriq-coding-lane/coding-lane.mjs','utf8');
  assert.match(src,/TIGERIQ_PATCH_V1/);
  assert.match(src,/TIGERIQ_CREATE_V1/);
  assert.match(src,/invokeMutationWithFailover/);
  assert.doesNotMatch(src,/complete replacement UTF-8 file content/);
  assert.doesNotMatch(src,/"changes":\[\{"path":"exact allowed path","content"/);
});

test('malformed mutation envelope is retryable output-contract failure',()=>{
  assert.equal(isRetryableAiError(new Error('MUTATION_ENVELOPE_MALFORMED')),true);
});
