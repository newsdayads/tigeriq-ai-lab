// @ts-nocheck
import { describe, it, expect } from 'vitest';
import { handleTerminalCampaign, resumePendingChildWork, hashIdempotencyKey } from '../apps/tigeriq-core/work-handoff.mjs';
import { processTerminalCampaignState } from '../apps/tigeriq-core/campaign-runner.mjs';

describe('Core Work Handoff & #830 Compatibility', () => {
  it('duplicate terminal evaluations do not create duplicate child work', () => {
    const parent = { id: 'OBJ-001', title: 'Parent Objective', objective: 'Test objective' };
    const aiRes = { title: 'Child Task', prompt: 'Do next step', acceptance: 'Done' };
    
    const first = handleTerminalCampaign(parent, aiRes);
    const second = handleTerminalCampaign(parent, aiRes);
    
    expect(first.id).toBe(second.id);
    expect(first.idempotencyKey).toBe(second.idempotencyKey);
  });

  it('restarting core resumes pending child work without duplication', () => {
    const parent = { id: 'OBJ-002', title: 'Parent 2', objective: 'Objective 2' };
    handleTerminalCampaign(parent, { title: 'Task 2', prompt: 'Resume test' });
    
    const resumed = resumePendingChildWork();
    expect(resumed.length).toBeGreaterThan(0);
    
    const keys = resumed.map(r => r.idempotencyKey);
    const uniqueKeys = new Set(keys);
    expect(keys.length).toBe(uniqueKeys.size);
  });

  it('source-mutation actions result only in a handoff entry and never claim source was mutated', () => {
    const parent = { id: 'OBJ-003', title: 'Parent 3', objective: 'Mutate code' };
    const mutationAiRes = { isMutation: true, title: 'Refactor code', prompt: 'Change code structure' };
    
    const result = handleTerminalCampaign(parent, mutationAiRes);
    expect(result.kind).toBe('durable-coding-handoff');
    expect(result.authorityClass).toBe('durable-handoff-only');
    
    const processed = processTerminalCampaignState(parent, mutationAiRes);
    expect(processed.autonomousCampaign.sourceMutated).toBe(false);
  });
});
