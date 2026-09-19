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

  it('automatically releases dependent issues upon completion without duplicate redispatches',async()=>{
    const pool=fakePool();let posted=0;
    const depIssue=issue(SAFE,{number:705,state:'open'});
    const dependentIssue=issue(`${SAFE}\nDEPENDS_ON=#705`,{number:706});
    const fetchImpl=async(url)=>{
      if(url.includes('/issues/705'))return response({number:705,state:posted>1?'closed':'open'});
      if(url.includes('/issues?'))return response([dependentIssue,depIssue]);
      if(url.includes('/api/objectives')){posted++;return response({id:`obj-70${posted}`});}
      if(url.includes('/comments')||url.includes('/issues/706'))return response({});
      if(url.includes('/api/status'))return {ok:true,status:200,text:async()=>JSON.stringify({objectives:[{id:'obj-701',status:'completed',summary:'done'}],jobs:[]})};
      return response({});
    };
    const first=await materializeGithubCodingIssues({pool,fetchImpl,token:'fake'});
    expect(first.created).toBe(0);
    expect(pool.events.filter(e=>e.type==='GITHUB_CODING_DEPENDENCY_WAIT')).toHaveLength(1);
    pool.events.push({type:'GITHUB_CODING_RESULT_REPORTED',data:{issueNumber:705}});
    const second=await materializeGithubCodingIssues({pool,fetchImpl,token:'fake'});
    expect(second.created).toBe(1);
    expect(second.issueNumber).toBe(706);
    const third=await materializeGithubCodingIssues({pool,fetchImpl,token:'fake'});
    expect(third.created).toBe(0);
  });
});

describe('GitHub coding intake bounded recovery and retries',()=>{
  it('performs max 2 automated retries for recoverable terminal failures',async()=>{
    const pool=fakePool();let statusCalls=0;
    const fetchImpl=async(url)=>{
      if(url.includes('/api/status')){
        statusCalls++;
        return response({objectives:[{id:'obj-888',status:'blocked',summary:'Transient network timeout error'}],jobs:[]});
      }
      return response({});
    };
    pool.events.push({type:'GITHUB_CODING_DISPATCHED',data:{issueNumber:888,codingObjectiveId:'obj-888'}});
    const res1=await syncGithubCodingOutcomes({pool,fetchImpl,token:'fake'});
    expect(res1.results).toBe(1);
    expect(pool.events.filter(e=>e.type==='GITHUB_CODING_RETRY')).toHaveLength(1);
    
    const res2=await syncGithubCodingOutcomes({pool,fetchImpl,token:'fake'});
    expect(res2.results).toBe(1);
    expect(pool.events.filter(e=>e.type==='GITHUB_CODING_RETRY')).toHaveLength(2);

    const res3=await syncGithubCodingOutcomes({pool,fetchImpl,token:'fake'});
    expect(res3.results).toBe(1);
    expect(pool.events.filter(e=>e.type==='GITHUB_CODING_MAX_RETRIES_EXCEEDED')).toHaveLength(1);
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
