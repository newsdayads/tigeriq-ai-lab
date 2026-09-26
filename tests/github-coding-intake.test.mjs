import {describe,expect,it} from 'vitest';
import {classifyCodingBlocker,codingScopesOverlap,codingSourceRevision,codingSourceTruthRevision,extractCodingDependencies,materializeGithubCodingIssues,parseCodingIssue,shouldRearmRecoverableFinal,syncGithubCodingOutcomes} from '../apps/tigeriq-core/github-coding-intake.mjs';

function issue(body,extra={}){
  return {number:777,title:'Safe autonomous coding task',body,state:'open',html_url:'https://github.com/newsdayads/tigeriq-ai-lab/issues/777',...extra};
}

const SAFE=`TIGERIQ_EXECUTABLE=true
OWNER_POLICY=AUTO
AUTONOMOUS_CODE=true
ZERO_COST=true
NO_PC01_SHELL=true
NO_PAID_COST=true
NO_CREDENTIAL_CHANGE=true
NO_DESTRUCTIVE=true
NO_PRODUCTION_RELEASE=true
NO_BROWSER_AUTH=true
NO_DIRECT_MAIN=true
PRIORITY=P1`;


const V1_COMPLETE=`${SAFE}
EXECUTION_POLICY=#1456
ACTIVE_EXECUTION=true
CANONICAL_SPEC=#1456
RESOURCE_SCOPE=EXECUTION_CONTRACT_TEST
MUTATION_OWNER=NV12

## GOAL
Test one bounded mutation contract.

## CURRENT_STATE
READY.

## IN_SCOPE
- test fixture

## OUT_OF_SCOPE
- everything else

## NON_NEGOTIABLE_RULES
- one mutation owner

## DEPENDENCIES
- #1456

## EXECUTION_ORDER
1. parse

## ACCEPTANCE
Parser accepts only complete active V1 contracts.

## RECOVERY_RULE
Fail closed.

## STOP_CONDITIONS
DONE_WITH_EVIDENCE

## EVIDENCE_FORMAT
test result
`;

function fakePool(){
  const events=[];
  return {events,async query(q,params=[]){
    if(q.includes("from tigeriq_events where type='GITHUB_CODING_DISPATCHED'")){
      const dispatches=events.filter(e=>e.type==='GITHUB_CODING_DISPATCHED');
      if(q.includes('not exists')){
        const latest=[...dispatches].reverse()[0];
        const final=latest&&events.some(r=>String(r.data.issueNumber)===String(latest.data.issueNumber)&&(r.type==='GITHUB_CODING_BLOCKED_FINAL'||(r.type==='GITHUB_CODING_RESULT_REPORTED'&&String(r.data.status||'').toLowerCase()==='completed')));
        const active=Boolean(latest)&&!final;
        return {rowCount:active?1:0,rows:active?[{one:1}]:[]};
      }
      if(q.includes('distinct on')){
        const latestByIssue=new Map();
        for(const e of dispatches)latestByIssue.set(String(e.data.issueNumber),e);
        const rows=[...latestByIssue.values()].reverse().map(e=>({data:e.data}));
        return {rowCount:rows.length,rows};
      }
      const rows=[...dispatches].reverse().slice(0,100).map(e=>({data:e.data}));
      return {rowCount:rows.length,rows};
    }
    if(q.includes("select data from tigeriq_events where type=$1 and data->>'issueNumber'=$2")){
      const rows=[...events].reverse().filter(e=>e.type===params[0]&&String(e.data.issueNumber)===String(params[1])).slice(0,100).map(e=>({data:e.data}));
      return {rowCount:rows.length,rows};
    }
    if(q.includes('select 1 from tigeriq_events'))return {rowCount:events.some(e=>e.type===params[0]&&String(e.data.issueNumber)===String(params[1]))?1:0,rows:[]};
    if(q.includes('insert into tigeriq_events')){events.push({type:params[0],data:JSON.parse(params[1])});return {rowCount:1,rows:[]};}
    return {rowCount:0,rows:[]};
  }};
}

function response(data,ok=true,status=200){return {ok,status,text:async()=>JSON.stringify(data)};}

describe('GitHub coding scope concurrency',()=>{
  it('treats generic tests root as non-colliding across distinct resource scopes',()=>{
    const api={resourceScope:'NV10_API_DOCTOR_SUPERVISOR',paths:['apps/tigeriq-core','tests'],ambiguous:false};
    const lane={resourceScope:'CODING_LANE_PATCH_CONTRACT_V2',paths:['apps/tigeriq-coding-lane','tests'],ambiguous:false};
    expect(codingScopesOverlap(api,lane)).toBe(false);
    expect(codingScopesOverlap(api,{...lane,paths:['apps/tigeriq-core','tests']})).toBe(true);
    expect(codingScopesOverlap(api,{resourceScope:'OTHER',paths:['tests'],ambiguous:false})).toBe(false);
    expect(codingScopesOverlap(api,{...api})).toBe(true);
    expect(codingScopesOverlap(api,{resourceScope:'X',paths:[],ambiguous:true})).toBe(true);
  });
});

describe('GitHub coding intake guard',()=>{
  it('accepts only explicit safe autonomous coding issues',()=>{
    const parsed=parseCodingIssue(issue(SAFE));
    expect(parsed?.number).toBe(777);
    expect(parsed?.priority).toBe('P1');
    expect(parsed?.dependsOn).toEqual([]);
  });
  it('keeps legacy safe coding issues backward compatible',()=>{expect(parseCodingIssue(issue(SAFE))?.number).toBe(777);});
  it('rejects REVIEW_ONLY work from mutation coding intake',()=>{expect(parseCodingIssue(issue(`${SAFE}\nREVIEW_ONLY=true`))).toBeNull();});
  it('rejects V1 canonical or non-active work from mutation coding intake',()=>{
    expect(parseCodingIssue(issue(V1_COMPLETE.replace('ACTIVE_EXECUTION=true','ACTIVE_EXECUTION=false')))).toBeNull();
    expect(parseCodingIssue(issue(V1_COMPLETE.replace('CANONICAL_SPEC=#1456','CANONICAL_SPEC=true')))).toBeNull();
  });
  it('accepts a complete V1 ACTIVE_EXECUTION contract',()=>{expect(parseCodingIssue(issue(V1_COMPLETE))?.number).toBe(777);});
  it('rejects an incomplete V1 ACTIVE_EXECUTION contract',()=>{expect(parseCodingIssue(issue(V1_COMPLETE.replace('## DEPENDENCIES','## DEPENDENCIES_MISSING')))).toBeNull();});
  it('fails closed when a required guard is missing',()=>{expect(parseCodingIssue(issue(SAFE.replace('NO_DIRECT_MAIN=true','')))).toBeNull();});
  it('ignores pull requests and closed issues',()=>{
    expect(parseCodingIssue(issue(SAFE,{pull_request:{}}))).toBeNull();
    expect(parseCodingIssue(issue(SAFE,{state:'closed'}))).toBeNull();
  });
});

describe('GitHub coding intake dependencies',()=>{
  it('parses authoritative #N and plain N dependency syntax',()=>{
    expect(extractCodingDependencies('DEPENDS_ON=#677, 681,#677')).toEqual([677,681]);
    expect(parseCodingIssue(issue(`${SAFE}\nDEPENDS_ON=#677`))?.dependsOn).toEqual([677]);
  });

  it('blocks dispatch while any dependency is open and records one wait marker',async()=>{
    const pool=fakePool();let posted=0;
    const downstream=issue(`${SAFE}\nDEPENDS_ON=#677`,{number:700});
    const fetchImpl=async(url)=>{
      if(url.includes('/issues?'))return response([downstream]);
      if(url.includes('/issues/677'))return response({number:677,state:'open'});
      if(url.includes('/api/objectives')){posted++;return response({id:'unexpected'});}
      return response({});
    };
    expect((await materializeGithubCodingIssues({pool,fetchImpl,token:'fake'})).created).toBe(0);
    expect(posted).toBe(0);
    expect(pool.events.filter(e=>e.type==='GITHUB_CODING_DEPENDENCY_WAIT')).toHaveLength(1);
    await materializeGithubCodingIssues({pool,fetchImpl,token:'fake'});
    expect(pool.events.filter(e=>e.type==='GITHUB_CODING_DEPENDENCY_WAIT')).toHaveLength(1);
  });

  it('fails closed when dependency lookup fails',async()=>{
    const pool=fakePool();let posted=0;
    const downstream=issue(`${SAFE}\nDEPENDS_ON=#677`,{number:701});
    const fetchImpl=async(url)=>{
      if(url.includes('/issues?'))return response([downstream]);
      if(url.includes('/issues/677'))return response({message:'boom'},false,503);
      if(url.includes('/api/objectives')){posted++;return response({id:'unexpected'});}
      return response({});
    };
    expect((await materializeGithubCodingIssues({pool,fetchImpl,token:'fake'})).created).toBe(0);
    expect(posted).toBe(0);
    expect(pool.events[0]?.data.reason).toBe('DEPENDENCY_LOOKUP_FAILED');
  });

  it('dispatches exactly once after all dependencies are closed',async()=>{
    const pool=fakePool();let posted=0;
    const downstream=issue(`${SAFE}\nDEPENDS_ON=#677,681`,{number:702});
    const fetchImpl=async(url)=>{
      if(url.includes('/issues?'))return response([downstream]);
      if(url.includes('/issues/677')||url.includes('/issues/681'))return response({state:'closed'});
      if(url.includes('/api/objectives')){posted++;return response({id:'obj-702'});}
      if(url.includes('/comments'))return response({});
      return response({});
    };
    expect((await materializeGithubCodingIssues({pool,fetchImpl,token:'fake'})).created).toBe(1);
    expect((await materializeGithubCodingIssues({pool,fetchImpl,token:'fake'})).created).toBe(0);
    expect(posted).toBe(1);
  });
});

describe('GitHub coding continuity supervisor',()=>{
  it('does not let a legacy blocked result marker suppress recovery or mark the lane free',async()=>{
    const pool=fakePool();let posted=0;
    pool.events.push(
      {type:'GITHUB_CODING_DISPATCHED',data:{issueNumber:799,codingObjectiveId:'obj-799'}},
      {type:'GITHUB_CODING_RESULT_REPORTED',data:{issueNumber:799,codingObjectiveId:'obj-799',status:'blocked'}}
    );
    const current=issue(SAFE,{number:799});
    const fetchImpl=async(url)=>{
      if(url.includes('/api/status'))return response({objectives:[{id:'obj-799',status:'blocked',summary:'CODING_COMPACT_EDIT_INVALID'}],jobs:[]});
      if(url.includes('/api/objectives')){posted++;return response({id:'obj-799-retry'});}
      if(url.includes('/issues?'))return response([issue(SAFE,{number:900})]);
      if(url.includes('/issues/799'))return response(current);
      if(url.includes('/comments'))return response({});
      return response({});
    };
    await syncGithubCodingOutcomes({pool,fetchImpl,token:'fake',now:()=>1000});
    expect(posted).toBe(1);
    expect(pool.events.filter(e=>e.type==='GITHUB_CODING_RETRY_DISPATCHED')).toHaveLength(1);
    const materialized=await materializeGithubCodingIssues({pool,fetchImpl,token:'fake'});
    expect(materialized).toMatchObject({created:1,active:0});
    expect(posted).toBe(2);
    expect(pool.events.some(e=>e.type==='GITHUB_CODING_DISPATCHED'&&e.data.issueNumber===900)).toBe(true);
  });

  it('classifies compact/output failures as recoverable and policy/security as hard',()=>{
    expect(classifyCodingBlocker('CODING_COMPACT_EDIT_INVALID').kind).toBe('RECOVERABLE');
    expect(classifyCodingBlocker('CODING_COMPACT_REPAIR_MULTI_FILE_INVALID').kind).toBe('RECOVERABLE');
    expect(classifyCodingBlocker('HTTP_429 provider rate limit')).toMatchObject({kind:'RECOVERABLE',transient:true});
    expect(classifyCodingBlocker('AI_RESOURCES_UNAVAILABLE')).toMatchObject({kind:'RECOVERABLE',transient:true});
    expect(classifyCodingBlocker('manager decision exhausted after bounded retry/failover')).toMatchObject({kind:'RECOVERABLE',transient:true});
    expect(classifyCodingBlocker('reason for blocking')).toMatchObject({kind:'RECOVERABLE',transient:false});
    expect(classifyCodingBlocker('unclassified manager response')).toMatchObject({kind:'RECOVERABLE',transient:false});
    expect(classifyCodingBlocker('SECURITY POLICY_BLOCK requires human')).toMatchObject({kind:'HARD',transient:false});
  });

  it('reclassifies a legacy HARD_BLOCKER final when its terminal reason is now recoverable',async()=>{
    const pool=fakePool();let posted=0,nowMs=1000000;
    pool.events.push(
      {type:'GITHUB_CODING_DISPATCHED',data:{issueNumber:1053,codingObjectiveId:'old-1053'}},
      {type:'GITHUB_CODING_BLOCKED_FINAL',data:{issueNumber:1053,codingObjectiveId:'old-1053',status:'blocked',reason:'HARD_BLOCKER',terminalReason:'AI_RESOURCES_UNAVAILABLE'}}
    );
    const current=issue(`${SAFE}\nOWNER_DIRECT=true\nRESOURCE_SCOPE=LEGACY_TRANSIENT\nALLOW_PATH_PREFIX=docs/evidence/legacy-transient.md`,{number:1053,title:'Legacy transient final'});
    const fetchImpl=async(url)=>{
      if(url.includes('/api/status'))return response({objectives:[{id:'old-1053',status:'blocked',summary:'AI_RESOURCES_UNAVAILABLE'}],jobs:[]});
      if(url.includes('/api/objectives')){posted++;return response({id:'retry-1053'});}
      if(url.includes('/issues/1053'))return response(current);
      if(url.includes('/comments'))return response({});
      return response({});
    };
    await syncGithubCodingOutcomes({pool,fetchImpl,token:'fake',now:()=>nowMs});
    expect(posted).toBe(0);
    expect(pool.events.filter(e=>e.type==='GITHUB_CODING_BLOCKED_FINAL_RECLASSIFIED')).toHaveLength(1);
    expect(pool.events.filter(e=>e.type==='GITHUB_CODING_RETRY_SCHEDULED')).toHaveLength(1);
    nowMs+=60000;
    await syncGithubCodingOutcomes({pool,fetchImpl,token:'fake',now:()=>nowMs});
    expect(posted).toBe(1);
    expect(pool.events.filter(e=>e.type==='GITHUB_CODING_BLOCKED_FINAL_RECLASSIFIED')).toHaveLength(1);
    expect(pool.events.filter(e=>e.type==='GITHUB_CODING_RETRY_DISPATCHED')).toHaveLength(1);
  });

  it('retries the same blocked issue, completes it, then releases and dispatches its dependent child',async()=>{
    const pool=fakePool();
    pool.events.push({type:'GITHUB_CODING_DISPATCHED',data:{issueNumber:705,codingObjectiveId:'obj-705'}});
    pool.events.push({type:'GITHUB_CODING_DEPENDENCY_WAIT',data:{issueNumber:706,dependsOn:[705],reason:'DEPENDENCY_OPEN'}});
    const parent=issue(SAFE.replace('PRIORITY=P1','PRIORITY=P0'),{number:705,title:'Parent continuity fix'});
    const child=issue(`${SAFE}\nDEPENDS_ON=#705`,{number:706,title:'Dependent follow-up'});
    let phase=0,closed=false;
    const posts=[];
    const fetchImpl=async(url,init={})=>{
      if(url.includes('/api/status')){
        const objectives=phase===0
          ?[{id:'obj-705',status:'blocked',summary:'CODING_COMPACT_REPAIR_MULTI_FILE_INVALID'}]
          :[{id:'obj-705',status:'blocked',summary:'CODING_COMPACT_REPAIR_MULTI_FILE_INVALID'},{id:'obj-retry-705',status:'completed',summary:'Merged PR #123'}];
        return response({objectives,jobs:[]});
      }
      if(url.includes('/api/objectives')){
        const body=JSON.parse(init.body);
        posts.push(body.objective);
        return response({id:body.objective.includes('#706')?'obj-child-706':'obj-retry-705'});
      }
      if(url.includes('/issues?'))return response([child]);
      if(url.includes('/issues/705')){
        if(init.method==='PATCH'){closed=true;return response({number:705,state:'closed'});}
        return response({...parent,state:closed?'closed':'open'});
      }
      if(url.includes('/comments')||url.includes('/issues/706'))return response({});
      return response({});
    };

    await syncGithubCodingOutcomes({pool,fetchImpl,token:'fake',now:()=>1000});
    expect(pool.events.filter(e=>e.type==='GITHUB_CODING_RETRY_SCHEDULED')).toHaveLength(1);
    expect(pool.events.filter(e=>e.type==='GITHUB_CODING_RETRY_DISPATCHED')).toHaveLength(1);
    expect(posts[0]).toContain('SOURCE_BASE=CURRENT_MAIN');
    expect(posts[0]).toContain('PRIOR_OBJECTIVE_ID=obj-705');

    phase=1;
    await syncGithubCodingOutcomes({pool,fetchImpl,token:'fake',now:()=>1000});
    expect(closed).toBe(true);
    expect(pool.events.filter(e=>e.type==='GITHUB_CODING_RESULT_REPORTED')).toHaveLength(1);

    const next=await materializeGithubCodingIssues({pool,fetchImpl,token:'fake'});
    expect(next.created).toBe(1);
    expect(posts.some(text=>text.includes('#706'))).toBe(true);
    expect(pool.events.filter(e=>e.type==='GITHUB_DEPENDENCY_RELEASED')).toHaveLength(1);
  });

  it('reconciles transient blocked dispatches even when their marker is older than 100 unrelated dispatch events',async()=>{
    const pool=fakePool();
    pool.events.push({type:'GITHUB_CODING_DISPATCHED',data:{issueNumber:1053,codingObjectiveId:'old-1053'}});
    for(let n=2000;n<2110;n++)pool.events.push({type:'GITHUB_CODING_DISPATCHED',data:{issueNumber:n,codingObjectiveId:`noise-${n}`}});
    const target=issue(`${SAFE}\nOWNER_DIRECT=true\nRESOURCE_SCOPE=OLD_TRANSIENT\nALLOW_PATH_PREFIX=docs/evidence/old-transient.md`,{number:1053,title:'Old transient retry'});
    const fetchImpl=async(url,init={})=>{
      if(url.includes('/api/status'))return response({objectives:[{id:'old-1053',status:'blocked',summary:'AI_RESOURCES_UNAVAILABLE'}],jobs:[]});
      if(url.includes('/api/objectives')){
        const body=JSON.parse(init.body);
        expect(body.objective).toContain('RETRY_KEY=GITHUB-ISSUE-1053-RETRY-1');
        return response({id:'retry-1053'});
      }
      if(url.includes('/issues/1053'))return response(target);
      if(url.includes('/comments'))return response({});
      return response({});
    };
    const out=await syncGithubCodingOutcomes({pool,fetchImpl,token:'fake',now:()=>Date.parse('2026-09-19T07:30:00Z')});
    expect(out.results).toBeGreaterThanOrEqual(1);
    expect(pool.events.some(e=>e.type==='GITHUB_CODING_RETRY_SCHEDULED'&&e.data.issueNumber===1053)).toBe(true);
  });

  it('backs off provider 429 and dispatches only after next-at gate',async()=>{
    const pool=fakePool();
    pool.events.push({type:'GITHUB_CODING_DISPATCHED',data:{issueNumber:800,codingObjectiveId:'obj-800'}});
    const current=issue(SAFE,{number:800});
    let nowMs=1000000,posted=0;
    const fetchImpl=async(url,init={})=>{
      if(url.includes('/api/status'))return response({objectives:[{id:'obj-800',status:'blocked',summary:'HTTP_429 provider rate limit'}],jobs:[]});
      if(url.includes('/api/objectives')){posted++;return response({id:'obj-800-retry'});}
      if(url.includes('/issues/800'))return response(current);
      if(url.includes('/comments'))return response({});
      return response({});
    };
    await syncGithubCodingOutcomes({pool,fetchImpl,token:'fake',now:()=>nowMs});
    expect(posted).toBe(0);
    await syncGithubCodingOutcomes({pool,fetchImpl,token:'fake',now:()=>nowMs+59999});
    expect(posted).toBe(0);
    nowMs+=60000;
    await syncGithubCodingOutcomes({pool,fetchImpl,token:'fake',now:()=>nowMs});
    expect(posted).toBe(1);
    expect(pool.events.filter(e=>e.type==='GITHUB_CODING_RETRY_DISPATCHED')).toHaveLength(1);
  });

  it('fails closed for hard blockers without retry',async()=>{
    const pool=fakePool();
    pool.events.push({type:'GITHUB_CODING_DISPATCHED',data:{issueNumber:801,codingObjectiveId:'obj-801'}});
    const current=issue(SAFE,{number:801});
    let posted=0;
    const fetchImpl=async(url)=>{
      if(url.includes('/api/status'))return response({objectives:[{id:'obj-801',status:'blocked',summary:'SECURITY POLICY_BLOCK requires human decision'}],jobs:[]});
      if(url.includes('/api/objectives')){posted++;return response({id:'unexpected'});}
      if(url.includes('/issues/801'))return response(current);
      if(url.includes('/comments'))return response({});
      return response({});
    };
    await syncGithubCodingOutcomes({pool,fetchImpl,token:'fake'});
    expect(posted).toBe(0);
    expect(pool.events.filter(e=>e.type==='GITHUB_CODING_BLOCKED_FINAL')[0]?.data.reason).toBe('HARD_BLOCKER');
  });

  it('re-arms a recoverable exhausted issue only after relevant main or source changes',async()=>{
    const pool=fakePool();let posted=0;
    const current=issue(`${SAFE}\nALLOW_PATH_PREFIX=tests/github-coding-intake.test.mjs`,{number:804});
    const currentRevision=codingSourceTruthRevision(current,[]);
    pool.events.push(
      {type:'GITHUB_CODING_DISPATCHED',data:{issueNumber:804,codingObjectiveId:'obj-804-r2'}},
      {type:'GITHUB_CODING_RETRY_DISPATCHED',data:{issueNumber:804,codingObjectiveId:'obj-804-r1',retryAttempt:1}},
      {type:'GITHUB_CODING_RETRY_DISPATCHED',data:{issueNumber:804,codingObjectiveId:'obj-804-r2',retryAttempt:2}},
      {type:'GITHUB_CODING_BLOCKED_FINAL',data:{issueNumber:804,codingObjectiveId:'obj-804-r2',status:'blocked',reason:'RETRY_BUDGET_EXHAUSTED',terminalReason:'OUTPUT_CONTRACT_EXHAUSTED',mainSha:'old-main',sourceRevision:currentRevision}}
    );
    expect(shouldRearmRecoverableFinal(pool.events.at(-1).data,'new-main',[])).toBe(false);
    expect(shouldRearmRecoverableFinal(pool.events.at(-1).data,'new-main',[],'',true)).toBe(true);
    expect(shouldRearmRecoverableFinal({issueNumber:804,codingObjectiveId:'legacy',reason:'HARD_BLOCKER',terminalReason:'reason for blocking',mainSha:'old-main'},'new-main',[])).toBe(false);
    expect(shouldRearmRecoverableFinal({issueNumber:804,codingObjectiveId:'legacy',reason:'HARD_BLOCKER',terminalReason:'reason for blocking',mainSha:'old-main'},'new-main',[],'',true)).toBe(true);
    expect(shouldRearmRecoverableFinal({issueNumber:804,codingObjectiveId:'legacy',reason:'HARD_BLOCKER',terminalReason:'SECURITY POLICY_BLOCK requires human',mainSha:'old-main'},'new-main',[])).toBe(false);
    expect(shouldRearmRecoverableFinal({issueNumber:804,codingObjectiveId:'legacy',reason:'ISSUE_CLOSED_OR_SUPERSEDED',mainSha:'old-main',sourceRevision:'old-revision'},'new-main',[],'new-revision')).toBe(true);
    expect(shouldRearmRecoverableFinal({issueNumber:804,codingObjectiveId:'legacy',reason:'ISSUE_CLOSED_OR_SUPERSEDED',mainSha:'new-main',sourceRevision:'new-revision'},'new-main',[],'new-revision')).toBe(false);

    const fetchImpl=async(url,init={})=>{
      if(url.includes('/api/status'))return response({objectives:[{id:'obj-804-r2',status:'blocked',summary:'OUTPUT_CONTRACT_EXHAUSTED'}],jobs:[]});
      if(url.includes('/git/ref/heads/main'))return response({object:{sha:'new-main'}});
      if(url.includes('/compare/'))return response({files:[{filename:'tests/github-coding-intake.test.mjs'}]});
      if(url.includes('/api/objectives')){posted++;const body=JSON.parse(init.body);expect(body.objective).toContain('RECOVERY_KEY=GITHUB-ISSUE-804-RECOVERY-new-main');return response({id:'obj-804-recovery'});}
      if(url.includes('/issues/804'))return response(current);
      if(url.includes('/comments'))return response({});
      return response({});
    };
    await syncGithubCodingOutcomes({pool,fetchImpl,token:'fake'});
    expect(posted).toBe(1);
    expect(pool.events.filter(e=>e.type==='GITHUB_CODING_RECOVERY_REARMED')).toHaveLength(1);
    expect(pool.events.filter(e=>e.type==='GITHUB_CODING_DISPATCHED').at(-1)?.data.codingObjectiveId).toBe('obj-804-recovery');
    expect(pool.events.filter(e=>e.type==='GITHUB_CODING_BLOCKED_FINAL')).toHaveLength(1);
  });

  it('does not rearm exhausted coding work for an unrelated main commit',async()=>{
    const pool=fakePool();let posted=0;
    const current=issue(`${SAFE}\nALLOW_PATH_PREFIX=apps/tigeriq-core/github-coding-intake.mjs`,{number:805});
    const currentRevision=codingSourceTruthRevision(current,[]);
    pool.events.push(
      {type:'GITHUB_CODING_DISPATCHED',data:{issueNumber:805,codingObjectiveId:'obj-805-r2'}},
      {type:'GITHUB_CODING_RETRY_DISPATCHED',data:{issueNumber:805,codingObjectiveId:'obj-805-r1',retryAttempt:1}},
      {type:'GITHUB_CODING_RETRY_DISPATCHED',data:{issueNumber:805,codingObjectiveId:'obj-805-r2',retryAttempt:2}},
      {type:'GITHUB_CODING_BLOCKED_FINAL',data:{issueNumber:805,codingObjectiveId:'obj-805-r2',status:'blocked',reason:'RETRY_BUDGET_EXHAUSTED',terminalReason:'OUTPUT_CONTRACT_EXHAUSTED',mainSha:'old-main',sourceRevision:currentRevision}}
    );
    const fetchImpl=async(url)=>{
      if(url.includes('/api/status'))return response({objectives:[{id:'obj-805-r2',status:'blocked',summary:'OUTPUT_CONTRACT_EXHAUSTED'}],jobs:[]});
      if(url.includes('/git/ref/heads/main'))return response({object:{sha:'new-main'}});
      if(url.includes('/compare/'))return response({files:[{filename:'apps/chrome-controller/controller.mjs'}]});
      if(url.includes('/api/objectives')){posted++;return response({id:'unexpected'});}
      if(url.includes('/issues/805'))return response(current);
      if(url.includes('/comments'))return response({});
      return response({});
    };
    await syncGithubCodingOutcomes({pool,fetchImpl,token:'fake'});
    expect(posted).toBe(0);
    expect(pool.events.filter(e=>e.type==='GITHUB_CODING_RECOVERY_REARMED')).toHaveLength(0);
  });

  it('fails closed when relevant-main compare is unavailable',async()=>{
    const pool=fakePool();let posted=0;
    const current=issue(`${SAFE}\nALLOW_PATH_PREFIX=tests/github-coding-intake.test.mjs`,{number:806});
    const currentRevision=codingSourceTruthRevision(current,[]);
    pool.events.push(
      {type:'GITHUB_CODING_DISPATCHED',data:{issueNumber:806,codingObjectiveId:'obj-806-r2'}},
      {type:'GITHUB_CODING_RETRY_DISPATCHED',data:{issueNumber:806,codingObjectiveId:'obj-806-r1',retryAttempt:1}},
      {type:'GITHUB_CODING_RETRY_DISPATCHED',data:{issueNumber:806,codingObjectiveId:'obj-806-r2',retryAttempt:2}},
      {type:'GITHUB_CODING_BLOCKED_FINAL',data:{issueNumber:806,codingObjectiveId:'obj-806-r2',status:'blocked',reason:'RETRY_BUDGET_EXHAUSTED',terminalReason:'OUTPUT_CONTRACT_EXHAUSTED',mainSha:'old-main',sourceRevision:currentRevision}}
    );
    const fetchImpl=async(url)=>{
      if(url.includes('/api/status'))return response({objectives:[{id:'obj-806-r2',status:'blocked',summary:'OUTPUT_CONTRACT_EXHAUSTED'}],jobs:[]});
      if(url.includes('/git/ref/heads/main'))return response({object:{sha:'new-main'}});
      if(url.includes('/compare/'))return response({message:'rate limited'},false,503);
      if(url.includes('/api/objectives')){posted++;return response({id:'unexpected'});}
      if(url.includes('/issues/806'))return response(current);
      if(url.includes('/comments'))return response({});
      return response({});
    };
    await syncGithubCodingOutcomes({pool,fetchImpl,token:'fake'});
    expect(posted).toBe(0);
    expect(pool.events.filter(e=>e.type==='GITHUB_CODING_RECOVERY_REARMED')).toHaveLength(0);
  });

  it('uses stable issue body + owner directive evidence for Source-of-Truth revision',()=>{
    const current=issue(SAFE,{number:809,title:'Stable source'});
    const base=codingSourceTruthRevision(current,[]);
    const progress=codingSourceTruthRevision(current,[{id:400,user:{login:'newsdayads'},body:'[PROGRESS] internal retry comment'}]);
    const owner=codingSourceTruthRevision(current,[{id:500,user:{login:'newsdayads'},body:'[OWNER_REARM] continue canonical issue'}]);
    const foreign=codingSourceTruthRevision(current,[{id:600,user:{login:'someone-else'},body:'[OWNER_REARM] not authoritative'}]);
    expect(progress).toBe(base);
    expect(foreign).toBe(base);
    expect(owner).not.toBe(base);
    expect(owner).toContain(':owner-500');
  });

  it('keeps body-only revision when pagination fails after non-authoritative comments',async()=>{
    const current=issue(SAFE,{number:810,title:'Paged source',comments:250});
    const base=codingSourceTruthRevision({...current,repository_owner:'newsdayads'},[]);
    const pages=[];
    const fetchImpl=async(url)=>{
      pages.push(url);
      if(url.includes('page=3'))return response([{id:700,user:{login:'newsdayads'},body:'[PROGRESS] not a source directive'}]);
      if(url.includes('page=2'))return response({message:'boom'},false,503);
      return response([]);
    };
    const revision=await codingSourceRevision(fetchImpl,'newsdayads','tigeriq-ai-lab','fake',current);
    expect(revision).toBe(base);
    expect(pages.some(url=>new URL(url).searchParams.get('page')==='3')).toBe(true);
    expect(pages.some(url=>new URL(url).searchParams.get('page')==='2')).toBe(true);
  });

  it('re-arms once when Source of Truth changes on the same main and stays idempotent after restart',async()=>{
    const pool=fakePool();let posted=0;
    pool.events.push(
      {type:'GITHUB_CODING_DISPATCHED',data:{issueNumber:809,codingObjectiveId:'obj-809-r2'}},
      {type:'GITHUB_CODING_RETRY_DISPATCHED',data:{issueNumber:809,codingObjectiveId:'obj-809-r1',retryAttempt:1}},
      {type:'GITHUB_CODING_RETRY_DISPATCHED',data:{issueNumber:809,codingObjectiveId:'obj-809-r2',retryAttempt:2}},
      {type:'GITHUB_CODING_BLOCKED_FINAL',data:{issueNumber:809,codingObjectiveId:'obj-809-r2',status:'blocked',reason:'RETRY_BUDGET_EXHAUSTED',terminalReason:'OUTPUT_CONTRACT_EXHAUSTED',mainSha:'same-main',sourceRevision:'old-revision'}}
    );
    const current=issue(SAFE,{number:809,title:'Canonical source',comments:329});
    const ownerDirective={id:500,user:{login:'newsdayads'},body:'[OWNER_REARM] continue canonical issue'};
    const commentPages=[];
    const sourceRevision=codingSourceTruthRevision(current,[ownerDirective]);
    const sourceKey=sourceRevision.replace(/[^0-9A-Za-z]/g,'').slice(-20)||'no-source';
    expect(shouldRearmRecoverableFinal(pool.events.at(-1).data,'same-main',[],sourceRevision)).toBe(true);
    expect(shouldRearmRecoverableFinal(pool.events.at(-1).data,'same-main',[{mainSha:'same-main',sourceRevision,priorObjectiveId:'obj-809-r2'}],sourceRevision)).toBe(false);

    let recoveryObjective=null;
    const fetchImpl=async(url,init={})=>{
      if(url.includes('/api/status'))return response({objectives:[
        {id:'obj-809-r2',status:'blocked',summary:'OUTPUT_CONTRACT_EXHAUSTED'},
        ...(recoveryObjective?[recoveryObjective]:[])
      ],jobs:[]});
      if(url.includes('/git/ref/heads/main'))return response({object:{sha:'same-main'}});
      if(url.includes('/issues/809/comments')){commentPages.push(url);return response(url.includes('page=4')?[ownerDirective]:[]);}
      if(url.includes('/api/objectives')){
        posted++;
        const body=JSON.parse(init.body);
        expect(body.objective).toContain(`SOURCE_REVISION=${sourceRevision}`);
        expect(body.objective).toContain(`RECOVERY_KEY=GITHUB-ISSUE-809-RECOVERY-same-main-${sourceKey}`);
        recoveryObjective={id:'obj-809-recovery',status:'queued',objective:body.objective};
        return response({id:recoveryObjective.id});
      }
      if(url.includes('/issues/809'))return response(current);
      if(url.includes('/comments'))return response({});
      return response({});
    };
    await syncGithubCodingOutcomes({pool,fetchImpl,token:'fake'});
    await syncGithubCodingOutcomes({pool,fetchImpl,token:'fake'});
    expect(posted).toBe(1);
    expect(commentPages.some(url=>new URL(url).searchParams.get('page')==='4')).toBe(true);
    expect(commentPages.some(url=>new URL(url).searchParams.get('page')==='1')).toBe(false);
    const rearms=pool.events.filter(e=>e.type==='GITHUB_CODING_RECOVERY_REARMED');
    expect(rearms).toHaveLength(1);
    expect(rearms[0].data).toMatchObject({mainSha:'same-main',sourceRevision,priorObjectiveId:'obj-809-r2',codingObjectiveId:'obj-809-recovery'});
    expect(pool.events.filter(e=>e.type==='GITHUB_CODING_DISPATCHED'&&e.data.issueNumber===809)).toHaveLength(2);
  });

  it('emits BLOCKED_FINAL after the retry budget is exhausted',async()=>{
    const pool=fakePool();
    pool.events.push(
      {type:'GITHUB_CODING_DISPATCHED',data:{issueNumber:802,codingObjectiveId:'obj-802-r2'}},
      {type:'GITHUB_CODING_RETRY_DISPATCHED',data:{issueNumber:802,codingObjectiveId:'obj-802-r1',retryAttempt:1}},
      {type:'GITHUB_CODING_RETRY_DISPATCHED',data:{issueNumber:802,codingObjectiveId:'obj-802-r2',retryAttempt:2}}
    );
    const current=issue(SAFE,{number:802});
    const fetchImpl=async(url)=>{
      if(url.includes('/api/status'))return response({objectives:[{id:'obj-802-r2',status:'blocked',summary:'CODING_COMPACT_EDIT_INVALID'}],jobs:[]});
      if(url.includes('/issues/802'))return response(current);
      if(url.includes('/comments'))return response({});
      return response({});
    };
    await syncGithubCodingOutcomes({pool,fetchImpl,token:'fake'});
    expect(pool.events.filter(e=>e.type==='GITHUB_CODING_BLOCKED_FINAL')[0]?.data.reason).toBe('RETRY_BUDGET_EXHAUSTED');
  });

  it('never resurrects a closed or superseded issue while retry is pending',async()=>{
    const pool=fakePool();
    pool.events.push({type:'GITHUB_CODING_DISPATCHED',data:{issueNumber:803,codingObjectiveId:'obj-803'}});
    const superseded=issue(`${SAFE}\nSTATE=SUPERSEDED`,{number:803});
    let posted=0;
    const fetchImpl=async(url)=>{
      if(url.includes('/api/status'))return response({objectives:[{id:'obj-803',status:'blocked',summary:'CODING_COMPACT_EDIT_INVALID'}],jobs:[]});
      if(url.includes('/api/objectives')){posted++;return response({id:'unexpected'});}
      if(url.includes('/issues/803'))return response(superseded);
      if(url.includes('/comments'))return response({});
      return response({});
    };
    await syncGithubCodingOutcomes({pool,fetchImpl,token:'fake'});
    expect(posted).toBe(0);
    expect(pool.events.filter(e=>e.type==='GITHUB_CODING_BLOCKED_FINAL')[0]?.data.reason).toBe('ISSUE_CLOSED_OR_SUPERSEDED');
  });

  it('ignores only stale active owners whose source issue is closed',async()=>{
    const pool=fakePool();let posted=0;
    pool.events.push({type:'GITHUB_CODING_DISPATCHED',data:{issueNumber:807,codingObjectiveId:'obj-807'}});
    const fetchImpl=async(url)=>{
      if(url.includes('/api/status'))return response({objectives:[
        {id:'obj-807',status:'blocked',summary:'CODING_COMPACT_EDIT_INVALID',objective:'GitHub autonomous coding issue #807: retry me'},
        {id:'stale-900',status:'active',objective:'GitHub bootstrap coding issue #900: already completed source'}
      ],jobs:[]});
      if(url.includes('/api/objectives')){posted++;return response({id:'obj-807-retry'});}
      if(url.includes('/issues/807'))return response(issue(SAFE,{number:807}));
      if(url.includes('/issues/900'))return response({number:900,state:'closed'});
      if(url.includes('/comments'))return response({});
      return response({});
    };
    await syncGithubCodingOutcomes({pool,fetchImpl,token:'fake',now:()=>1000});
    expect(posted).toBe(1);
    expect(pool.events.filter(e=>e.type==='GITHUB_CODING_STALE_OWNER_IGNORED')).toHaveLength(1);
    expect(pool.events.find(e=>e.type==='GITHUB_CODING_STALE_OWNER_IGNORED')?.data.issueNumber).toBe(900);
  });

  it('keeps an open active source issue as a valid mutation owner',async()=>{
    const pool=fakePool();let posted=0;
    pool.events.push({type:'GITHUB_CODING_DISPATCHED',data:{issueNumber:808,codingObjectiveId:'obj-808'}});
    const fetchImpl=async(url)=>{
      if(url.includes('/api/status'))return response({objectives:[
        {id:'obj-808',status:'blocked',summary:'CODING_COMPACT_EDIT_INVALID',objective:'GitHub autonomous coding issue #808: retry me'},
        {id:'active-901',status:'active',objective:'GitHub autonomous coding issue #901: still open'}
      ],jobs:[]});
      if(url.includes('/api/objectives')){posted++;return response({id:'unexpected'});}
      if(url.includes('/issues/808'))return response(issue(SAFE,{number:808}));
      if(url.includes('/issues/901'))return response({number:901,state:'open'});
      if(url.includes('/comments'))return response({});
      return response({});
    };
    await syncGithubCodingOutcomes({pool,fetchImpl,token:'fake',now:()=>1000});
    expect(posted).toBe(0);
    expect(pool.events.filter(e=>e.type==='GITHUB_CODING_RETRY_DISPATCHED')).toHaveLength(0);
  });

  it('creates at most one new retry objective per intake tick across blocked issues',async()=>{
    const pool=fakePool();let posted=0;
    pool.events.push(
      {type:'GITHUB_CODING_DISPATCHED',data:{issueNumber:805,codingObjectiveId:'obj-805'}},
      {type:'GITHUB_CODING_DISPATCHED',data:{issueNumber:806,codingObjectiveId:'obj-806'}}
    );
    const fetchImpl=async(url)=>{
      if(url.includes('/api/status'))return response({objectives:[
        {id:'obj-805',status:'blocked',summary:'CODING_COMPACT_EDIT_INVALID'},
        {id:'obj-806',status:'blocked',summary:'CODING_COMPACT_EDIT_INVALID'}
      ],jobs:[]});
      if(url.includes('/api/objectives')){posted++;return response({id:`obj-retry-${posted}`});}
      if(url.includes('/issues/805'))return response(issue(SAFE,{number:805}));
      if(url.includes('/issues/806'))return response(issue(SAFE,{number:806}));
      if(url.includes('/comments'))return response({});
      return response({});
    };
    await syncGithubCodingOutcomes({pool,fetchImpl,token:'fake',now:()=>1000});
    expect(posted).toBe(1);
    expect(pool.events.filter(e=>e.type==='GITHUB_CODING_RETRY_DISPATCHED')).toHaveLength(1);
  });

  it('resumes idempotently after restart between retry POST and durable dispatch markers',async()=>{
    const pool=fakePool();
    pool.events.push(
      {type:'GITHUB_CODING_DISPATCHED',data:{issueNumber:804,codingObjectiveId:'obj-804'}},
      {type:'GITHUB_CODING_RETRY_SCHEDULED',data:{issueNumber:804,priorObjectiveId:'obj-804',retryAttempt:1,reason:'CODING_COMPACT_EDIT_INVALID',transient:false,nextAt:new Date(0).toISOString()}}
    );
    const current=issue(SAFE,{number:804});
    let posted=0;
    const existingRetry={id:'obj-existing-retry',status:'queued',objective:'RETRY_KEY=GITHUB-ISSUE-804-RETRY-1 issue #804'};
    const fetchImpl=async(url)=>{
      if(url.includes('/api/status'))return response({objectives:[{id:'obj-804',status:'blocked',summary:'CODING_COMPACT_EDIT_INVALID'},existingRetry],jobs:[]});
      if(url.includes('/api/objectives')){posted++;return response({id:'unexpected'});}
      if(url.includes('/issues/804'))return response(current);
      if(url.includes('/comments'))return response({});
      return response({});
    };
    await syncGithubCodingOutcomes({pool,fetchImpl,token:'fake',now:()=>1000});
    await syncGithubCodingOutcomes({pool,fetchImpl,token:'fake',now:()=>1000});
    expect(posted).toBe(0);
    expect(pool.events.filter(e=>e.type==='GITHUB_CODING_RETRY_DISPATCHED')).toHaveLength(1);
    expect(pool.events.filter(e=>e.type==='GITHUB_CODING_DISPATCHED')).toHaveLength(2);
  });
});

it('coding backlog uses effective P1-P5 priority; OWNER_DIRECT does not outrank priority',async()=>{
  const pool=fakePool(); const posted=[];
  const withFlags=(number,priority,ownerDirect=false)=>issue(`${SAFE.replace('PRIORITY=P1',`PRIORITY=${priority}`)}${ownerDirect?'\nOWNER_DIRECT=true':''}`,{number,title:`Issue ${number}`});
  const issues=[withFlags(30,'P0',false),withFlags(20,'P2',true),withFlags(10,'P1',true)];
  const fetchImpl=async(url,init={})=>{
    if(url.includes('/issues?'))return response(issues);
    if(url.includes('/api/status'))return response({objectives:posted.map((objective,index)=>({id:`obj-${index+1}`,objective,status:'active'})),jobs:[]});
    if(url.includes('/api/objectives')){const payload=JSON.parse(init.body);posted.push(payload.objective);return response({id:`obj-${posted.length}`});}
    if(url.includes('/comments'))return response({});
    return response({});
  };
  let out=await materializeGithubCodingIssues({pool,fetchImpl,token:'fake'});
  expect(out.created).toBe(1);expect(posted[0]).toContain('#10');
  out=await materializeGithubCodingIssues({pool,fetchImpl,token:'fake'});expect(out.created).toBe(0);
  pool.events.push({type:'GITHUB_CODING_RESULT_REPORTED',data:{issueNumber:10,status:'completed'}});
  out=await materializeGithubCodingIssues({pool,fetchImpl,token:'fake'});expect(out.created).toBe(1);expect(posted[1]).toContain('#30');
  pool.events.push({type:'GITHUB_CODING_RESULT_REPORTED',data:{issueNumber:30,status:'completed'}});
  out=await materializeGithubCodingIssues({pool,fetchImpl,token:'fake'});expect(out.created).toBe(1);expect(posted[2]).toContain('#20');
});




describe('GitHub coding reopened-completion rearm',()=>{
  it('rearms a completed issue exactly once after GitHub close -> reopen and does not rearm recurring open work without reopen',async()=>{
    const pool=fakePool();
    pool.events.push(
      {type:'GITHUB_CODING_DISPATCHED',data:{issueNumber:1530,codingObjectiveId:'old-1530',dispatchKey:'GITHUB-ISSUE-1530'}},
      {type:'GITHUB_CODING_RESULT_REPORTED',data:{issueNumber:1530,codingObjectiveId:'old-1530',status:'completed'}}
    );
    let posted=0,rearmedObjective=null;
    const reopened=issue(SAFE+'\nOWNER_DIRECT=true\nRESOURCE_SCOPE=REOPENED_COMPLETION_TEST\nALLOW_PATH_PREFIX=docs/evidence/reopened-completion.md', {
      number:1530,title:'NV09 live acceptance follow-up'
    });
    const timeline=[
      {id:10,event:'closed',created_at:'2026-09-22T19:00:00Z'},
      {id:20,event:'reopened',created_at:'2026-09-23T09:00:00Z'},
    ];
    const fetchImpl=async(url,init={})=>{
      if(url.includes('/issues?'))return response([reopened]);
      if(url.includes('/issues/1530/timeline'))return response(timeline);
      if(url.includes('/issues/1530/comments'))return response([]);
      if(url.includes('/api/status'))return response({objectives:rearmedObjective?[rearmedObjective]:[],jobs:[]});
      if(url.includes('/api/objectives')){
        posted++;
        const body=JSON.parse(init.body);
        expect(body.objective).toContain('DISPATCH_KEY=GITHUB-ISSUE-1530-REOPEN-');
        expect(body.objective).toContain('REOPEN_KEY=');
        rearmedObjective={id:'rearmed-1530',status:'queued',objective:body.objective};
        return response({id:rearmedObjective.id});
      }
      if(url.includes('/comments'))return response({});
      return response({});
    };

    const first=await materializeGithubCodingIssues({pool,fetchImpl,token:'fake'});
    expect(first.created).toBe(1);
    expect(posted).toBe(1);
    expect(pool.events.filter(e=>e.type==='GITHUB_CODING_COMPLETED_REARMED')).toHaveLength(1);
    expect(pool.events.filter(e=>e.type==='GITHUB_CODING_DISPATCHED'&&e.data.issueNumber===1530)).toHaveLength(2);

    const second=await materializeGithubCodingIssues({pool,fetchImpl,token:'fake'});
    expect(second.created).toBe(0);
    expect(posted).toBe(1);

    const recurringPool=fakePool();
    recurringPool.events.push(
      {type:'GITHUB_CODING_DISPATCHED',data:{issueNumber:658,codingObjectiveId:'old-658'}},
      {type:'GITHUB_CODING_RESULT_REPORTED',data:{issueNumber:658,codingObjectiveId:'old-658',status:'completed'}}
    );
    const recurring=issue(SAFE+'\nOWNER_DIRECT=true\nRESOURCE_SCOPE=WEB_CONTROL_HOURLY_AUDIT\nALLOW_PATH_PREFIX=docs/evidence/audit.md',{number:658,title:'Recurring healthy service'});
    let recurringPosts=0;
    const recurringFetch=async(url)=>{
      if(url.includes('/issues?'))return response([recurring]);
      if(url.includes('/issues/658/timeline'))return response([]);
      if(url.includes('/issues/658/comments'))return response([]);
      if(url.includes('/api/status'))return response({objectives:[],jobs:[]});
      if(url.includes('/api/objectives')){recurringPosts++;return response({id:'unexpected'});}
      return response({});
    };
    const recurringOut=await materializeGithubCodingIssues({pool:recurringPool,fetchImpl:recurringFetch,token:'fake'});
    expect(recurringOut.created).toBe(0);
    expect(recurringPosts).toBe(0);
  });
});


  it('rearms a previously blocked terminal dispatch exactly once after a real GitHub close -> reopen',async()=>{
    const pool=fakePool();
    pool.events.push(
      {type:'GITHUB_CODING_DISPATCHED',data:{issueNumber:1268,codingObjectiveId:'old-1268',dispatchKey:'GITHUB-ISSUE-1268'}},
      {type:'GITHUB_CODING_BLOCKED_FINAL',data:{issueNumber:1268,codingObjectiveId:'old-1268',status:'blocked',reason:'ISSUE_CLOSED_OR_SUPERSEDED',terminalReason:'ISSUE_CLOSED_OR_SUPERSEDED'}}
    );
    let posted=0,rearmedObjective=null;
    const reopened=issue(SAFE+'\nOWNER_DIRECT=true\nRESOURCE_SCOPE=REOPENED_BLOCKED_TEST\nALLOW_PATH_PREFIX=docs/evidence/reopened-blocked.md', {
      number:1268,title:'Reopened blocked regression'
    });
    const timeline=[
      {id:30,event:'closed',created_at:'2026-09-24T08:40:00Z'},
      {id:40,event:'reopened',created_at:'2026-09-24T08:45:00Z'},
    ];
    const fetchImpl=async(url,init={})=>{
      if(url.includes('/issues?'))return response([reopened]);
      if(url.includes('/issues/1268/timeline'))return response(timeline);
      if(url.includes('/issues/1268/comments'))return response([]);
      if(url.includes('/api/status'))return response({objectives:rearmedObjective?[rearmedObjective]:[],jobs:[]});
      if(url.includes('/api/objectives')){
        posted++;
        const body=JSON.parse(init.body);
        expect(body.objective).toContain('DISPATCH_KEY=GITHUB-ISSUE-1268-REOPEN-');
        expect(body.objective).toContain('REOPEN_KEY=');
        rearmedObjective={id:'rearmed-1268',status:'queued',objective:body.objective};
        return response({id:rearmedObjective.id});
      }
      if(url.includes('/comments'))return response({});
      return response({});
    };

    const first=await materializeGithubCodingIssues({pool,fetchImpl,token:'fake'});
    expect(first.created).toBe(1);
    expect(posted).toBe(1);
    expect(pool.events.filter(e=>e.type==='GITHUB_CODING_COMPLETED_REARMED')).toHaveLength(1);
    expect(pool.events.find(e=>e.type==='GITHUB_CODING_COMPLETED_REARMED')?.data.priorObjectiveId).toBe('old-1268');
    expect(pool.events.filter(e=>e.type==='GITHUB_CODING_DISPATCHED'&&e.data.issueNumber===1268)).toHaveLength(2);

    const second=await materializeGithubCodingIssues({pool,fetchImpl,token:'fake'});
    expect(second.created).toBe(0);
    expect(posted).toBe(1);
  });

describe('GitHub coding scope-aware pool refill',()=>{
  const scoped=(number,scope,path,priority='P1')=>issue(`${SAFE.replace('PRIORITY=P1',`PRIORITY=${priority}`)}\nRESOURCE_SCOPE=${scope}\nALLOW_PATH_PREFIX=${path}`,{number,title:`Scoped ${number}`});

  it('fills three independent scopes in one intake cycle up to cap=3',async()=>{
    const pool=fakePool();const posted=[];
    const issues=[scoped(911,'SCOPE_A','apps/a'),scoped(912,'SCOPE_B','apps/b'),scoped(913,'SCOPE_C','apps/c')];
    const fetchImpl=async(url,init={})=>{
      if(url.includes('/issues?'))return response(issues);
      if(url.includes('/api/status'))return response({objectives:[]});
      if(url.includes('/api/objectives')){const payload=JSON.parse(init.body);posted.push(payload.objective);return response({id:`obj-${posted.length}`});}
      if(url.includes('/comments'))return response({});
      return response({});
    };
    const out=await materializeGithubCodingIssues({pool,fetchImpl,token:'fake',concurrencyCap:3});
    expect(out).toMatchObject({created:3,activeSlots:3,freeSlots:0,scopeBlocked:0});
    expect(posted).toHaveLength(3);
    expect(pool.events.filter(e=>e.type==='GITHUB_CODING_DISPATCHED')).toHaveLength(3);
  });

  it('serializes overlapping path scopes deterministically',async()=>{
    const pool=fakePool();let posted=0;
    const issues=[scoped(921,'SCOPE_PARENT','apps/shared'),scoped(922,'SCOPE_CHILD','apps/shared/sub')];
    const fetchImpl=async(url)=>{
      if(url.includes('/issues?'))return response(issues);
      if(url.includes('/api/status'))return response({objectives:[]});
      if(url.includes('/api/objectives')){posted++;return response({id:`obj-${posted}`});}
      if(url.includes('/comments'))return response({});
      return response({});
    };
    const out=await materializeGithubCodingIssues({pool,fetchImpl,token:'fake',concurrencyCap:3});
    expect(out.created).toBe(1);
    expect(out.scopeBlocked).toBe(1);
    expect(out.skipReasons).toContainEqual({issueNumber:922,skipReason:'SCOPE_OVERLAP'});
    expect(posted).toBe(1);
  });

  it('recovers a pre-existing deterministic objective after restart without duplicate POST',async()=>{
    const pool=fakePool();let posted=0;
    const current=scoped(931,'SCOPE_RESTART','apps/restart');
    const existing={id:'obj-existing-931',status:'queued',objective:'GitHub autonomous coding issue #931\nDISPATCH_KEY=GITHUB-ISSUE-931'};
    const fetchImpl=async(url)=>{
      if(url.includes('/issues?'))return response([current]);
      if(url.includes('/api/status'))return response({objectives:[existing]});
      if(url.includes('/api/objectives')){posted++;return response({id:'duplicate'});}
      if(url.includes('/comments'))return response({});
      return response({});
    };
    const first=await materializeGithubCodingIssues({pool,fetchImpl,token:'fake',concurrencyCap:3});
    const second=await materializeGithubCodingIssues({pool,fetchImpl,token:'fake',concurrencyCap:3});
    expect(first).toMatchObject({created:0,recovered:1,activeSlots:1});
    expect(second).toMatchObject({created:0,active:1});
    expect(posted).toBe(0);
    expect(pool.events.filter(e=>e.type==='GITHUB_CODING_DISPATCHED')).toHaveLength(1);
  });

  it('ignores stale historical dispatch markers when Coding Lane has no live objective',async()=>{
    const pool=fakePool();const posted=[];
    for(let n=100;n<135;n++)pool.events.push({type:'GITHUB_CODING_DISPATCHED',data:{issueNumber:n,codingObjectiveId:`old-${n}`}});
    const issues=[scoped(941,'LIVE_A','apps/live-a'),scoped(942,'LIVE_B','apps/live-b'),scoped(943,'LIVE_C','apps/live-c')];
    const fetchImpl=async(url,init={})=>{
      if(url.includes('/issues?'))return response(issues);
      if(url.includes('/api/status'))return response({objectives:[],jobs:[]});
      if(url.includes('/api/objectives')){const payload=JSON.parse(init.body);posted.push(payload.objective);return response({id:`live-${posted.length}`});}
      if(url.includes('/comments'))return response({});
      return response({});
    };
    const out=await materializeGithubCodingIssues({pool,fetchImpl,token:'fake',concurrencyCap:3});
    expect(out).toMatchObject({created:3,active:0,activeSlots:3,freeSlots:0});
    expect(posted).toHaveLength(3);
  });

  it('releases a stale scope lease when its source issue is closed even if the lane objective is still active',async()=>{
    const pool=fakePool();let posted=0;
    pool.events.push({type:'GITHUB_CODING_DISPATCHED',data:{issueNumber:954,codingObjectiveId:'stale-live-954',scopeLease:{resourceScope:'SAME_SCOPE',paths:['apps/shared'],ambiguous:false}}});
    const candidate=scoped(955,'SAME_SCOPE','apps/shared');
    const fetchImpl=async(url)=>{
      if(url.includes('/issues?'))return response([candidate]);
      if(url.includes('/issues/954'))return response({number:954,state:'closed'});
      if(url.includes('/api/status'))return response({objectives:[{id:'stale-live-954',status:'active'}],jobs:[]});
      if(url.includes('/api/objectives')){posted++;return response({id:'new-955'});}
      if(url.includes('/comments'))return response({});
      return response({});
    };
    const out=await materializeGithubCodingIssues({pool,fetchImpl,token:'fake',concurrencyCap:3});
    expect(out).toMatchObject({created:1,active:0,scopeBlocked:0});
    expect(posted).toBe(1);
    expect(pool.events.filter(e=>e.type==='GITHUB_CODING_STALE_SCOPE_IGNORED')).toHaveLength(1);
  });

  it('counts only dispatches whose Coding Lane objective is currently non-terminal',async()=>{
    const pool=fakePool();let posted=0;
    pool.events.push(
      {type:'GITHUB_CODING_DISPATCHED',data:{issueNumber:951,codingObjectiveId:'live-951',scopeLease:{resourceScope:'LIVE_OWNER',paths:['apps/owner'],ambiguous:false}}},
      {type:'GITHUB_CODING_DISPATCHED',data:{issueNumber:952,codingObjectiveId:'stale-952'}}
    );
    const candidate=scoped(953,'FREE_SCOPE','apps/free');
    const fetchImpl=async(url)=>{
      if(url.includes('/issues?'))return response([candidate]);
      if(url.includes('/api/status'))return response({objectives:[{id:'live-951',status:'active'},{id:'stale-952',status:'blocked'}],jobs:[]});
      if(url.includes('/api/objectives')){posted++;return response({id:'new-953'});}
      if(url.includes('/comments'))return response({});
      return response({});
    };
    const out=await materializeGithubCodingIssues({pool,fetchImpl,token:'fake',concurrencyCap:3});
    expect(out).toMatchObject({created:1,active:1,activeSlots:2,freeSlots:1});
    expect(posted).toBe(1);
  });

});


describe('GitHub coding source revision completion guard',()=>{
  it('stores source revision at initial dispatch and carries it into the Coding objective',async()=>{
    const pool=fakePool();const current=issue(SAFE+'\nRESOURCE_SCOPE=REV_INIT\nALLOW_PATH_PREFIX=docs/evidence/rev-init.md',{number:820,title:'Revision init'});
    let posted='';
    const fetchImpl=async(url,init={})=>{
      if(url.includes('/issues?'))return response([current]);
      if(url.includes('/issues/820/comments'))return response([]);
      if(url.includes('/api/status'))return response({objectives:[],jobs:[]});
      if(url.includes('/api/objectives')){posted=JSON.parse(init.body).objective;return response({id:'obj-820'});}
      if(url.includes('/comments'))return response({});
      return response({});
    };
    const out=await materializeGithubCodingIssues({pool,fetchImpl,token:'fake'});
    const rev=codingSourceTruthRevision({...current,repository_owner:'newsdayads'},[]);
    expect(out.created).toBe(1);
    expect(posted).toContain(`SOURCE_REVISION=${rev}`);
    expect(pool.events.find(e=>e.type==='GITHUB_CODING_DISPATCHED')?.data.sourceRevision).toBe(rev);
  });

  it('closes a completed Work Order only when dispatch and current source revisions match',async()=>{
    const pool=fakePool();const current=issue(SAFE+'\nRESOURCE_SCOPE=REV_SAME\nALLOW_PATH_PREFIX=docs/evidence/rev-same.md',{number:821,title:'Revision same'});
    const rev=codingSourceTruthRevision({...current,repository_owner:'newsdayads'},[]);
    pool.events.push({type:'GITHUB_CODING_DISPATCHED',data:{issueNumber:821,codingObjectiveId:'obj-821',sourceRevision:rev,scopeLease:{resourceScope:'REV_SAME',paths:['docs/evidence/rev-same.md'],ambiguous:false}}});
    let closed=false;
    const fetchImpl=async(url,init={})=>{
      if(url.includes('/api/status'))return response({objectives:[{id:'obj-821',status:'completed',summary:'Merged PR'}],jobs:[]});
      if(url.includes('/git/ref/heads/main'))return response({object:{sha:'same-main'}});
      if(url.includes('/issues/821/comments'))return response([]);
      if(url.includes('/issues/821')){
        if(init.method==='PATCH'){closed=true;return response({...current,state:'closed'});}
        return response(current);
      }
      if(url.includes('/comments'))return response({});
      return response({});
    };
    await syncGithubCodingOutcomes({pool,fetchImpl,token:'fake'});
    expect(closed).toBe(true);
    expect(pool.events.filter(e=>e.type==='GITHUB_CODING_RESULT_REPORTED')).toHaveLength(1);
    expect(pool.events.filter(e=>e.type==='GITHUB_CODING_STALE_RESULT_REJECTED')).toHaveLength(0);
  });

  it('rejects a completed stale body revision, keeps the issue open, and rearms only once',async()=>{
    const pool=fakePool();
    const oldIssue=issue(SAFE+'\nRESOURCE_SCOPE=REV_STALE\nALLOW_PATH_PREFIX=docs/evidence/rev-stale.md',{number:822,title:'Revision stale'});
    const current={...oldIssue,body:oldIssue.body+'\n\n## ACCEPTANCE\nCurrent source changed'};
    const oldRev=codingSourceTruthRevision({...oldIssue,repository_owner:'newsdayads'},[]);
    pool.events.push({type:'GITHUB_CODING_DISPATCHED',data:{issueNumber:822,codingObjectiveId:'obj-822',sourceRevision:oldRev,scopeLease:{resourceScope:'REV_STALE',paths:['docs/evidence/rev-stale.md'],ambiguous:false}}});
    let posted=0,closed=false;
    const fetchImpl=async(url,init={})=>{
      if(url.includes('/api/status'))return response({objectives:[{id:'obj-822',status:'completed',summary:'Old result'}],jobs:[]});
      if(url.includes('/git/ref/heads/main'))return response({object:{sha:'same-main'}});
      if(url.includes('/issues/822/comments'))return response([]);
      if(url.includes('/issues/822')){
        if(init.method==='PATCH'){closed=true;return response({...current,state:'closed'});}
        return response(current);
      }
      if(url.includes('/api/objectives')){posted++;return response({id:'obj-822-current'});}
      if(url.includes('/comments'))return response({});
      return response({});
    };
    await syncGithubCodingOutcomes({pool,fetchImpl,token:'fake'});
    await syncGithubCodingOutcomes({pool,fetchImpl,token:'fake'});
    expect(closed).toBe(false);
    expect(posted).toBe(1);
    expect(pool.events.filter(e=>e.type==='GITHUB_CODING_STALE_RESULT_REJECTED')).toHaveLength(1);
    expect(pool.events.filter(e=>e.type==='GITHUB_CODING_STALE_RESULT_REARMED')).toHaveLength(1);
    expect(pool.events.filter(e=>e.type==='GITHUB_CODING_RESULT_REPORTED')).toHaveLength(0);
  });

  it('treats an authoritative Owner directive change as a source revision change',async()=>{
    const pool=fakePool();
    const current=issue(SAFE+'\nRESOURCE_SCOPE=REV_OWNER\nALLOW_PATH_PREFIX=docs/evidence/rev-owner.md',{number:823,title:'Revision owner',comments:1});
    const oldRev=codingSourceTruthRevision({...current,repository_owner:'newsdayads'},[]);
    pool.events.push({type:'GITHUB_CODING_DISPATCHED',data:{issueNumber:823,codingObjectiveId:'obj-823',sourceRevision:oldRev,scopeLease:{resourceScope:'REV_OWNER',paths:['docs/evidence/rev-owner.md'],ambiguous:false}}});
    let posted=0,closed=false;
    const directive={id:9901,user:{login:'newsdayads'},body:'[OWNER_DIRECTIVE] acceptance changed'};
    const fetchImpl=async(url,init={})=>{
      if(url.includes('/api/status'))return response({objectives:[{id:'obj-823',status:'completed',summary:'Old result'}],jobs:[]});
      if(url.includes('/git/ref/heads/main'))return response({object:{sha:'same-main'}});
      if(url.includes('/issues/823/comments'))return response([directive]);
      if(url.includes('/issues/823')){
        if(init.method==='PATCH'){closed=true;return response({...current,state:'closed'});}
        return response(current);
      }
      if(url.includes('/api/objectives')){posted++;return response({id:'obj-823-owner-current'});}
      if(url.includes('/comments'))return response({});
      return response({});
    };
    await syncGithubCodingOutcomes({pool,fetchImpl,token:'fake'});
    expect(closed).toBe(false);
    expect(posted).toBe(1);
    expect(pool.events.find(e=>e.type==='GITHUB_CODING_STALE_RESULT_REJECTED')?.data.currentSourceRevision).toContain(':owner-9901');
  });

  it('rechecks DEPENDS_ON before recovery rearm and proceeds only after dependency closes',async()=>{
    const pool=fakePool();
    const current=issue(SAFE+'\nDEPENDS_ON=#900\nRESOURCE_SCOPE=REV_DEP\nALLOW_PATH_PREFIX=docs/evidence/rev-dep.md',{number:824,title:'Revision dependency'});
    const rev=codingSourceTruthRevision({...current,repository_owner:'newsdayads'},[]);
    pool.events.push(
      {type:'GITHUB_CODING_DISPATCHED',data:{issueNumber:824,codingObjectiveId:'obj-824-r2',sourceRevision:rev,scopeLease:{resourceScope:'REV_DEP',paths:['docs/evidence/rev-dep.md'],ambiguous:false}}},
      {type:'GITHUB_CODING_RETRY_DISPATCHED',data:{issueNumber:824,codingObjectiveId:'obj-824-r1',retryAttempt:1}},
      {type:'GITHUB_CODING_RETRY_DISPATCHED',data:{issueNumber:824,codingObjectiveId:'obj-824-r2',retryAttempt:2}},
      {type:'GITHUB_CODING_BLOCKED_FINAL',data:{issueNumber:824,codingObjectiveId:'obj-824-r2',status:'blocked',reason:'RETRY_BUDGET_EXHAUSTED',terminalReason:'OUTPUT_CONTRACT_EXHAUSTED',mainSha:'old-main',sourceRevision:rev}}
    );
    let depState='open',posted=0;
    const fetchImpl=async(url,init={})=>{
      if(url.includes('/api/status'))return response({objectives:[{id:'obj-824-r2',status:'blocked',summary:'OUTPUT_CONTRACT_EXHAUSTED'}],jobs:[]});
      if(url.includes('/git/ref/heads/main'))return response({object:{sha:'new-main'}});
      if(url.includes('/compare/'))return response({files:[{filename:'docs/evidence/rev-dep.md'}]});
      if(url.includes('/issues/824/comments'))return response([]);
      if(url.includes('/issues/900'))return response({number:900,state:depState});
      if(url.includes('/issues/824'))return response(current);
      if(url.includes('/api/objectives')){posted++;return response({id:'obj-824-recovery'});}
      if(url.includes('/comments'))return response({});
      return response({});
    };
    await syncGithubCodingOutcomes({pool,fetchImpl,token:'fake'});
    expect(posted).toBe(0);
    expect(pool.events.filter(e=>e.type==='GITHUB_CODING_DEPENDENCY_WAIT')).toHaveLength(1);
    depState='closed';
    await syncGithubCodingOutcomes({pool,fetchImpl,token:'fake'});
    expect(posted).toBe(1);
    expect(pool.events.filter(e=>e.type==='GITHUB_CODING_RECOVERY_REARMED')).toHaveLength(1);
    expect(pool.events.filter(e=>e.type==='GITHUB_CODING_DISPATCHED').at(-1)?.data.sourceRevision).toBe(rev);
  });
});


describe('GitHub coding source revision completion guard',()=>{
  it('stores canonical source revision on initial dispatch',async()=>{
    const pool=fakePool(); let postedObjective='';
    const current=issue(SAFE+'\nRESOURCE_SCOPE=REV_INITIAL\nALLOW_PATH_PREFIX=tests/github-coding-intake.test.mjs',{number:1601,title:'Initial revision guard',comments:0});
    const revision=codingSourceTruthRevision({...current,repository_owner:'newsdayads'},[]);
    const fetchImpl=async(url,init={})=>{
      if(url.includes('/issues?'))return response([current]);
      if(url.includes('/issues/1601/comments'))return response([]);
      if(url.includes('/api/status'))return response({objectives:[],jobs:[]});
      if(url.includes('/api/objectives')){postedObjective=JSON.parse(init.body).objective;return response({id:'obj-1601'});}
      if(url.includes('/comments'))return response({});
      return response({});
    };
    const out=await materializeGithubCodingIssues({pool,fetchImpl,token:'fake'});
    expect(out.created).toBe(1);
    expect(postedObjective).toContain(`SOURCE_REVISION=${revision}`);
    expect(pool.events.find(e=>e.type==='GITHUB_CODING_DISPATCHED')?.data).toMatchObject({issueNumber:1601,codingObjectiveId:'obj-1601',sourceRevision:revision});
  });

  it('closes a completed objective only when dispatch revision still matches',async()=>{
    const pool=fakePool(); let closed=false;
    const current=issue(SAFE+'\nRESOURCE_SCOPE=REV_SAME\nALLOW_PATH_PREFIX=tests/github-coding-intake.test.mjs',{number:1602,title:'Same revision completion',comments:0});
    const revision=codingSourceTruthRevision({...current,repository_owner:'newsdayads'},[]);
    pool.events.push({type:'GITHUB_CODING_DISPATCHED',data:{issueNumber:1602,codingObjectiveId:'obj-1602',sourceRevision:revision,scopeLease:{resourceScope:'REV_SAME',paths:['tests/github-coding-intake.test.mjs'],ambiguous:false}}});
    const fetchImpl=async(url,init={})=>{
      if(url.includes('/api/status'))return response({objectives:[{id:'obj-1602',status:'completed',summary:'Merged PR'}],jobs:[]});
      if(url.includes('/git/ref/heads/main'))return response({object:{sha:'main-same'}});
      if(url.includes('/issues/1602/comments'))return response([]);
      if(url.includes('/issues/1602')){
        if(init.method==='PATCH'){closed=true;return response({...current,state:'closed'});}
        return response(current);
      }
      if(url.includes('/comments'))return response({});
      return response({});
    };
    await syncGithubCodingOutcomes({pool,fetchImpl,token:'fake'});
    expect(closed).toBe(true);
    expect(pool.events.filter(e=>e.type==='GITHUB_CODING_RESULT_REPORTED')).toHaveLength(1);
    expect(pool.events.filter(e=>e.type==='GITHUB_CODING_STALE_RESULT_REJECTED')).toHaveLength(0);
  });

  it('rejects stale completed body result, rearms current source exactly once, and never closes',async()=>{
    const pool=fakePool(); let closed=false,posted=0,rearmObjective=null;
    const prior=issue(SAFE+'\nRESOURCE_SCOPE=REV_BODY\nALLOW_PATH_PREFIX=tests/github-coding-intake.test.mjs',{number:1603,title:'Body revision completion',comments:0});
    const current={...prior,body:prior.body+'\nCURRENT_STATE=OWNER_CHANGED_ACCEPTANCE'};
    const oldRevision=codingSourceTruthRevision({...prior,repository_owner:'newsdayads'},[]);
    const currentRevision=codingSourceTruthRevision({...current,repository_owner:'newsdayads'},[]);
    pool.events.push({type:'GITHUB_CODING_DISPATCHED',data:{issueNumber:1603,codingObjectiveId:'obj-old-1603',sourceRevision:oldRevision,scopeLease:{resourceScope:'REV_BODY',paths:['tests/github-coding-intake.test.mjs'],ambiguous:false}}});
    const fetchImpl=async(url,init={})=>{
      if(url.includes('/api/status'))return response({objectives:[
        {id:'obj-old-1603',status:'completed',summary:'old result'},
        ...(rearmObjective?[rearmObjective]:[])
      ],jobs:[]});
      if(url.includes('/git/ref/heads/main'))return response({object:{sha:'main-body'}});
      if(url.includes('/issues/1603/comments'))return response([]);
      if(url.includes('/issues/1603')){
        if(init.method==='PATCH'){closed=true;return response({...current,state:'closed'});}
        return response(current);
      }
      if(url.includes('/api/objectives')){
        posted++;
        const objective=JSON.parse(init.body).objective;
        expect(objective).toContain(`SOURCE_REVISION=${currentRevision}`);
        expect(objective).toContain('STALE_REARM_KEY=GITHUB-ISSUE-1603-STALE-');
        rearmObjective={id:'obj-rearm-1603',status:'queued',objective};
        return response({id:rearmObjective.id});
      }
      if(url.includes('/comments'))return response({});
      return response({});
    };
    await syncGithubCodingOutcomes({pool,fetchImpl,token:'fake'});
    await syncGithubCodingOutcomes({pool,fetchImpl,token:'fake'});
    expect(closed).toBe(false);
    expect(posted).toBe(1);
    expect(pool.events.filter(e=>e.type==='GITHUB_CODING_STALE_RESULT_REJECTED')).toHaveLength(1);
    expect(pool.events.filter(e=>e.type==='GITHUB_CODING_STALE_RESULT_REARMED')).toHaveLength(1);
    expect(pool.events.filter(e=>e.type==='GITHUB_CODING_RESULT_REPORTED')).toHaveLength(0);
    expect(pool.events.filter(e=>e.type==='GITHUB_CODING_DISPATCHED').at(-1)?.data.sourceRevision).toBe(currentRevision);
  });

  it('treats changed Owner directive as a source revision change',async()=>{
    const pool=fakePool(); let closed=false,posted=0,rearmObjective=null;
    const current=issue(SAFE+'\nRESOURCE_SCOPE=REV_OWNER\nALLOW_PATH_PREFIX=tests/github-coding-intake.test.mjs',{number:1604,title:'Owner directive revision',comments:1});
    const oldRevision=codingSourceTruthRevision({...current,repository_owner:'newsdayads'},[]);
    const directive={id:901,user:{login:'newsdayads'},body:'[OWNER_DIRECTIVE] acceptance changed'};
    const currentRevision=codingSourceTruthRevision({...current,repository_owner:'newsdayads'},[directive]);
    pool.events.push({type:'GITHUB_CODING_DISPATCHED',data:{issueNumber:1604,codingObjectiveId:'obj-old-1604',sourceRevision:oldRevision,scopeLease:{resourceScope:'REV_OWNER',paths:['tests/github-coding-intake.test.mjs'],ambiguous:false}}});
    const fetchImpl=async(url,init={})=>{
      if(url.includes('/api/status'))return response({objectives:[
        {id:'obj-old-1604',status:'completed',summary:'old result'},
        ...(rearmObjective?[rearmObjective]:[])
      ],jobs:[]});
      if(url.includes('/git/ref/heads/main'))return response({object:{sha:'main-owner'}});
      if(url.includes('/issues/1604/comments'))return response([directive]);
      if(url.includes('/issues/1604')){
        if(init.method==='PATCH'){closed=true;return response({...current,state:'closed'});}
        return response(current);
      }
      if(url.includes('/api/objectives')){
        posted++;
        const objective=JSON.parse(init.body).objective;
        expect(objective).toContain(`SOURCE_REVISION=${currentRevision}`);
        rearmObjective={id:'obj-rearm-1604',status:'queued',objective};
        return response({id:rearmObjective.id});
      }
      if(url.includes('/comments'))return response({});
      return response({});
    };
    await syncGithubCodingOutcomes({pool,fetchImpl,token:'fake'});
    await syncGithubCodingOutcomes({pool,fetchImpl,token:'fake'});
    expect(currentRevision).not.toBe(oldRevision);
    expect(closed).toBe(false);
    expect(posted).toBe(1);
    expect(pool.events.filter(e=>e.type==='GITHUB_CODING_STALE_RESULT_REJECTED')).toHaveLength(1);
    expect(pool.events.filter(e=>e.type==='GITHUB_CODING_STALE_RESULT_REARMED')).toHaveLength(1);
  });

  it('rechecks DEPENDS_ON before recovery, dedupes wait, then rearms after dependency closes',async()=>{
    const pool=fakePool(); let dependencyClosed=false,posted=0,recoveryObjective=null;
    const current=issue(SAFE+'\nDEPENDS_ON=#1935\nRESOURCE_SCOPE=REV_DEP\nALLOW_PATH_PREFIX=tests/github-coding-intake.test.mjs',{number:1605,title:'Recovery dependency gate',comments:0});
    const revision=codingSourceTruthRevision({...current,repository_owner:'newsdayads'},[]);
    pool.events.push(
      {type:'GITHUB_CODING_DISPATCHED',data:{issueNumber:1605,codingObjectiveId:'obj-1605-r2',sourceRevision:revision,scopeLease:{resourceScope:'REV_DEP',paths:['tests/github-coding-intake.test.mjs'],ambiguous:false}}},
      {type:'GITHUB_CODING_RETRY_DISPATCHED',data:{issueNumber:1605,codingObjectiveId:'obj-1605-r1',priorObjectiveId:'obj-1605',retryAttempt:1,sourceRevision:revision}},
      {type:'GITHUB_CODING_RETRY_DISPATCHED',data:{issueNumber:1605,codingObjectiveId:'obj-1605-r2',priorObjectiveId:'obj-1605-r1',retryAttempt:2,sourceRevision:revision}},
      {type:'GITHUB_CODING_BLOCKED_FINAL',data:{issueNumber:1605,codingObjectiveId:'obj-1605-r2',reason:'RETRY_BUDGET_EXHAUSTED',terminalReason:'OUTPUT_CONTRACT_EXHAUSTED',mainSha:'old-main',sourceRevision:revision}}
    );
    const fetchImpl=async(url,init={})=>{
      if(url.includes('/api/status'))return response({objectives:[
        {id:'obj-1605-r2',status:'blocked',summary:'OUTPUT_CONTRACT_EXHAUSTED'},
        ...(recoveryObjective?[recoveryObjective]:[])
      ],jobs:[]});
      if(url.includes('/git/ref/heads/main'))return response({object:{sha:'new-main'}});
      if(url.includes('/compare/'))return response({files:[{filename:'tests/github-coding-intake.test.mjs'}]});
      if(url.includes('/issues/1605/comments'))return response([]);
      if(url.includes('/issues/1935'))return response({number:1935,state:dependencyClosed?'closed':'open'});
      if(url.includes('/issues/1605'))return response(current);
      if(url.includes('/api/objectives')){
        posted++;
        const objective=JSON.parse(init.body).objective;
        expect(objective).toContain(`SOURCE_REVISION=${revision}`);
        recoveryObjective={id:'obj-1605-recovery',status:'queued',objective};
        return response({id:recoveryObjective.id});
      }
      if(url.includes('/comments'))return response({});
      return response({});
    };
    await syncGithubCodingOutcomes({pool,fetchImpl,token:'fake'});
    await syncGithubCodingOutcomes({pool,fetchImpl,token:'fake'});
    expect(posted).toBe(0);
    expect(pool.events.filter(e=>e.type==='GITHUB_CODING_DEPENDENCY_WAIT'&&e.data.stage==='terminal-rearm')).toHaveLength(1);
    expect(pool.events.filter(e=>e.type==='GITHUB_CODING_RECOVERY_REARMED')).toHaveLength(0);

    dependencyClosed=true;
    await syncGithubCodingOutcomes({pool,fetchImpl,token:'fake'});
    expect(posted).toBe(1);
    expect(pool.events.filter(e=>e.type==='GITHUB_CODING_RECOVERY_REARMED')).toHaveLength(1);
    expect(pool.events.filter(e=>e.type==='GITHUB_CODING_DISPATCHED').at(-1)?.data.sourceRevision).toBe(revision);
  });
});
