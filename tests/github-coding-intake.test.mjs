import {describe,expect,it} from 'vitest';
import {classifyCodingBlocker,extractCodingDependencies,materializeGithubCodingIssues,parseCodingIssue,syncGithubCodingOutcomes} from '../apps/tigeriq-core/github-coding-intake.mjs';

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

function fakePool(){
  const events=[];
  return {events,async query(q,params=[]){
    if(q.includes("select data from tigeriq_events where type='GITHUB_CODING_DISPATCHED'")){
      const dispatches=events.filter(e=>e.type==='GITHUB_CODING_DISPATCHED');
      if(q.includes('not exists')){
        const latest=[...dispatches].reverse()[0];
        const final=latest&&events.some(r=>String(r.data.issueNumber)===String(latest.data.issueNumber)&&(r.type==='GITHUB_CODING_BLOCKED_FINAL'||(r.type==='GITHUB_CODING_RESULT_REPORTED'&&String(r.data.status||'').toLowerCase()==='completed')));
        const active=Boolean(latest)&&!final;
        return {rowCount:active?1:0,rows:active?[{one:1}]:[]};
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

describe('GitHub coding intake guard',()=>{
  it('accepts only explicit safe autonomous coding issues',()=>{
    const parsed=parseCodingIssue(issue(SAFE));
    expect(parsed?.number).toBe(777);
    expect(parsed?.priority).toBe('P1');
    expect(parsed?.dependsOn).toEqual([]);
  });
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
    expect(materialized).toMatchObject({created:0,active:1});
  });

  it('classifies compact/output failures as recoverable and policy/security as hard',()=>{
    expect(classifyCodingBlocker('CODING_COMPACT_EDIT_INVALID').kind).toBe('RECOVERABLE');
    expect(classifyCodingBlocker('CODING_COMPACT_REPAIR_MULTI_FILE_INVALID').kind).toBe('RECOVERABLE');
    expect(classifyCodingBlocker('HTTP_429 provider rate limit')).toMatchObject({kind:'RECOVERABLE',transient:true});
    expect(classifyCodingBlocker('AI_RESOURCES_UNAVAILABLE')).toMatchObject({kind:'RECOVERABLE',transient:true});
    expect(classifyCodingBlocker('manager decision exhausted after bounded retry/failover')).toMatchObject({kind:'RECOVERABLE',transient:true});
    expect(classifyCodingBlocker('SECURITY POLICY_BLOCK requires human')).toMatchObject({kind:'HARD',transient:false});
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
    expect(next.issueNumber).toBe(706);
    expect(pool.events.filter(e=>e.type==='GITHUB_DEPENDENCY_RELEASED')).toHaveLength(1);
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

it('coding backlog serializes three issues by OWNER_DIRECT then priority',async()=>{
  const pool=fakePool(); const posted=[];
  const withFlags=(number,priority,ownerDirect=false)=>issue(`${SAFE.replace('PRIORITY=P1',`PRIORITY=${priority}`)}${ownerDirect?'\nOWNER_DIRECT=true':''}`,{number,title:`Issue ${number}`});
  const issues=[
    withFlags(30,'P0',false),
    withFlags(20,'P2',true),
    withFlags(10,'P1',true),
  ];
  const fetchImpl=async(url,init={})=>{
    if(url.includes('/issues?'))return response(issues);
    if(url.includes('/api/status'))return response({objectives:posted.map((objective,index)=>({id:`obj-${index+1}`,objective,status:'active'})),jobs:[]});
    if(url.includes('/api/objectives')){
      const payload=JSON.parse(init.body);
      posted.push(payload.objective);
      return response({id:`obj-${posted.length}`});
    }
    if(url.includes('/comments'))return response({});
    return response({});
  };

  let out=await materializeGithubCodingIssues({pool,fetchImpl,token:'fake'});
  expect(out.issueNumber).toBe(10);
  expect(posted[0]).toContain('#10');

  out=await materializeGithubCodingIssues({pool,fetchImpl,token:'fake'});
  expect(out.created).toBe(0);
  expect(out.active).toBe(1);

  pool.events.push({type:'GITHUB_CODING_RESULT_REPORTED',data:{issueNumber:10,status:'completed'}});
  out=await materializeGithubCodingIssues({pool,fetchImpl,token:'fake'});
  expect(out.issueNumber).toBe(20);
  expect(posted[1]).toContain('#20');

  pool.events.push({type:'GITHUB_CODING_RESULT_REPORTED',data:{issueNumber:20,status:'completed'}});
  out=await materializeGithubCodingIssues({pool,fetchImpl,token:'fake'});
  expect(out.issueNumber).toBe(30);
  expect(posted[2]).toContain('#30');
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
