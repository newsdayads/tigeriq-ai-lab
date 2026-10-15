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
  assert.match(launcher,/TIGERIQ_CLOUDFLARE_FREE_CONFIRMED/);
  assert.match(launcher,/TIGERIQ_NVIDIA_FREE_DEV_CONFIRMED/);
  assert.match(launcher,/TIGERIQ_CODING_MAX_PARALLEL='6'/);
  assert.doesNotMatch(launcher,/Set-SecretEnv 'OPENROUTER_API_KEY'/);
  assert.doesNotMatch(launcher,/Set-SecretEnv 'MISTRAL_API_KEY'/);
  assert.doesNotMatch(launcher,/Set-SecretEnv 'HF_TOKEN'/);
});

test('standing zero-cost proof is opt-in, scoped and fail-closed in both launchers',()=>{
  const core=readFileSync(new URL('../scripts/tigeriq-core/run-core.ps1',import.meta.url),'utf8');
  for(const source of [core,launcher]){
    assert.match(source,/function Test-TigerIQFreeProviderProof/);
    assert.match(source,/standingZeroCostApproved/);
    assert.match(source,/standingApprovalSource/);
    assert.match(source,/owner_direct_2026-10-15/);
    assert.match(source,/owner_screenshot_2026-10-15_/);
    assert.match(source,/paidFallbackAllowed -cne \$false/);
    assert.match(source,/Provider -eq 'gemini' -and \$Proof.billingLinked -cne \$false/);
    assert.match(source,/Test-TigerIQFreeProviderProof -Proof \$groqProof -Provider 'groq'/);
    assert.match(source,/Test-TigerIQFreeProviderProof -Proof \$geminiProof -Provider 'gemini'/);
    assert.match(source,/TIGERIQ_ALLOW_PAID_AI='false'/);
  }
});
