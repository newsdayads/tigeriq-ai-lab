import {describe,expect,it} from 'vitest';
import {extractCodingDependencies,materializeGithubCodingIssues,parseCodingIssue} from '../apps/tigeriq-core/github-coding-intake.mjs';

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
      const latest=[...events].reverse().find(e=>e.type==='GITHUB_CODING_DISPATCHED');
      const active=Boolean(latest)&&!events.some(r=>r.type==='GITHUB_CODING_RESULT_REPORTED'&&String(r.data.issueNumber)===String(latest.data.issueNumber));
      return {rowCount:active?1:0,rows:active?[{one:1}]:[]};
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

  it('implements bounded retry for blocked WorkItems and hard blocker fail-closed logic',async()=>{
    const pool=fakePool();
    pool.events.push({
      type:'GITHUB_CODING_DISPATCHED',
      data:{issueNumber:777,issueUrl:'https://github.com/newsdayads/tigeriq-ai-lab/issues/777',codingObjectiveId:'obj-100',ownerDirect:false,sourcePriority:'P1',dispatchPriority:'P1',dispatchReason:'PRIORITY_P1',retryCount:0}
    });
    const fetchImpl=async(url)=>{ 
      if(url.includes('/api/status')){
        return response({objectives:[{id:'obj-100',status:'blocked',summary:'fail test'}],jobs:[]});
      }
      if(url.includes('/api/objectives')){
        return response({id:'obj-101'});
      }
      return response({});
    };
    const res1 = await import('../apps/tigeriq-core/github-coding-intake.mjs').then(m => m.syncGithubCodingOutcomes({pool,fetchImpl,token:'fake'}));
    expect(res1.results).toBe(1);
    const dispatchedEvents = pool.events.filter(e => e.type === 'GITHUB_CODING_DISPATCHED');
    expect(dispatchedEvents.length).toBe(2);
    expect(dispatchedEvents[1].data.retryCount).toBe(1);
    
    // second block triggers retry 2
    pool.events.push({
      type:'GITHUB_CODING_DISPATCHED',
      data:{issueNumber:777,issueUrl:'https://github.com/newsdayads/tigeriq-ai-lab/issues/777',codingObjectiveId:'obj-101',ownerDirect:false,sourcePriority:'P1',dispatchPriority:'P1',dispatchReason:'RETRY_1',retryCount:1}
    });
    const res2 = await import('../apps/tigeriq-core/github-coding-intake.mjs').then(m => m.syncGithubCodingOutcomes({pool,fetchImpl:async(u)=>{if(u.includes('/api/status'))return response({objectives:[{id:'obj-101',status:'blocked',summary:'fail again'}],jobs:[]});return response({});},token:'fake'}));
    expect(res2.results).toBe(1);
    const dispatchedEvents2 = pool.events.filter(e => e.type === 'GITHUB_CODING_DISPATCHED');
    expect(dispatchedEvents2.length).toBe(3);
    expect(dispatchedEvents2[2].data.retryCount).toBe(2);

    // third block hits hard blocker fail-closed (no further retries)
    pool.events.push({
      type:'GITHUB_CODING_DISPATCHED',
      data:{issueNumber:777,issueUrl:'https://github.com/newsdayads/tigeriq-ai-lab/issues/777',codingObjectiveId:'obj-102',ownerDirect:false,sourcePriority:'P1',dispatchPriority:'P1',dispatchReason:'RETRY_2',retryCount:2}
    });
    const res3 = await import('../apps/tigeriq-core/github-coding-intake.mjs').then(m => m.syncGithubCodingOutcomes({pool,fetchImpl:async(u)=>{if(u.includes('/api/status'))return response({objectives:[{id:'obj-102',status:'blocked',summary:'fail hard'}],jobs:[]});return response({});},token:'fake'}));
    expect(res3.results).toBe(1);
    const finalDispatched = pool.events.filter(e => e.type === 'GITHUB_CODING_DISPATCHED');
    expect(finalDispatched.length).toBe(3); // no new dispatch
    const lastResult = pool.events.filter(e => e.type === 'GITHUB_CODING_RESULT_REPORTED').pop();
    expect(lastResult.data.status).toBe('blocked_hard_fail');
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

  pool.events.push({type:'GITHUB_CODING_RESULT_REPORTED',data:{issueNumber:10}});
  out=await materializeGithubCodingIssues({pool,fetchImpl,token:'fake'});
  expect(out.issueNumber).toBe(20);
  expect(posted[1]).toContain('#20');

  pool.events.push({type:'GITHUB_CODING_RESULT_REPORTED',data:{issueNumber:20}});
  out=await materializeGithubCodingIssues({pool,fetchImpl,token:'fake'});
  expect(out.issueNumber).toBe(30);
  expect(posted[2]).toContain('#30');
});
