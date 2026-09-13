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
