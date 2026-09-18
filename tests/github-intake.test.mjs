import test from 'node:test';
import assert from 'node:assert';
import { processGitHubIssue, classifyRisk, isZeroCost } from '../apps/tigeriq-coding-lane/github-intake.mjs';
import { materializeGithubIssues } from '../apps/tigeriq-core/github-intake.mjs';

test('isZeroCost checks label correctly', () => {
  assert.strictEqual(isZeroCost([{ name: 'zero-cost-reversible' }]), true);
  assert.strictEqual(isZeroCost(['other', 'zero-cost-reversible']), true);
  assert.strictEqual(isZeroCost(['bug']), false);
  assert.strictEqual(isZeroCost([]), false);
});

test('classifyRisk detects high and low risk keywords', () => {
  assert.strictEqual(classifyRisk('Fix typo', 'just a doc update'), 'low');
  assert.strictEqual(classifyRisk('Delete production database', 'urgent'), 'high');
  assert.strictEqual(classifyRisk('Update credential configuration', ''), 'high');
});

test('successful intake of a valid zero-cost issue', () => {
  const result = processGitHubIssue({issue:{number:42,title:'Add a helpful helper',body:'No risk changes',labels:[{name:'zero-cost-reversible'}]}});
  assert.strictEqual(result.phase, 'plan');
  assert.strictEqual(result.status, 'ready');
  assert.strictEqual(result.owner, 'autonomous-manager');
  assert.strictEqual(result.authorizationNeeded, false);
  assert.strictEqual(result.issueNumber, 42);
});

test('rejection of missing label', () => {
  const result = processGitHubIssue({issue:{number:43,title:'Missing label issue',body:'No labels',labels:[{name:'bug'}]}});
  assert.deepStrictEqual(result,{phase:'rejected',status:'blocked'});
});

test('high-risk detection sets authorizationNeeded and awaiting-review', () => {
  const result = processGitHubIssue({issue:{number:44,title:'Delete production deployment',body:'Dangerous operation',labels:['zero-cost-reversible']}});
  assert.strictEqual(result.phase, 'intake');
  assert.strictEqual(result.status, 'awaiting-review');
  assert.strictEqual(result.authorizationNeeded, true);
  assert.strictEqual(result.owner, null);
});

test('persistence verification through injected evidence sink', () => {
  const evidence=[];
  processGitHubIssue({issue:{number:45,title:'Test persistence',body:'Evidence check',labels:['zero-cost-reversible']}},{storeEvidence:r=>evidence.push(r)});
  assert.strictEqual(evidence.length,1);
  assert.strictEqual(evidence[0].gate,'github-intake');
  assert.strictEqual(evidence[0].status,'pass');
});


function response(data,ok=true,status=200){return {ok,status,json:async()=>data};}

function coreBacklogPool(){
  const objectives=[]; const events=[];
  return {objectives,events,async query(q,params=[]){
    if(q.includes("metadata->>'source'='github' and status='active'")){
      const active=objectives.some(o=>o.metadata?.source==='github'&&o.status==='active');
      return {rowCount:active?1:0,rows:active?[{id:'active'}]:[]};
    }
    if(q.includes('select 1 from tigeriq_objectives where id=$1')){
      const found=objectives.some(o=>o.id===params[0]);
      return {rowCount:found?1:0,rows:found?[{id:params[0]}]:[]};
    }
    if(q.includes('insert into tigeriq_objectives')){
      objectives.push({id:params[0],objective:params[1],priority:params[2],metadata:JSON.parse(params[3]),status:'active'});
      return {rowCount:1,rows:[]};
    }
    if(q.includes("insert into tigeriq_events")){
      events.push({type:'GITHUB_OBJECTIVE_MATERIALIZED',objectiveId:params[0],data:JSON.parse(params[1])});
      return {rowCount:1,rows:[]};
    }
    return {rowCount:0,rows:[]};
  }};
}

const READ_ONLY_BASE=`TIGERIQ_EXECUTABLE=true
OWNER_POLICY=AUTO
NO_CODE_CHANGE=true
NO_PC01_SHELL=true
CAPABILITY=review`;

test('read-only GitHub backlog runs one-at-a-time and chains by OWNER_DIRECT then priority',async()=>{
  const pool=coreBacklogPool();
  const issues=[
    {number:30,state:'open',title:'non-owner P0',body:`${READ_ONLY_BASE}\nPRIORITY=P0`,html_url:'https://example/30'},
    {number:20,state:'open',title:'owner P2',body:`${READ_ONLY_BASE}\nOWNER_DIRECT=true\nPRIORITY=P2`,html_url:'https://example/20'},
    {number:10,state:'open',title:'owner P1',body:`${READ_ONLY_BASE}\nOWNER_DIRECT=true\nPRIORITY=P1`,html_url:'https://example/10'},
  ];
  const fetchImpl=async(url)=>url.includes('/issues?')?response(issues):response({});
  let out=await materializeGithubIssues({pool,fetchImpl,token:'fake'});
  assert.strictEqual(out.issueNumber,10);
  assert.strictEqual(pool.objectives.at(-1).metadata.dispatchReason,'OWNER_DIRECT>P1');

  out=await materializeGithubIssues({pool,fetchImpl,token:'fake'});
  assert.strictEqual(out.created,0);
  assert.strictEqual(out.active,1);

  pool.objectives.at(-1).status='completed';
  out=await materializeGithubIssues({pool,fetchImpl,token:'fake'});
  assert.strictEqual(out.issueNumber,20);

  pool.objectives.at(-1).status='completed';
  out=await materializeGithubIssues({pool,fetchImpl,token:'fake'});
  assert.strictEqual(out.issueNumber,30);
  assert.deepStrictEqual(pool.objectives.map(o=>o.metadata.issueNumber),[10,20,30]);
});
