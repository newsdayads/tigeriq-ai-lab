import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';

const entry=readFileSync(new URL('../apps/tigeriq-coding-lane/coding-entry.mjs',import.meta.url),'utf8');
const launcher=readFileSync(new URL('../scripts/tigeriq-core/run-coding-lane.ps1',import.meta.url),'utf8');

test('official Coding Lane entry fails closed on unverified providers',()=>{
  assert.match(entry,/TIGERIQ_ALLOW_PAID_AI/);
  assert.match(entry,/delete process\.env\.OPENROUTER_API_KEY/);
  assert.match(entry,/delete process\.env\.MISTRAL_API_KEY/);
  assert.match(entry,/delete process\.env\.HF_TOKEN/);
});

test('runtime launcher enables only verified free or trial providers',()=>{
  assert.match(launcher,/TIGERIQ_ALLOW_PAID_AI='false'/);
  assert.match(launcher,/GROQ.*FREE_TIER_VERIFIED|TIGERIQ_GROQ_FREE_TIER_VERIFIED/s);
  assert.match(launcher,/TIGERIQ_GEMINI_FREE_TIER_VERIFIED/);
  assert.match(launcher,/TIGERIQ_COHERE_TRIAL_CONFIRMED/);
  assert.doesNotMatch(launcher,/Set-SecretEnv 'OPENROUTER_API_KEY'/);
  assert.doesNotMatch(launcher,/Set-SecretEnv 'MISTRAL_API_KEY'/);
  assert.doesNotMatch(launcher,/Set-SecretEnv 'HF_TOKEN'/);
});
