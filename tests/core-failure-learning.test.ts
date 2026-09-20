import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
// @ts-expect-error runtime module intentionally has no TS declaration file.
import {normalizeFailureEvent,buildFailureLearningCandidates} from '../apps/tigeriq-core/failure-learning.mjs';

const ev=(seq:number,overrides:any={})=>({
  seq:String(seq),
  ts:`2026-09-18T09:00:0${seq}Z`,
  type:'RESOURCE_FAILURE',
  objective_id:`OBJ-${seq}`,
  job_id:`JOB-${seq}`,
  employee_id:'NV12',
  resource_id:'gemini:test',
  task_kind:'reasoning',
  data:{kind:'rate_limit',message:'HTTP 429 request 123',...overrides}
});

describe('Learn From Failure',()=>{
  it('normalizes equivalent verified failures to the same deterministic signature',()=>{
    const a=normalizeFailureEvent(ev(1));
    const b=normalizeFailureEvent(ev(2,{message:'HTTP 429 request 999'}));
    expect(a?.signature).toBe(b?.signature);
    expect(a?.evidenceRef).toBe('event:1');
  });

  it('does not create a candidate from a one-off failure',()=>{
    expect(buildFailureLearningCandidates([ev(1)])).toEqual([]);
  });

  it('dedupes repeated failures into one evidence-backed candidate',()=>{
    const out=buildFailureLearningCandidates([ev(1),ev(2),ev(3)]);
    expect(out).toHaveLength(1);
    expect(out[0].state).toBe('CANDIDATE');
    expect(out[0].occurrenceCount).toBe(3);
    expect(out[0].evidenceRefs).toEqual(['event:1','event:2','event:3']);
    expect(out[0].proposalOnly).toBe(true);
    expect(out[0].autoPromotionAllowed).toBe(false);
  });

  it('never fabricates provenance when durable seq/timestamp is missing',()=>{
    const missingSeq={...ev(1),seq:null};
    const missingTs={...ev(2),ts:null};
    expect(buildFailureLearningCandidates([missingSeq,missingTs,ev(3)])).toEqual([]);
  });

  it('does not re-emit a signature already recorded durably',()=>{
    const first=buildFailureLearningCandidates([ev(1),ev(2)])[0];
    const out=buildFailureLearningCandidates([ev(3),ev(4)],{existingSignatures:new Set([first.signature])});
    expect(out).toEqual([]);
  });

  it('marks protected-boundary failures proposal-only and owner-gated',()=>{
    const a=ev(1,{kind:'credential_security',message:'production credential auth failure'});
    const b=ev(2,{kind:'credential_security',message:'production credential auth failure'});
    const candidate=buildFailureLearningCandidates([a,b])[0];
    expect(candidate.protectedBoundary).toBe(true);
    expect(candidate.requiresOwnerAuthorization).toBe(true);
    expect(candidate.autoPromotionAllowed).toBe(false);
  });

  it('Core scans durable events and emits candidates without writing registry at runtime',()=>{
    const core=readFileSync('apps/tigeriq-core/core.mjs','utf8');
    expect(core).toContain('runFailureLearningScan');
    expect(core).toContain("FAILURE_LEARNING_CANDIDATE");
    expect(core).toContain("FAILURE_LEARNING_SCAN");
    expect(core).not.toContain("writeFile('docs/skills/registry.yaml'");
  });

  // New tests for RepairLoop behavior
  it('normalizes raw failure signals to unified decisions',()=>{
    const { repairLoop, RepairDecision } = require('../apps/tigeriq-core/repair-loop.mjs');
    expect(repairLoop.normalize('FAIL')).toBe(RepairDecision.RETRY);
    expect(repairLoop.normalize('CI_FAIL')).toBe(RepairDecision.RETRY);
    expect(repairLoop.normalize('REVIEW_CHANGES')).toBe(RepairDecision.REVIEW);
    expect(repairLoop.normalize('STALL')).toBe(RepairDecision.BLOCK);
  });

  it('executes a single retry via Coding Lane and respects max retries', async()=>{
    const vi = require('vitest');
    const { vi: mock } = vi;
    mock.mockReset();
    mock.mockImplementation(()=>({}));
    vi.mock('../apps/tigeriq-coding-lane/coding-lane.mjs',()=>({
      runCodingLane: vi.fn().mockResolvedValue(undefined)
    }));
    vi.mock('../apps/tigeriq-core/execution-preflight.mjs',()=>({
      runExecutionPreflight: vi.fn().mockResolvedValue({ ok: true })
    }));
    const { repairLoop, RepairDecision } = await import('../apps/tigeriq-core/repair-loop.mjs');
    const decision1 = await repairLoop.handleFailure('FAIL');
    expect(decision1).toBe(RepairDecision.RETRY);
    const { runCodingLane } = await import('../apps/tigeriq-coding-lane/coding-lane.mjs');
    expect(runCodingLane).toHaveBeenCalledTimes(1);
    // Exhaust retries
    await repairLoop.handleFailure('FAIL');
    await repairLoop.handleFailure('FAIL');
    const decisionFinal = await repairLoop.handleFailure('FAIL');
    expect(decisionFinal).toBe(RepairDecision.BLOCK);
  });

    const core=readFileSync('apps/tigeriq-core/core.mjs','utf8');
    expect(core).toContain('runFailureLearningScan');
    expect(core).toContain("FAILURE_LEARNING_CANDIDATE");
    expect(core).toContain("FAILURE_LEARNING_SCAN");
    expect(core).not.toContain("writeFile('docs/skills/registry.yaml'");
  });

  it('registry promotes learn-from-failure only after source implementation',()=>{
    const registry=readFileSync('docs/skills/registry.yaml','utf8');
    const block=registry.slice(registry.indexOf('- id: learn-from-failure'),registry.indexOf('- id: role-separated-execution'));
    expect(block).toMatch(/id: learn-from-failure[\s\S]*?state: ACTIVE/);
    expect(block).toMatch(/version: 1\.0\.0/);
  });
});
