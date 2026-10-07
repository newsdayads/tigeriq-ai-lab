import { describe, expect, it } from 'vitest';
import { rankCandidates, scoreResource } from './smart-router.mjs';

function resource(overrides={}) {
  return {
    provider:'openrouter',
    model:'review-model',
    resource_id:'res:openrouter:review-model',
    employee_id:'NV13',
    enabled:true,
    health_state:'READY',
    credential_state:'READY',
    zeroOutOfPocket:true,
    cost_tier:'FREE',
    capabilities:['review','general'],
    ...overrides,
  };
}

describe('Codex Owner approval guard', () => {
  it('blocks Codex by default even when healthy and free', () => {
    const result=scoreResource(resource({
      provider:'openai',
      model:'codex-review',
      resource_id:'res:openai:codex-review',
    }),{profile:'REVIEW',capability:'review'});
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain('owner_codex_approval_required');
  });

  it('does not treat ordinary routing as Codex approval', () => {
    const result=rankCandidates([
      resource({
        provider:'openai',
        model:'codex',
        resource_id:'res:openai:codex',
        rank:1,
      }),
      resource({rank:10}),
    ],{profile:'REVIEW',capability:'review'});
    expect(result.chosen?.resourceId).toBe('res:openrouter:review-model');
    expect(result.candidates.find(x=>x.resourceId==='res:openai:codex')?.eligible).toBe(false);
  });

  it('allows Codex only when an explicit approval flag is supplied by the caller', () => {
    const result=scoreResource(resource({
      provider:'openai',
      model:'codex',
      resource_id:'res:openai:codex',
    }),{profile:'REVIEW',capability:'review',ownerCodexApproved:true});
    expect(result.eligible).toBe(true);
  });

  it('also blocks Codex Local identifiers without approval', () => {
    const result=scoreResource(resource({
      provider:'local',
      model:'gpt',
      resource_id:'res:local:gpt',
      runtime_binding:'CODEX_LOCAL_PC01',
      cost_tier:'LOCAL',
      credential_state:'LOCAL',
    }),{profile:'REVIEW',capability:'review'});
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain('owner_codex_approval_required');
  });
});
