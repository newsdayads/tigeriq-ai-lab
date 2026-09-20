import {describe,expect,it} from 'vitest';
import {classifyIssueAutonomy,githubIssueEligibility,isRetryableFailure,isStaleJob,normalizeRepairFailure,repairInstruction,shouldRetry} from '../apps/tigeriq-coding-lane/autonomy-supervisor.mjs';

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

  it('honors current GitHub autonomy markers and owner holds',()=>{
    const base={state:'open',body:'TIGERIQ_EXECUTABLE=true\nOWNER_POLICY=AUTO\nSTATE=READY'};
    expect(classifyIssueAutonomy(base)).toEqual({eligible:true,reason:'AUTO_ALLOWED'});
    expect(classifyIssueAutonomy({...base,body:'TIGERIQ_EXECUTABLE=false\nOWNER_POLICY=AUTO'}).reason).toBe('TIGERIQ_EXECUTABLE_NOT_TRUE');
    expect(classifyIssueAutonomy({...base,body:'TIGERIQ_EXECUTABLE=true\nOWNER_POLICY=MANUAL'}).reason).toBe('OWNER_POLICY_NOT_AUTO');
    expect(classifyIssueAutonomy({...base,body:'TIGERIQ_EXECUTABLE=true\nOWNER_POLICY=AUTO\nNV02_SELF_MODIFICATION_GUARD=true'}).reason).toBe('NV02_SELF_MODIFICATION_GUARD');
    expect(classifyIssueAutonomy({...base,body:'TIGERIQ_EXECUTABLE=true\nOWNER_POLICY=AUTO\nSTATE=OWNER_HOLD_NV02_SELF_MODIFICATION'}).reason).toBe('OWNER_HOLD');
    expect(classifyIssueAutonomy({...base,state:'closed'}).reason).toBe('ISSUE_NOT_OPEN');
  });
  it('fails closed when current GitHub issue cannot be read',async()=>{
    const fail=await githubIssueEligibility(1165,async()=>{throw new Error('offline')},'token');
    expect(fail.eligible).toBe(false);
    expect(fail.reason).toBe('GITHUB_READ_FAILED');
    const http=await githubIssueEligibility(1165,async()=>({ok:false,status:503}),'token');
    expect(http).toEqual({eligible:false,reason:'GITHUB_HTTP_503',issueNumber:1165});
  });
  it('uses current fetched issue body instead of stale objective markers',async()=>{
    const current={state:'open',body:'TIGERIQ_EXECUTABLE=false\nOWNER_POLICY=MANUAL\nNV02_SELF_MODIFICATION_GUARD=true'};
    const result=await githubIssueEligibility(1165,async()=>({ok:true,json:async()=>current}),'token');
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('TIGERIQ_EXECUTABLE_NOT_TRUE');
  });

  it('repair prompt preserves original instruction and bounded cycle evidence',()=>{
    const p=repairInstruction({instruction:'fix X',failure:{message:'CI_GATES_FAILED'}},'CI_GATES_FAILED',2);
    expect(p).toContain('fix X');
    expect(p).toContain('AUTONOMOUS_REPAIR_CYCLE=2');
    expect(p).toContain('PREVIOUS_FAILURE=CI_GATES_FAILED');
    expect(p).toContain('Do not broaden scope');
  });
});
