import {describe,expect,it} from 'vitest';
import {isRetryableFailure,isStaleJob,normalizeRepairFailure,repairInstruction,shouldRetry} from '../apps/tigeriq-coding-lane/autonomy-supervisor.mjs';

describe('coding autonomy supervisor repair policy',()=>{
  it('normalizes known repairable failures',()=>{
    expect(normalizeRepairFailure('REVIEW_CHANGES_UNRESOLVED')).toBe('REVIEW_CHANGES_UNRESOLVED');
    expect(normalizeRepairFailure('CI_GATE_REPAIR_EXHAUSTED: x')).toBe('CI_GATES_FAILED');
    expect(normalizeRepairFailure('CODING_COMPACT_EDIT_OLD_NOT_FOUND')).toBe('CODING_COMPACT_EDIT_OLD_NOT_FOUND');
    expect(normalizeRepairFailure('STALL_TIMEOUT')).toBe('STALL_TIMEOUT');
  });
  it('retries only bounded known repair classes',()=>{
    for(const code of ['CI_GATES_FAILED','CI_GATES_TIMEOUT','REVIEW_CHANGES_UNRESOLVED','STALL_TIMEOUT','CODING_COMPACT_EDIT_INVALID','CODING_COMPACT_EDITS_COUNT_INVALID','CODING_COMPACT_EDIT_OLD_NOT_FOUND']){
      expect(isRetryableFailure(code)).toBe(true);
    }
    for(const code of ['SECURITY_BLOCK','AUTH_REQUIRED','CREDENTIAL_MISSING','UNKNOWN_FAILURE'])expect(isRetryableFailure(code)).toBe(false);
    expect(shouldRetry(1,3)).toBe(true);
    expect(shouldRetry(3,3)).toBe(false);
  });
  it('detects only stale active coding states',()=>{
    const now=Date.parse('2026-09-20T12:00:00Z');
    expect(isStaleJob({status:'running',started_at:'2026-09-20T11:00:00Z'},now,30*60*1000)).toBe(true);
    expect(isStaleJob({status:'done',started_at:'2026-09-20T11:00:00Z'},now,30*60*1000)).toBe(false);
  });
  it('repair prompt preserves original instruction and bounded cycle evidence',()=>{
    const p=repairInstruction({instruction:'fix X',failure:{message:'CI_GATES_FAILED'}},'CI_GATES_FAILED',2);
    expect(p).toContain('fix X');
    expect(p).toContain('AUTONOMOUS_REPAIR_CYCLE=2');
    expect(p).toContain('PREVIOUS_FAILURE=CI_GATES_FAILED');
    expect(p).toContain('Do not broaden scope');
  });
});
