import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { processGitHubIssue, classifyRisk, isZeroCost } from '../apps/tigeriq-coding-lane/github-intake.mjs';
import { cleanupTerminalObjectiveJobs, materializeGithubIssues, syncGithubOutcomes } from '../apps/tigeriq-core/github-intake.mjs';

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
  const objectives=[]; const events=[]; const jobs=[];
  return {objectives,events,jobs,async query(q,params=[]){
    if(q.includes("metadata->>'source'='github' and status='active'")){
      const active=objectives.filter(o=>o.metadata?.source==='github'&&o.status==='active');
      return {rowCount:active.length,rows:active.map(o=>({metadata:o.metadata}))};
    }
    if(q.includes("select id,status,summary,metadata from tigeriq_objectives where metadata->>'source'='github'")){
      const rows=objectives.filter(o=>o.metadata?.source==='github').map(o=>({id:o.id,status:o.status,summary:o.summary||'',metadata:o.metadata}));
      return {rowCount:rows.length,rows};
    }
    if(q.startsWith('update tigeriq_objectives set status=$2,summary=$3,metadata=metadata||$4::jsonb')){
      const row=objectives.find(o=>o.id===params[0]);
      if(row){row.status=params[1];row.summary=params[2];row.metadata={...row.metadata,...JSON.parse(params[3])};}
      return {rowCount:row?1:0,rows:[]};
    }
    if(q.startsWith('update tigeriq_jobs j')){
      const terminal=new Set(objectives.filter(o=>['completed','blocked'].includes(o.status)).map(o=>o.id));
      const changed=[];
      for(const j of jobs){if(terminal.has(j.objective_id)&&['queued','waiting_resource'].includes(j.status)){j.status='failed';j.failure=JSON.parse(params[0]);changed.push({id:j.id,objective_id:j.objective_id});}}
      return {rowCount:changed.length,rows:changed};
    }
    if(q.includes("metadata->>'source'='github'")&&q.includes("metadata->>'issueNumber'=$1")){
      const matches=objectives.filter(o=>o.metadata?.source==='github'&&String(o.metadata?.issueNumber)===String(params[0]));
      const found=matches.at(-1);
      return {rowCount:found?1:0,rows:found?[{id:found.id,status:found.status,metadata:found.metadata}]:[]};
    }
    if(q.includes('select 1 from tigeriq_objectives where id=$1')){
      const found=objectives.some(o=>o.id===params[0]);
      return {rowCount:found?1:0,rows:found?[{id:params[0]}]:[]};
    }
    if(q.includes('insert into tigeriq_objectives')){
      objectives.push({id:params[0],objective:params[1],priority:params[2],metadata:JSON.parse(params[3]),status:'active'});
      return {rowCount:1,rows:[]};
    }
    if(q.includes('insert into tigeriq_jobs')){
      jobs.push({id:params[0],objective_id:params[1],title:params[2],prompt:params[3],capability:'pc_operator',kind:'pc_operator',status:'queued',max_attempts:2});
      return {rowCount:1,rows:[]};
    }
    if(q.includes("insert into tigeriq_events")){
      events.push({type:q.includes('GITHUB_PC_OPERATOR_JOB_MATERIALIZED')?'GITHUB_PC_OPERATOR_JOB_MATERIALIZED':'GITHUB_OBJECTIVE_MATERIALIZED',objectiveId:params[0],jobId:params[1]||null});
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

test('owner-direct pc_operator GitHub intake materializes bounded OpenClaw objective',async()=>{
  const pool=coreBacklogPool();
  const body=`TIGERIQ_EXECUTABLE=true
OWNER_POLICY=AUTO
OWNER_DIRECT=true
PRIORITY=P0
CAPABILITY=pc_operator
NO_CODE_CHANGE=true
NO_PC01_SHELL=true
RESOURCE_SCOPE=OPENCLAW_TEST_SCOPE
ASSIGNED_ACTION
1. tigeriq_pc tcp_probe host=127.0.0.1 port=18789
2. tigeriq_pc file_write path=D:\\TigerIQ\\State\\canary.txt content=PASS
ACCEPTANCE
Return structured PASS evidence.`;
  const issues=[{number:1608,state:'open',title:'OpenClaw canary',body,html_url:'https://example/1608'}];
  const fetchImpl=async(url)=>url.includes('/issues?')?response(issues):response({});
  const out=await materializeGithubIssues({pool,fetchImpl,token:'fake'});
  assert.strictEqual(out.issueNumber,1608);
  assert.strictEqual(pool.objectives[0].metadata.capability,'pc_operator');
  assert.strictEqual(pool.objectives[0].metadata.executionSurface,'CORE_OPENCLAW_BOUNDED');
  assert.match(pool.objectives[0].objective,/Core must create only the assigned pc_operator work/);
  assert.match(pool.objectives[0].objective,/NO arbitrary PC01 shell/);
  assert.strictEqual(pool.jobs.length,1);
  assert.strictEqual(pool.jobs[0].id,'JOB-GH-1608-PC');
  assert.strictEqual(pool.jobs[0].capability,'pc_operator');
  assert.match(pool.jobs[0].prompt,/tcp_probe host=127.0.0.1 port=18789/);
  assert.doesNotMatch(pool.jobs[0].prompt,/Production\/main/);
});

test('Core manager excludes deterministic CORE_OPENCLAW_BOUNDED objectives',()=>{
  const core=readFileSync(new URL('../apps/tigeriq-core/core.mjs',import.meta.url),'utf8');
  assert.match(core,/executionSurface',''\)<>'CORE_OPENCLAW_BOUNDED'/);
});

test('same GitHub dispatch lane stays serialized and chains by OWNER_DIRECT then priority',async()=>{
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


test('reopened completed GitHub Work Order rearms instead of being skipped forever',async()=>{
  const pool=coreBacklogPool();
  let issues=[{number:50,state:'open',state_reason:null,updated_at:'2026-09-23T01:00:00Z',title:'Rearm me',body:`${READ_ONLY_BASE}\nOWNER_DIRECT=true\nPRIORITY=P0`,html_url:'https://example/50'}];
  const fetchImpl=async(url)=>url.includes('/issues?')?response(issues):response({});
  let out=await materializeGithubIssues({pool,fetchImpl,token:'fake'});
  assert.strictEqual(out.issueNumber,50);
  assert.strictEqual(pool.objectives.length,1);
  pool.objectives[0].status='completed';
  pool.objectives[0].metadata.githubClosed=true;
  issues=[{...issues[0],state_reason:'reopened',updated_at:'2026-09-23T02:00:00Z'}];
  out=await materializeGithubIssues({pool,fetchImpl,token:'fake'});
  assert.strictEqual(out.issueNumber,50);
  assert.strictEqual(pool.objectives.length,2);
  assert.match(pool.objectives[1].id,/^OBJ-GH-50-R/);
  assert.strictEqual(pool.objectives[1].metadata.rearmedFromObjectiveId,'OBJ-GH-50');
});

test('different GitHub dispatch lanes do not starve each other',async()=>{
  const pool=coreBacklogPool();
  const reasoningBody=['TIGERIQ_EXECUTABLE=true','OWNER_POLICY=AUTO','OWNER_DIRECT=true','PRIORITY=P1','CAPABILITY=reasoning','NO_CODE_CHANGE=true','NO_PC01_SHELL=true','RESOURCE_SCOPE=REASONING_ACTIVE'].join('\n');
  const pcBody=['TIGERIQ_EXECUTABLE=true','OWNER_POLICY=AUTO','OWNER_DIRECT=true','PRIORITY=P0','CAPABILITY=pc_operator','NO_CODE_CHANGE=true','NO_PC01_SHELL=true','RESOURCE_SCOPE=PC_STATE','ASSIGNED_ACTION','tigeriq_pc file_write path=D:\\TigerIQ\\State\\lane-canary.txt content=PASS','ACCEPTANCE','PASS'].join('\n');
  let issues=[{number:91,state:'open',title:'reasoning active',body:reasoningBody,html_url:'https://example/91'}];
  const fetchImpl=async(url)=>url.includes('/issues?')?response(issues):response({});
  let out=await materializeGithubIssues({pool,fetchImpl,token:'fake'});
  assert.strictEqual(out.issueNumber,91);
  assert.strictEqual(pool.objectives.at(-1).metadata.dispatchLane,'CORE_REASONING');
  issues=[
    {number:92,state:'open',title:'pc operator P0',body:pcBody,html_url:'https://example/92'},
    {number:91,state:'open',title:'reasoning active',body:reasoningBody,html_url:'https://example/91'},
  ];
  out=await materializeGithubIssues({pool,fetchImpl,token:'fake'});
  assert.strictEqual(out.issueNumber,92);
  assert.strictEqual(pool.objectives.at(-1).metadata.dispatchLane,'PC_OPERATOR');
  assert.strictEqual(pool.objectives.filter(o=>o.status==='active').length,2);
});

test('bounded App Chrome deploy-request State work is not treated as protected App Chrome mutation',async()=>{
  const pool=coreBacklogPool();
  const body=['TIGERIQ_EXECUTABLE=true','OWNER_POLICY=AUTO','OWNER_DIRECT=true','PRIORITY=P0','CAPABILITY=pc_operator','APP_CHROME_REQUEST_ONLY=true','NO_CODE_CHANGE=true','NO_PC01_SHELL=true','RESOURCE_SCOPE=APP_CHROME_DEPLOY_REQUEST_STATE','ASSIGNED_ACTION','Use tigeriq_pc file_write only:','path=D:\\TigerIQ\\State\\appchrome-install-request.json','Then use tigeriq_pc file_read on the same path.','ACCEPTANCE','PASS'].join('\n');
  const issues=[{number:1881,state:'open',title:'[P0][OPENCLAW] request state',body,html_url:'https://example/1881'}];
  const fetchImpl=async(url)=>url.includes('/issues?')?response(issues):response({});
  const out=await materializeGithubIssues({pool,fetchImpl,token:'fake'});
  assert.strictEqual(out.issueNumber,1881);
  assert.strictEqual(pool.objectives.at(-1).metadata.executionSurface,'CORE_OPENCLAW_BOUNDED');
  assert.strictEqual(pool.objectives.at(-1).metadata.dispatchLane,'PC_OPERATOR');
});

test('preferred NV03 review is excluded from generic Core intake to avoid duplicate review',async()=>{
  const pool=coreBacklogPool();
  const body=[READ_ONLY_BASE,'OWNER_DIRECT=true','PRIORITY=P1','PREFERRED_REVIEWER=NV03','RESOURCE_SCOPE=REVIEW_PR_X'].join('\n');
  const issues=[{number:1874,state:'open',title:'preferred UI review',body,html_url:'https://example/1874'}];
  const fetchImpl=async(url)=>url.includes('/issues?')?response(issues):response({});
  const out=await materializeGithubIssues({pool,fetchImpl,token:'fake'});
  assert.strictEqual(out.created,0);
  assert.strictEqual(pool.objectives.length,0);
});
test('terminal objective orphan queued and waiting_resource jobs are failed closed',async()=>{
  const pool=coreBacklogPool();
  pool.objectives.push({id:'OBJ-OLD',status:'blocked',metadata:{source:'api'}});
  pool.jobs.push({id:'JOB-Q',objective_id:'OBJ-OLD',status:'queued'},{id:'JOB-W',objective_id:'OBJ-OLD',status:'waiting_resource'},{id:'JOB-D',objective_id:'OBJ-OLD',status:'done'});
  const out=await cleanupTerminalObjectiveJobs({pool});
  assert.strictEqual(out.cleaned,2);
  assert.strictEqual(pool.jobs.find(j=>j.id==='JOB-Q').status,'failed');
  assert.strictEqual(pool.jobs.find(j=>j.id==='JOB-W').status,'failed');
  assert.strictEqual(pool.jobs.find(j=>j.id==='JOB-D').status,'done');
});


test('closed source issue terminalizes stale active GitHub objective and releases intake lock',async()=>{
  const pool=coreBacklogPool();
  pool.objectives.push({
    id:'OBJ-GH-1620-Rstale',
    status:'active',
    summary:'',
    metadata:{
      source:'github',
      issueNumber:1620,
      executionSurface:'CORE_OPENCLAW_BOUNDED',
      githubClaimReported:true,
      githubResultReported:true,
      sourceRevision:'old',
    },
  });
  const closed={number:1620,state:'closed',state_reason:'not_planned',closed_at:'2026-09-23T10:43:42Z',title:'stale canary',body:''};
  const nextIssue={number:60,state:'open',state_reason:null,updated_at:'2026-09-23T10:44:00Z',title:'next read-only work',body:READ_ONLY_BASE+'\\nOWNER_DIRECT=true\\nPRIORITY=P0',html_url:'https://example/60'};
  const fetchImpl=async(url)=>{
    if(url.endsWith('/issues/1620'))return response(closed);
    if(url.includes('/issues?'))return response([nextIssue]);
    return response({});
  };
  const sync=await syncGithubOutcomes({pool,fetchImpl,token:'fake'});
  assert.deepStrictEqual(sync,{claims:0,results:0});
  assert.strictEqual(pool.objectives[0].status,'blocked');
  assert.strictEqual(pool.objectives[0].metadata.githubSourceState,'closed');
  assert.strictEqual(pool.objectives[0].metadata.githubSourceStateReason,'not_planned');

  const out=await materializeGithubIssues({pool,fetchImpl,token:'fake'});
  assert.strictEqual(out.created,1);
  assert.strictEqual(out.issueNumber,60);
  assert.strictEqual(pool.objectives.at(-1).metadata.issueNumber,60);
});
