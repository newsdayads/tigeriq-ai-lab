import {describe,expect,it} from 'vitest';
import {githubIssueIsOpen,isRetryableFailure,isStaleJob,normalizeRepairFailure,repairInstruction,retryResumeIdentity,shouldRetry} from '../apps/tigeriq-coding-lane/autonomy-supervisor.mjs';

// We need to test githubIssueIsOpen or objectiveIsEligible via exported functions or by mocking fetch.
// Since githubIssueIsOpen is not exported directly, we can test it through mock fetch or test helper exports if available, or we can test handleFailed / objectiveIsEligible if exported or test logic via mock.

describe('coding autonomy supervisor repair policy',()=>{
  it('normalizes known repairable failures',()=>{
    expect(normalizeRepairFailure('REVIEW_CHANGES_UNRESOLVED')).toBe('REVIEW_CHANGES_UNRESOLVED');
    expect(normalizeRepairFailure('CI_GATE_REPAIR_EXHAUSTED: x')).toBe('CI_GATES_FAILED');
    expect(normalizeRepairFailure('CODING_COMPACT_EDIT_OLD_NOT_FOUND')).toBe('CODING_COMPACT_EDIT_OLD_NOT_FOUND');
    expect(normalizeRepairFailure('STALL_TIMEOUT')).toBe('STALL_TIMEOUT');
  });
  it('retries only bounded known repair classes',()=>{
    for(const code of ['CI_GATES_FAILED','CI_GATES_TIMEOUT','REVIEW_CHANGES_UNRESOLVED','STALL_TIMEOUT','OUTPUT_CONTRACT_EXHAUSTED','CODING_COMPACT_EDIT_INVALID','CODING_COMPACT_EDITS_COUNT_INVALID','CODING_COMPACT_EDIT_OLD_NOT_FOUND','CODING_COMPACT_EDIT_OLD_NOT_UNIQUE']){
      expect(isRetryableFailure(code)).toBe(true);
    }
    for(const code of ['SECURITY_BLOCK','AUTH_REQUIRED','CREDENTIAL_MISSING','UNKNOWN_FAILURE'])expect(isRetryableFailure(code)).toBe(false);
    expect(shouldRetry(1,3)).toBe(true);
    expect(shouldRetry(3,3)).toBe(false);
  });
  it('preserves existing PR identity across bounded repair jobs',()=>{
    expect(retryResumeIdentity({branch:'tigeriq/nv12/job',pr_number:1267,head_sha:'abc'})).toEqual({branch:'tigeriq/nv12/job',prNumber:1267,headSha:'abc'});
    expect(retryResumeIdentity({branch:'',pr_number:1267})).toEqual({branch:null,prNumber:null,headSha:null});
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
    const existing=repairInstruction({instruction:'fix Y',branch:'tigeriq/nv12/job',pr_number:1267,failure:{}},'OUTPUT_CONTRACT_EXHAUSTED',3);
    expect(existing).toContain('existing PR #1267 branch');
  });
});

describe('coding autonomy supervisor GitHub issue eligibility checks',()=>{
  it('returns false when token or issueNumber is missing',async()=>{
    expect(await githubIssueIsOpen(null)).toBe(false);
  });

  it('returns false on fetch failure',async()=>{
    process.env.TIGERIQ_GITHUB_TOKEN='fake-token';
    const fetchMock=async()=>{
      throw new Error('Network error');
    };
    expect(await githubIssueIsOpen(123,fetchMock)).toBe(false);
  });

  it('returns false when issue is closed or is a pull request',async()=>{
    process.env.TIGERIQ_GITHUB_TOKEN='fake-token';
    const fetchMock=async()=>({ok:true,json:async()=>({state:'closed',body:'TIGERIQ_EXECUTABLE=true OWNER_POLICY=AUTO'})});
    expect(await githubIssueIsOpen(123,fetchMock)).toBe(false);

    const fetchPrMock=async()=>({ok:true,json:async()=>({state:'open',pull_request:{},body:'TIGERIQ_EXECUTABLE=true OWNER_POLICY=AUTO'})});
    expect(await githubIssueIsOpen(123,fetchPrMock)).toBe(false);
  });

  it('returns false when self-mod guard or manual hold is present',async()=>{
    process.env.TIGERIQ_GITHUB_TOKEN='fake-token';
    const fetchGuardMock=async()=>({ok:true,json:async()=>({state:'open',body:'TIGERIQ_EXECUTABLE=true OWNER_POLICY=AUTO NV02_SELF_MODIFICATION_GUARD'})});
    expect(await githubIssueIsOpen(123,fetchGuardMock)).toBe(false);

    const fetchHoldMock=async()=>({ok:true,json:async()=>({state:'open',body:'TIGERIQ_EXECUTABLE=true OWNER_POLICY=AUTO MANUAL_HOLD'})});
    expect(await githubIssueIsOpen(123,fetchHoldMock)).toBe(false);
  });

  it('returns false when TIGERIQ_EXECUTABLE is false or missing',async()=>{
    process.env.TIGERIQ_GITHUB_TOKEN='fake-token';
    const fetchFalseMock=async()=>({ok:true,json:async()=>({state:'open',body:'TIGERIQ_EXECUTABLE=false OWNER_POLICY=AUTO'})});
    expect(await githubIssueIsOpen(123,fetchFalseMock)).toBe(false);

    const fetchMissingMock=async()=>({ok:true,json:async()=>({state:'open',body:'OWNER_POLICY=AUTO'})});
    expect(await githubIssueIsOpen(123,fetchMissingMock)).toBe(false);
  });

  it('returns true for valid open auto issue with executable true and owner policy auto',async()=>{
    process.env.TIGERIQ_GITHUB_TOKEN='fake-token';
    const fetchValidMock=async()=>({ok:true,json:async()=>({state:'open',body:'TIGERIQ_EXECUTABLE=true OWNER_POLICY=AUTO'})});
    expect(await githubIssueIsOpen(123,fetchValidMock)).toBe(true);
  });
});
