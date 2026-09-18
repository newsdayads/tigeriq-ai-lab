import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const core=readFileSync('apps/tigeriq-core/core.mjs','utf8');
const coding=readFileSync('apps/tigeriq-coding-lane/coding-lane.mjs','utf8');
const entry=readFileSync('apps/tigeriq-coding-lane/coding-entry.mjs','utf8');
const runCore=readFileSync('scripts/tigeriq-core/run-core.ps1','utf8');
const runCoding=readFileSync('scripts/tigeriq-core/run-coding-lane.ps1','utf8');

describe('#962 Cerebras NV17 integration',()=>{
  it('replaces NV17 Vercel AI with Cerebras in Core',()=>{
    expect(core).toContain("R('NV17','Cerebras','cerebras'");
    expect(core).toContain("process.env.TIGERIQ_CEREBRAS_MODEL || 'gpt-oss-120b'");
    expect(core).toContain("cerebras:['CEREBRAS_API_KEY']");
    expect(core).toContain("case 'cerebras': return openAiCompat('https://api.cerebras.ai/v1/chat/completions'");
    expect(core).not.toContain("R('NV17','Vercel','vercel'");
    expect(core).not.toContain('AI_GATEWAY_API_KEY');
    expect(core).not.toContain('TIGERIQ_VERCEL_FREE_CREDIT_CONFIRMED');
  });

  it('gates NV17 on an explicit zero-cost proof in Core and Coding Lane',()=>{
    expect(core).toContain("['CEREBRAS_API_KEY'],['TIGERIQ_CEREBRAS_FREE_TIER_VERIFIED','true']");
    expect(coding).toContain("R('NV17','cerebras'");
    expect(coding).toContain("process.env.CEREBRAS_API_KEY&&process.env.TIGERIQ_CEREBRAS_FREE_TIER_VERIFIED==='true'");
    expect(entry).toContain("if(process.env.TIGERIQ_CEREBRAS_FREE_TIER_VERIFIED!=='true') delete process.env.CEREBRAS_API_KEY");
  });

  it('uses the official Cerebras OpenAI-compatible endpoint in Coding Lane',()=>{
    expect(coding).toContain("https://api.cerebras.ai/v1/chat/completions");
    expect(coding).toContain('process.env.CEREBRAS_API_KEY');
  });

  it('stops loading Vercel AI credentials and loads Cerebras only after proof',()=>{
    for(const source of [runCore]){
      expect(source).not.toContain('AI_GATEWAY_API_KEY');
      expect(source).not.toContain('vercel-ai-gateway-key');
      expect(source).not.toContain('TIGERIQ_VERCEL_FREE_CREDIT_CONFIRMED');
    }
    for(const source of [runCore,runCoding]){
      expect(source).toContain("Get-TigerIQConfig 'cerebras-proof'");
      expect(source).toContain("Set-SecretEnv 'CEREBRAS_API_KEY' 'cerebras-api-key' 'TigerIQ-Cerebras-PC01-v1'");
      expect(source).toContain("TIGERIQ_CEREBRAS_FREE_TIER_VERIFIED='true'");
      expect(source).toContain("paidFallbackAllowed");
      expect(source).toContain("priceUsd");
    }
  });
});
