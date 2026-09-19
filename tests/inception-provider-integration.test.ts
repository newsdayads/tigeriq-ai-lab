import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const core=readFileSync('apps/tigeriq-core/core.mjs','utf8');
const coding=readFileSync('apps/tigeriq-coding-lane/coding-lane.mjs','utf8');
const entry=readFileSync('apps/tigeriq-coding-lane/coding-entry.mjs','utf8');
const runCore=readFileSync('scripts/tigeriq-core/run-core.ps1','utf8');
const runCoding=readFileSync('scripts/tigeriq-core/run-coding-lane.ps1','utf8');

describe('#985 Inception NV17 integration',()=>{
  it('makes Inception Mercury 2.5 the canonical NV17 provider',()=>{
    expect(core).toContain("R('NV17','Inception','inception'");
    expect(core).toContain("process.env.TIGERIQ_INCEPTION_MODEL || 'mercury-2.5'");
    expect(core).toContain("inception:['INCEPTION_API_KEY']");
    expect(core).toContain("case 'inception': return openAiCompat('https://api.inceptionlabs.ai/v1/chat/completions'");
    expect(core).not.toMatch(/Cerebras|cerebras|CEREBRAS/);
  });

  it('adds Inception to Coding Lane behind the same free-tier gate',()=>{
    expect(coding).toContain("R('NV17','inception'");
    expect(coding).toContain("process.env.INCEPTION_API_KEY&&process.env.TIGERIQ_INCEPTION_FREE_TIER_VERIFIED==='true'");
    expect(coding).toContain("https://api.inceptionlabs.ai/v1/chat/completions");
    expect(entry).toContain("if(process.env.TIGERIQ_INCEPTION_FREE_TIER_VERIFIED!=='true') delete process.env.INCEPTION_API_KEY");
    expect(coding).not.toMatch(/Cerebras|cerebras|CEREBRAS/);
    expect(entry).not.toMatch(/Cerebras|cerebras|CEREBRAS/);
  });

  it('loads the key only when the Owner-verified free-plan proof is fail-closed',()=>{
    for(const source of [runCore,runCoding]){
      expect(source).toContain("Get-TigerIQConfig 'inception-proof'");
      expect(source).toContain("Set-SecretEnv 'INCEPTION_API_KEY' 'inception-api-key' 'TigerIQ-Inception-PC01-v1'");
      expect(source).toContain("TIGERIQ_INCEPTION_FREE_TIER_VERIFIED='true'");
      expect(source).toContain("freeTokens");
      expect(source).toContain("creditCardRequired");
      expect(source).toContain("paidFallbackAllowed");
      expect(source).toContain("mercury-2.5");
      expect(source).not.toMatch(/Cerebras|cerebras|CEREBRAS/);
    }
  });

  it('keeps paid fallback disabled by runtime policy',()=>{
    expect(runCore).toContain("$env:TIGERIQ_ALLOW_PAID_AI='false'");
    expect(runCoding).toContain("$env:TIGERIQ_ALLOW_PAID_AI='false'");
  });
});
