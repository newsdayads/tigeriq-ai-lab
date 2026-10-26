import {describe,expect,it} from 'vitest';
import {autonomyGithubReceiptBody,backfillGithubRetryReceipts,githubIssueIsOpen,isRetryableFailure,isStaleJob,normalizeRepairFailure,repairInstruction,repairJobTitle,retryResumeIdentity,shouldRetry} from '../apps/tigeriq-coding-lane/autonomy-supervisor.mjs';

// We need to test githubIssueIsOpen or objectiveIsEligible via exported functions or by mocking fetch.
// Since githubIssueIsOpen is not exported directly, we can test it through mock fetch or test helper exports if available, or we can test handleFailed / objectiveIsEligible if exported or test logic via mock.

describe('coding title repair suffix',()=>{
  it('uses Vietnamese repair suffix without stacking old suffixes',()=>{
    expect(repairJobTitle('[P0][API] Sửa lỗi hàng đợi',2)).toBe('[P0][API] Sửa lỗi hàng đợi [sửa lần 2]');
    expect(repairJobTitle('[P0][API] Sửa lỗi hàng đợi [repair 2]',3)).toBe('[P0][API] Sửa lỗi hàng đợi [sửa lần 3]');
    expect(repairJobTitle('[P0][API] Sửa lỗi hàng đợi [sửa lần 3]',4)).toBe('[P0][API] Sửa lỗi hàng đợi [sửa lần 4]');
    expect(repairJobTitle('[P0][API] Sửa lỗi hàng đợi [repair 2] [repair 3]',4)).toBe('[P0][API] Sửa lỗi hàng đợi [sửa lần 4]');
  });
});

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


describe('coding autonomy durable GitHub receipts',()=>{
  it('formats a deterministic bounded CI repair receipt without credentials',()=>{
    const body=autonomyGithubReceiptBody({
      issueNumber:5358,sourceEventId:'42',objectiveId:'CODEOBJ-r12',sourceJobId:'CODE-old',
      retryJobId:'CODE-new',reason:'CI_GATES_FAILED',cycle:2,retryEventCount:1,
    });
    expect(body).toContain('[TIGERIQ_CODING_AUTONOMY_RECEIPT_V1]');
    expect(body).toContain('WORK_ORDER=#5358');
    expect(body).toContain('SOURCE_EVENT_ID=42');
    expect(body).toContain('SOURCE_JOB_ID=CODE-old');
    expect(body).toContain('RETRY_JOB_ID=CODE-new');
    expect(body).toContain('EVENT=CI_GATES_FAILED');
    expect(body).toContain('NO_DUPLICATE_REPAIR=true');
    expect(body).not.toContain('fake-token');
  });

  it('backfills one historical CI retry receipt and records durable acknowledgement',async()=>{
    process.env.TIGERIQ_GITHUB_TOKEN='fake-token';
    const emitted=[];
    const db={async query(sql,params=[]){
      if(sql.includes("select e.id,e.payload,o.objective"))return {rows:[{
        id:'42',
        payload:{objectiveId:'CODEOBJ-r12',sourceJobId:'CODE-old',retryJobId:'CODE-new',reason:'CI_GATES_FAILED',cycle:2},
        objective:'GitHub autonomous coding issue #5358 — R12 canary',
      }]};
      if(sql.includes("select count(*)::int n from tigeriq_coding_watchdog_events"))return {rows:[{n:1}]};
      if(sql.startsWith('insert into tigeriq_coding_watchdog_events')){
        emitted.push({kind:params[0],payload:JSON.parse(params[1])});
        return {rows:[],rowCount:1};
      }
      throw new Error('UNEXPECTED_SQL:'+sql);
    }};
    const firstSql=[];
    const originalQuery=db.query.bind(db);
    db.query=async(sql,params=[])=>{firstSql.push(sql);return originalQuery(sql,params);};
    const calls=[];
    const fetchMock=async(url,options={})=>{
      calls.push({url,options});
      if(!options.method)return {ok:true,status:200,json:async()=>[]};
      return {ok:true,status:201,json:async()=>({html_url:'https://github.com/newsdayads/tigeriq-ai-lab/issues/5358#issuecomment-1'})};
    };
    await expect(backfillGithubRetryReceipts(db,{fetchImpl:fetchMock})).resolves.toEqual({posted:1,existing:0,failed:0});
    expect(firstSql[0]).toContain('order by e.id desc');
    const post=calls.find(x=>x.options.method==='POST');
    expect(post).toBeTruthy();
    const payload=JSON.parse(post.options.body);
    expect(payload.body).toContain('SOURCE_EVENT_ID=42');
    expect(payload.body).toContain('NO_DUPLICATE_REPAIR=true');
    expect(emitted.some(x=>x.kind==='GITHUB_RECEIPT_POSTED'&&x.payload.sourceEventId==='42')).toBe(true);
    expect(JSON.stringify(emitted)).not.toContain('fake-token');
  });

  it('does not duplicate an already-posted GitHub receipt',async()=>{
    process.env.TIGERIQ_GITHUB_TOKEN='fake-token';
    const emitted=[];
    const db={async query(sql,params=[]){
      if(sql.includes("select e.id,e.payload,o.objective"))return {rows:[{
        id:'43',
        payload:{objectiveId:'CODEOBJ-r12',sourceJobId:'CODE-old',retryJobId:'CODE-new',reason:'CI_GATES_FAILED',cycle:2},
        objective:'GitHub autonomous coding issue #5358',
      }]};
      if(sql.includes("select count(*)::int n from tigeriq_coding_watchdog_events"))return {rows:[{n:1}]};
      if(sql.startsWith('insert into tigeriq_coding_watchdog_events')){
        emitted.push({kind:params[0],payload:JSON.parse(params[1])});return {rows:[],rowCount:1};
      }
      throw new Error('UNEXPECTED_SQL:'+sql);
    }};
    let posts=0;
    const fetchMock=async(_url,options={})=>{
      if(options.method==='POST'){posts++;return {ok:true,status:201,json:async()=>({})};}
      return {ok:true,status:200,json:async()=>[{body:'[TIGERIQ_CODING_AUTONOMY_RECEIPT_V1]\nSOURCE_EVENT_ID=43',html_url:'https://example.test/existing'}]};
    };
    await expect(backfillGithubRetryReceipts(db,{fetchImpl:fetchMock})).resolves.toEqual({posted:0,existing:1,failed:0});
    expect(posts).toBe(0);
    expect(emitted.some(x=>x.kind==='GITHUB_RECEIPT_POSTED'&&x.payload.existing===true)).toBe(true);
  });

  it('fails open when GitHub comment delivery fails and records a durable error event',async()=>{
    process.env.TIGERIQ_GITHUB_TOKEN='fake-token';
    const emitted=[];
    const db={async query(sql,params=[]){
      if(sql.includes("select e.id,e.payload,o.objective"))return {rows:[{
        id:'44',
        payload:{objectiveId:'CODEOBJ-r12',sourceJobId:'CODE-old',retryJobId:'CODE-new',reason:'CI_GATES_FAILED',cycle:2},
        objective:'GitHub autonomous coding issue #5358',
      }]};
      if(sql.includes("select count(*)::int n from tigeriq_coding_watchdog_events"))return {rows:[{n:1}]};
      if(sql.startsWith('insert into tigeriq_coding_watchdog_events')){
        emitted.push({kind:params[0],payload:JSON.parse(params[1])});return {rows:[],rowCount:1};
      }
      throw new Error('UNEXPECTED_SQL:'+sql);
    }};
    const fetchMock=async(_url,options={})=>options.method==='POST'
      ? {ok:false,status:503,json:async()=>({})}
      : {ok:true,status:200,json:async()=>[]};
    await expect(backfillGithubRetryReceipts(db,{fetchImpl:fetchMock})).resolves.toEqual({posted:0,existing:0,failed:1});
    expect(emitted.some(x=>x.kind==='GITHUB_RECEIPT_FAILED'&&x.payload.reason==='GITHUB_COMMENT_HTTP_503')).toBe(true);
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
    const fetchMock=async()=>({ok:true,json:async()=>({state:'closed',body:'TIGERIQ_EXECUTABLE=true\nOWNER_POLICY=AUTO\nPRIORITY=P2\nAUTO_QUEUE=INCLUDED'})});
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
    const fetchValidMock=async()=>({ok:true,json:async()=>({state:'open',body:'TIGERIQ_EXECUTABLE=true\nOWNER_POLICY=AUTO\nPRIORITY=P2\nAUTO_QUEUE=INCLUDED'})});
    expect(await githubIssueIsOpen(123,fetchValidMock)).toBe(true);
  });

  it('uses only the current GitHub contract, not historical authorizations or denials',async()=>{
    process.env.TIGERIQ_GITHUB_TOKEN='fake-token';
    const issue=body=>({ok:true,json:async()=>({state:'open',title:'[P2] News',body})});
    const current=['## OWNER — CURRENT','PRIORITY=P2','OWNER_POLICY=AUTO','TIGERIQ_EXECUTABLE=false','AUTO_QUEUE=EXCLUDED_WAIT_REVIEW'].join('\n');
    const history=['## HISTORICAL','OWNER_POLICY=AUTO','TIGERIQ_EXECUTABLE=true','AUTO_QUEUE=INCLUDED','PRIORITY=P1'].join('\n');
    expect(await githubIssueIsOpen(4456,async()=>issue(current+'\n'+history))).toBe(false);
    const ready=['## OWNER — CURRENT','PRIORITY=P2','OWNER_POLICY=AUTO','TIGERIQ_EXECUTABLE=true','AUTO_QUEUE=INCLUDED'].join('\n');
    expect(await githubIssueIsOpen(4456,async()=>issue(ready+'\n## HISTORY\nTIGERIQ_EXECUTABLE=false'))).toBe(true);
  });
  it('rejects P0 and blocked work even with stale permission labels',async()=>{
    process.env.TIGERIQ_GITHUB_TOKEN='fake-token';
    const allow=['## OWNER','PRIORITY=P0','OWNER_POLICY=AUTO','TIGERIQ_EXECUTABLE=true','AUTO_QUEUE=INCLUDED'].join('\n');
    expect(await githubIssueIsOpen(4902,async()=>({ok:true,json:async()=>({state:'open',title:'[P0] core',body:allow})}))).toBe(false);
    const blocked=allow.replace('PRIORITY=P0','PRIORITY=P2')+'\nCURRENT_STATE=BLOCKED_WAIT_REVIEW';
    expect(await githubIssueIsOpen(4902,async()=>({ok:true,json:async()=>({state:'open',title:'[P2] core',body:blocked,labels:[{name:'TIGERIQ_EXECUTABLE=true'}]})}))).toBe(false);
  });

});
