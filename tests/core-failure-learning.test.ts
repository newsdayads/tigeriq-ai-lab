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

import { processFailure } from '../apps/tigeriq-core/repair-loop.mjs';

describe('Repair Loop and Failure Processing', () => {
  it('handles CI repair (rawDecision = "CI_FAIL")', () => {
    const res = processFailure('fail-ci-1', 'CI_FAIL');
    expect(res.status).toBe('ACTION');
    expect(res.decision).toBe('CI_FAIL');
    expect(res.action).toBe('FIX_CI_AND_CREATE_PR');
  });

  it('handles review changes (rawDecision = "REVIEW_CHANGES")', () => {
    const res = processFailure('fail-rev-1', 'REVIEW_CHANGES');
    expect(res.status).toBe('ACTION');
    expect(res.decision).toBe('REVIEW_CHANGES');
    expect(res.action).toBe('ADDRESS_REVIEW_AND_UPDATE_PR');
  });

  it('handles provider failure/failover (rawDecision = "FAIL")', () => {
    const res = processFailure('fail-prov-1', 'FAIL');
    expect(res.status).toBe('ACTION');
    expect(res.decision).toBe('FAIL');
    expect(res.action).toBe('FAILOVER_AND_CREATE_PR');
  });

  it('handles hard blocker (rawDecision = "STALL")', () => {
    const res = processFailure('fail-stall-1', 'STALL');
    expect(res).toEqual({ status: 'BLOCKED', reason: 'STALL_DECISION' });
  });

  it('handles retry exhaustion after the max retry count, asserting the BLOCKED response', () => {
    const id = 'fail-exhaust-1';
    expect(processFailure(id, 'FAIL').status).toBe('ACTION'); // retry 1
    expect(processFailure(id, 'FAIL').status).toBe('NOOP'); // retry 2 (duplicate PR prevention)
    expect(processFailure(id, 'FAIL').status).toBe('NOOP'); // retry 3
    const exhausted = processFailure(id, 'FAIL'); // retry 4 (> 3)
    expect(exhausted).toEqual({ status: 'BLOCKED' });
  });
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

  it('registry promotes learn-from-failure only after source implementation',()=>{
    const registry=readFileSync('docs/skills/registry.yaml','utf8');
    const block=registry.slice(registry.indexOf('- id: learn-from-failure'),registry.indexOf('- id: role-separated-execution'));
    expect(block).toMatch(/id: learn-from-failure[\s\S]*?state: ACTIVE/);
    expect(block).toMatch(/version: 1\.0\.0/);
  });
});
