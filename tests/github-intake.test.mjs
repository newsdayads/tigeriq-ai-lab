import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { processGitHubIssue, classifyRisk, isZeroCost } from '../apps/tigeriq-coding-lane/github-intake.mjs';
import { buildGithubPcOperatorPrompt, cleanupTerminalObjectiveJobs, materializeGithubIssues, parseExecutableIssue, reusableAcceptedSiblingMetadata, safeAutoWorkAdmission, syncGithubOutcomes } from '../apps/tigeriq-core/github-intake.mjs';
import { parseOpenWorkIssue } from '../api/live-status.mjs';

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


function response(data,ok=true,status=200,headerValues={}){
  const raw=status===204?'':JSON.stringify(data);
  const normalized=Object.fromEntries(Object.entries(headerValues||{}).map(([key,value])=>[String(key).toLowerCase(),String(value)]));
  return {ok,status,headers:{get:(name)=>normalized[String(name||'').toLowerCase()]||null},json:async()=>data,text:async()=>raw};
}

function coreBacklogPool(options={}){
  const objectives=[]; const events=[]; const jobs=[]; const queries=[];
  let routingFaultInsertFailures=Math.max(0,Number(options.routingFaultInsertFailures||0));
  let routingFaultTerminalQueryFailures=Math.max(0,Number(options.routingFaultTerminalQueryFailures||0));
  return {objectives,events,jobs,queries,async query(q,params=[]){
    queries.push(q);
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
    if(q.startsWith('update tigeriq_objectives set metadata=metadata||$2::jsonb')){
      const row=objectives.find(o=>o.id===params[0]);
      if(row)row.metadata={...row.metadata,...JSON.parse(params[1])};
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
      const apiAutowork=q.includes("'reasoning','github_api_autowork'");
      jobs.push({id:params[0],objective_id:params[1],title:params[2],prompt:params[3],capability:apiAutowork?'reasoning':'pc_operator',kind:apiAutowork?'github_api_autowork':'pc_operator',status:'queued',max_attempts:2});
      return {rowCount:1,rows:[]};
    }
    if(q.includes("select type,data from tigeriq_events")&&q.includes("ROUTING_FAULT_CLEAR")){
      if(routingFaultTerminalQueryFailures>0){
        routingFaultTerminalQueryFailures--;
        throw new Error('SIMULATED_TERMINAL_ROUTING_QUERY_FAILURE');
      }
      const reason=String(params[0]||'');
      const rows=events
        .filter((e)=>String(e.data?.reason||'')===reason
          &&((e.type==='ROUTING_FAULT'&&e.data?.terminalBlocked===true)||e.type==='ROUTING_FAULT_CLEAR'))
        .map((e)=>({type:e.type,data:e.data}));
      return {rowCount:rows.length,rows};
    }
    if(q.includes("from tigeriq_events where type='ROUTING_FAULT'")){
      const ownerVisibleOnly=q.includes("data->>'ownerVisible'='true'");
      const terminalBlockedOnly=q.includes("data->>'terminalBlocked'='true'");
      const sourceRevision=String(params[2]||'');
      const found=events.some((e)=>e.type==='ROUTING_FAULT'
        &&String(e.data?.issueNumber)===String(params[0])
        &&String(e.data?.reason)===String(params[1])
        &&(!sourceRevision||String(e.data?.sourceRevision||'')===sourceRevision)
        &&(!ownerVisibleOnly||e.data?.ownerVisible===true)
        &&(!terminalBlockedOnly||e.data?.terminalBlocked===true));
      return {rowCount:found?1:0,rows:found?[{ok:1}]:[]};
    }
    if(q.includes("insert into tigeriq_events")){
      if(q.includes("'ROUTING_FAULT_CLEAR'")){
        events.push({type:'ROUTING_FAULT_CLEAR',data:JSON.parse(params[0])});
      }else if(q.includes("'ROUTING_FAULT'")){
        if(routingFaultInsertFailures>0){
          routingFaultInsertFailures--;
          throw new Error('SIMULATED_ROUTING_FAULT_INSERT_FAILURE');
        }
        events.push({type:'ROUTING_FAULT',data:JSON.parse(params[0])});
      }else{
        events.push({type:q.includes('GITHUB_PC_OPERATOR_JOB_MATERIALIZED')?'GITHUB_PC_OPERATOR_JOB_MATERIALIZED':'GITHUB_OBJECTIVE_MATERIALIZED',objectiveId:params[0],jobId:params[1]||null});
      }
      return {rowCount:1,rows:[]};
    }
    return {rowCount:0,rows:[]};
  }};
}

const READ_ONLY_BASE=`TIGERIQ_EXECUTABLE=true
OWNER_POLICY=AUTO
NO_CODE_CHANGE=true
NO_PC01_SHELL=true
CAPABILITY=reasoning`;

const SAFE_AUTO_POLICY_BASE=`PRIORITY=P1
ZERO_COST=true
NO_PC01_SHELL=true
NO_PAID_COST=true
NO_CREDENTIAL_CHANGE=true
NO_SECURITY_BOUNDARY_CHANGE=true
NO_PRODUCTION_RELEASE=true
NO_DESTRUCTIVE=true
NO_DIRECT_MAIN=true
RESOURCE_SCOPE=SAFE_AUTO_TEST
CAPABILITY=coding
EXECUTION_SURFACE=CODING`;

test('safe P1-P5 policy admission does not require legacy TIGERIQ_EXECUTABLE/NO_CODE_CHANGE flags',()=>{
  const issue={number:2474,state:'open',title:'[P1][CORE] safe coding coordination',body:SAFE_AUTO_POLICY_BASE,labels:[],html_url:'https://example/2474'};
  const admission=safeAutoWorkAdmission(issue);
  assert.deepStrictEqual({eligible:admission.eligible,reason:admission.reason,requiresCodingHandoff:admission.requiresCodingHandoff},{eligible:true,reason:'SAFE_P1_P5_POLICY',requiresCodingHandoff:true});
  const spec=parseExecutableIssue(issue);
  assert.ok(spec);
  assert.strictEqual(spec.admissionMode,'SAFE_P1_P5_POLICY');
  assert.strictEqual(spec.requestedCapability,'coding');
  assert.strictEqual(spec.capability,'reasoning');
  assert.strictEqual(spec.dispatchLane,'CORE_REASONING');
  assert.strictEqual(spec.requiresCodingHandoff,true);
  assert.strictEqual(spec.keepOpenOnStepComplete,true);
  assert.strictEqual(spec.targetWorker,null);
});

test('stability v2 safe intake creates objective without generic API auto-work helper job',async()=>{
  const pool=coreBacklogPool();
  const body=SAFE_AUTO_POLICY_BASE
    .replace('RESOURCE_SCOPE=SAFE_AUTO_TEST','RESOURCE_SCOPE=API_WORKFORCE_FUNCTIONAL_STABILITY_V2')
    .replace('CAPABILITY=coding','CAPABILITY=reasoning')
    .replace('EXECUTION_SURFACE=CODING','EXECUTION_SURFACE=CORE_REASONING')
    +'\nMUTATION_OWNER=CORE_DYNAMIC_LEASE';
  const issue={number:2891,state:'open',title:'[P1][API WORKFORCE][STABILITY V2] deterministic',body,labels:[],comments:0,html_url:'https://example/2891'};
  const spec=parseExecutableIssue(issue);
  assert.ok(spec);
  assert.strictEqual(spec.resourceScope,'API_WORKFORCE_FUNCTIONAL_STABILITY_V2');
  assert.strictEqual(spec.dispatchLane,'CORE_REASONING');
  const out=await materializeGithubIssues({pool,openIssues:[issue],token:'fake'});
  assert.strictEqual(out.created,1);
  assert.strictEqual(pool.objectives.length,1);
  assert.strictEqual(pool.jobs.length,0,'deterministic stability planner must own job materialization; no generic helper auto-work');
});

test('safe P1-P5 policy fails closed on P0, Owner/HOLD, dependency, App Chrome, UI owner, hard gate, active owner, and terminal-blocked',()=>{
  const base={number:2500,state:'open',title:'[P1][CORE] candidate',body:SAFE_AUTO_POLICY_BASE,labels:[]};
  const cases=[
    [{...base,title:'[P0][CORE] p0',body:SAFE_AUTO_POLICY_BASE.replace('PRIORITY=P1','PRIORITY=P0')},'P0_OR_INVALID_PRIORITY'],
    [{...base,body:SAFE_AUTO_POLICY_BASE+'\nOWNER_HOLD=true'},'OWNER_OR_HOLD_GATE'],
    [{...base,body:SAFE_AUTO_POLICY_BASE+'\nOWNER_POLICY=MANUAL'},'OWNER_POLICY_NOT_AUTO'],
    [{...base,body:SAFE_AUTO_POLICY_BASE+'\nCURRENT_STATE=WAITING_PARENT_GATE'},'DEPENDENCY_BLOCKED'],
    [{...base,title:'[P1][APP-CHROME] excluded'},'APP_CHROME_EXCLUDED'],
    [{...base,body:SAFE_AUTO_POLICY_BASE+'\nASSIGNED_EXECUTOR=NV02'},'OWNER_OR_UI_ROUTE'],
    [{...base,body:SAFE_AUTO_POLICY_BASE.replace('NO_SECURITY_BOUNDARY_CHANGE=true','NO_SECURITY_BOUNDARY_CHANGE=false')},'HARD_GATE_SAFETY_FLAGS_INCOMPLETE'],
    [{...base,body:SAFE_AUTO_POLICY_BASE+'\nMUTATION_OWNER=NV12'},'MUTATION_OWNER_CONFLICT'],
    [{...base,body:SAFE_AUTO_POLICY_BASE+'\nTIGERIQ_EXECUTABLE=false'},'EXPLICIT_EXECUTION_DISABLED'],
    [{...base,body:SAFE_AUTO_POLICY_BASE+'\nAUTO_QUEUE=EXCLUDED'},'AUTO_QUEUE_EXCLUDED'],
    [{...base,body:SAFE_AUTO_POLICY_BASE+'\nAUTO_QUEUE=EXCLUDED_PARENT_COORDINATION'},'AUTO_QUEUE_EXCLUDED'],
    [{...base,body:SAFE_AUTO_POLICY_BASE+'\nAUTO_QUEUE=EXCLUDED_UNTIL_DEPENDENCY'},'AUTO_QUEUE_EXCLUDED'],
    [{...base,labels:[{name:'tigeriq:terminal-blocked'}]},'TERMINAL_BLOCKED'],
  ];
  for(const [issue,reason] of cases)assert.deepStrictEqual({eligible:safeAutoWorkAdmission(issue).eligible,reason:safeAutoWorkAdmission(issue).reason},{eligible:false,reason});
});

test('generic API intake does not intercept explicit NV03/NV04 UI targets',()=>{
  const common=['PRIORITY=P1','ZERO_COST=true','OWNER_POLICY=AUTO','NO_PC01_SHELL=true','NO_PAID_COST=true','NO_CREDENTIAL_CHANGE=true','NO_SECURITY_BOUNDARY_CHANGE=true','NO_PRODUCTION_RELEASE=true','NO_DESTRUCTIVE=true','NO_DIRECT_MAIN=true','RESOURCE_SCOPE=UI_TARGET_TEST'];
  const review={number:2678,state:'open',title:'[P1][REVIEW] explicit NV03',body:[...common,'CAPABILITY=review','TARGET_EMPLOYEE=NV03'].join('\n'),labels:[]};
  const research={number:2679,state:'open',title:'[P1][RESEARCH] explicit NV04',body:[...common,'CAPABILITY=deep_research','TARGET_EMPLOYEE=NV04'].join('\n'),labels:[]};
  for(const issue of [review,research]){
    assert.deepStrictEqual({eligible:safeAutoWorkAdmission(issue).eligible,reason:safeAutoWorkAdmission(issue).reason},{eligible:false,reason:'OWNER_OR_UI_ROUTE'});
    assert.strictEqual(parseExecutableIssue(issue),null);
  }
});

test('safe coding Work Order materializes one API coordination job without taking coding ownership',async()=>{
  const pool=coreBacklogPool();
  const issue={number:2474,state:'open',title:'[P1][CORE] safe coding coordination',body:SAFE_AUTO_POLICY_BASE,labels:[],comments:0,html_url:'https://example/2474'};
  const out=await materializeGithubIssues({pool,openIssues:[issue],token:'fake'});
  assert.strictEqual(out.created,1);
  assert.strictEqual(out.issueNumber,2474);
  assert.strictEqual(pool.objectives.length,1);
  assert.strictEqual(pool.objectives[0].metadata.admissionMode,'SAFE_P1_P5_POLICY');
  assert.strictEqual(pool.objectives[0].metadata.requestedCapability,'coding');
  assert.strictEqual(pool.objectives[0].metadata.capability,'reasoning');
  assert.strictEqual(pool.objectives[0].metadata.executionSurface,'CORE_REASONING_COORDINATION');
  assert.strictEqual(pool.objectives[0].metadata.keepOpenOnStepComplete,true);
  assert.match(pool.objectives[0].objective,/must not mutate source or claim coding\/review ownership/);
  assert.strictEqual(pool.jobs.length,1);
  assert.strictEqual(pool.jobs[0].kind,'github_api_autowork');
  assert.strictEqual(pool.jobs[0].capability,'reasoning');
  assert.match(pool.jobs[0].prompt,/without repository mutation/);
});

test('blocked Core coordination for coding handoff clears terminal label and leaves source Work Order non-terminal',async()=>{
  const pool=coreBacklogPool();
  const issue={number:2474,state:'open',state_reason:null,title:'[P1][CORE] coding handoff blocked coordination',body:SAFE_AUTO_POLICY_BASE,labels:[{name:'tigeriq:terminal-blocked'}],comments:0,html_url:'https://example/2474'};
  const spec=parseExecutableIssue(issue);
  assert.ok(spec?.requiresCodingHandoff);
  pool.objectives.push({
    id:'OBJ-GH-2474',
    status:'blocked',
    summary:'coordination reviewer unavailable',
    metadata:{
      source:'github',issueNumber:2474,resourceScope:'SAFE_AUTO_TEST',sourceRevision:spec.sourceRevision,
      requiresCodingHandoff:true,githubClaimReported:true,githubResultReported:true,githubTerminalLabelSynced:false,
    },
  });
  let labelAdds=0,labelClears=0;
  const fetchImpl=async(url,init={})=>{
    const method=String(init.method||'GET').toUpperCase();
    if(method==='POST'&&url.endsWith('/issues/2474/labels')){labelAdds++;return response([]);}
    if(method==='DELETE'&&url.includes('/issues/2474/labels/')){labelClears++;return response({},true,204);}
    return response({});
  };
  await syncGithubOutcomes({pool,fetchImpl,token:'fake',openIssues:[issue],issueNumbers:[2474]});
  assert.strictEqual(labelAdds,0);
  assert.strictEqual(labelClears,1);
});

test('safe P1-P5 duplicate event does not create a second objective or job',async()=>{
  const pool=coreBacklogPool();
  const issue={number:2474,state:'open',title:'[P1][CORE] dedupe',body:SAFE_AUTO_POLICY_BASE,labels:[],comments:0,html_url:'https://example/2474'};
  const first=await materializeGithubIssues({pool,openIssues:[issue],token:'fake'});
  const second=await materializeGithubIssues({pool,openIssues:[issue],token:'fake'});
  assert.strictEqual(first.created,1);
  assert.strictEqual(second.created,0);
  assert.strictEqual(pool.objectives.length,1);
  assert.strictEqual(pool.jobs.length,1);
});

test('generic terminal-blocked exact current revision stays blocked',async()=>{
  const pool=coreBacklogPool();
  const issue={number:2871,state:'open',title:'[P1][CORE] exact terminal',body:SAFE_AUTO_POLICY_BASE.replace('SAFE_AUTO_TEST','GENERIC_TERMINAL_EXACT'),labels:[],comments:0,html_url:'https://example/2871',updated_at:'2026-10-02T05:00:00Z'};
  let out=await materializeGithubIssues({pool,openIssues:[issue],token:'fake'});
  assert.strictEqual(out.created,1);
  assert.strictEqual(pool.objectives.length,1);
  pool.objectives[0].status='blocked';
  issue.labels=[{name:'tigeriq:terminal-blocked'}];
  let labelClears=0;
  const fetchImpl=async(url,init={})=>{
    if(String(init.method||'GET').toUpperCase()==='DELETE'&&url.includes('/issues/2871/labels/')){
      labelClears++;
      issue.labels=[];
      return response({},true,204);
    }
    return response({});
  };
  out=await materializeGithubIssues({pool,openIssues:[issue],fetchImpl,token:'fake'});
  assert.strictEqual(out.created,0);
  assert.strictEqual(labelClears,0);
  assert.strictEqual(pool.objectives.length,1);
});

test('generic stale terminal-blocked label clears once on fresh source revision and materializes exactly one rearm',async()=>{
  const pool=coreBacklogPool();
  const issue={number:2872,state:'open',title:'[P1][CORE] stale terminal rearm',body:SAFE_AUTO_POLICY_BASE.replace('SAFE_AUTO_TEST','GENERIC_TERMINAL_REARM'),labels:[],comments:0,html_url:'https://example/2872',updated_at:'2026-10-02T05:00:00Z'};
  let out=await materializeGithubIssues({pool,openIssues:[issue],token:'fake'});
  assert.strictEqual(out.created,1);
  pool.objectives[0].status='blocked';
  issue.body+='\nREARM_GENERATION=2';
  issue.updated_at='2026-10-02T05:05:00Z';
  issue.labels=[{name:'tigeriq:terminal-blocked'}];
  let labelClears=0;
  const fetchImpl=async(url,init={})=>{
    if(String(init.method||'GET').toUpperCase()==='DELETE'&&url.includes('/issues/2872/labels/')){
      labelClears++;
      issue.labels=[];
      return response({},true,204);
    }
    return response({});
  };
  out=await materializeGithubIssues({pool,openIssues:[issue],fetchImpl,token:'fake'});
  assert.strictEqual(out.created,1);
  assert.strictEqual(labelClears,1);
  assert.strictEqual(pool.objectives.length,2);
  assert.strictEqual(pool.jobs.length,2);
  assert.strictEqual(pool.events.filter((e)=>e.type==='ROUTING_FAULT_CLEAR'&&e.data?.reason==='STALE_TERMINAL_LABEL_REARM').length,1);
  const projected=parseOpenWorkIssue(issue);
  assert.ok(projected);
  assert.notStrictEqual(projected.status,'BLOCKED');
  assert.strictEqual(projected.status,'OPEN');

  out=await materializeGithubIssues({pool,openIssues:[issue],fetchImpl,token:'fake'});
  assert.strictEqual(out.created,0);
  assert.strictEqual(labelClears,1);
  assert.strictEqual(pool.objectives.length,2);
  assert.strictEqual(pool.jobs.length,2);
});

test('terminal outcome sync preserves old revision so a fresh executable source revision rearms exactly once',async()=>{
  const pool=coreBacklogPool();
  const issue={number:2891,state:'open',title:'[P1][CORE] terminal revision rearm',body:SAFE_AUTO_POLICY_BASE.replace('SAFE_AUTO_TEST','TERMINAL_REVISION_REARM')+'\nLIVE_ACCEPTANCE_REQUIRED=true',labels:[],comments:0,html_url:'https://example/2891',updated_at:'2026-10-02T15:20:49Z'};
  let out=await materializeGithubIssues({pool,openIssues:[issue],token:'fake'});
  assert.strictEqual(out.created,1);
  const prior=pool.objectives[0];
  const priorRevision=prior.metadata.sourceRevision;
  prior.status='blocked';
  prior.metadata={...prior.metadata,githubClaimReported:false,githubResultReported:true,githubTerminalLabelSynced:true,liveAcceptanceRequired:true};
  issue.body+='\nREARMED_AT=2026-10-02T15:22:53Z';
  issue.updated_at='2026-10-02T15:22:53Z';
  const fetchImpl=async(url)=>{
    if(String(url).includes('/issues/2891/comments'))return response([]);
    if(String(url).endsWith('/issues/2891'))return response(issue);
    return response({});
  };
  await syncGithubOutcomes({pool,fetchImpl,token:'fake',openIssues:[issue],issueNumbers:[2891]});
  assert.strictEqual(prior.metadata.sourceRevision,priorRevision,'terminal objective must retain the revision it executed');
  out=await materializeGithubIssues({pool,openIssues:[issue],fetchImpl,token:'fake'});
  assert.strictEqual(out.created,1);
  assert.strictEqual(pool.objectives.length,2);
  assert.notStrictEqual(pool.objectives[1].metadata.sourceRevision,priorRevision);
  const repeat=await materializeGithubIssues({pool,openIssues:[issue],fetchImpl,token:'fake'});
  assert.strictEqual(repeat.created,0);
  assert.strictEqual(pool.objectives.length,2);
});

test('generic stale terminal label is not cleared for explicit non-executable coordination work',async()=>{
  const pool=coreBacklogPool();
  const issue={number:2873,state:'open',title:'[P1][CORE] coordination parent',body:SAFE_AUTO_POLICY_BASE.replace('SAFE_AUTO_TEST','GENERIC_TERMINAL_PARENT')+'\nTIGERIQ_EXECUTABLE=false\nAUTO_QUEUE=EXCLUDED_PARENT_COORDINATION',labels:[],comments:0,html_url:'https://example/2873',updated_at:'2026-10-02T05:00:00Z'};
  pool.objectives.push({id:'OBJ-GH-2873',status:'blocked',metadata:{source:'github',issueNumber:2873,resourceScope:'GENERIC_TERMINAL_PARENT',sourceRevision:'older'}});
  issue.body+='\nREARM_GENERATION=2';
  issue.labels=[{name:'tigeriq:terminal-blocked'}];
  let labelClears=0;
  const fetchImpl=async(url,init={})=>{
    if(String(init.method||'GET').toUpperCase()==='DELETE'&&url.includes('/issues/2873/labels/')){
      labelClears++;
      return response({},true,204);
    }
    return response({});
  };
  const out=await materializeGithubIssues({pool,openIssues:[issue],fetchImpl,token:'fake'});
  assert.strictEqual(out.created,0);
  assert.strictEqual(labelClears,0);
  assert.strictEqual(pool.objectives.length,1);
  assert.strictEqual(pool.jobs.length,0);
});

test('outcome sync retires a stale active objective when current source becomes explicitly non-executable without mutating GitHub source',async()=>{
  const pool=coreBacklogPool();
  pool.objectives.push({
    id:'OBJ-GH-2811-R-old',
    status:'active',
    summary:'stale active coordination objective',
    metadata:{source:'github',issueNumber:2811,sourceRevision:'oldrevision',resourceScope:'API_HEALTH_PARENT',githubClaimReported:true},
  });
  pool.jobs.push({id:'JOB-2811-Q',objective_id:'OBJ-GH-2811-R-old',status:'queued'});
  pool.jobs.push({id:'JOB-2811-W',objective_id:'OBJ-GH-2811-R-old',status:'waiting_resource'});
  const issue={
    number:2811,state:'open',state_reason:null,title:'[P1][API HEALTH][UI] parent owner gate',
    body:SAFE_AUTO_POLICY_BASE.replace('SAFE_AUTO_TEST','API_HEALTH_PARENT')+'\nTIGERIQ_EXECUTABLE=false\nAUTO_QUEUE=EXCLUDED_PARENT_COORDINATION',
    labels:[],comments:0,updated_at:'2026-10-02T05:26:46Z',html_url:'https://example/2811',
  };
  let mutations=0;
  const fetchImpl=async(url,init={})=>{
    const method=String(init.method||'GET').toUpperCase();
    if(method!=='GET')mutations++;
    if(method==='GET'&&/\/issues\/2811(?:$|\?)/.test(String(url)))return response(issue);
    return response([]);
  };
  const out=await syncGithubOutcomes({pool,fetchImpl,token:'fake',openIssues:[issue],issueNumbers:[2811]});
  assert.deepStrictEqual(out,{claims:0,results:0});
  assert.strictEqual(pool.objectives[0].status,'blocked');
  assert.strictEqual(pool.objectives[0].metadata.githubSourceExecutionExcluded,true);
  assert.strictEqual(pool.objectives[0].metadata.githubSourceExecutionExclusionReason,'EXPLICIT_EXECUTION_DISABLED');
  assert.strictEqual(pool.objectives[0].metadata.githubResultReported,true);
  assert.strictEqual(pool.objectives[0].metadata.githubTerminalLabelSynced,true);
  assert.strictEqual(pool.jobs[0].status,'failed');
  assert.strictEqual(pool.jobs[1].status,'failed');
  assert.strictEqual(mutations,0,'retiring stale Core work must not label/comment/close the still-open Owner-gated issue');
});

test('safe P1-P5 same RESOURCE_SCOPE is blocked by an active writer',async()=>{
  const pool=coreBacklogPool();
  pool.objectives.push({id:'OBJ-OTHER',status:'active',metadata:{source:'github',issueNumber:2400,resourceScope:'SAFE_AUTO_TEST'}});
  const issue={number:2474,state:'open',title:'[P1][CORE] scope conflict',body:SAFE_AUTO_POLICY_BASE,labels:[],comments:0,html_url:'https://example/2474'};
  const out=await materializeGithubIssues({pool,openIssues:[issue],token:'fake'});
  assert.strictEqual(out.created,0);
  assert.strictEqual(pool.objectives.length,1);
  assert.strictEqual(pool.jobs.length,0);
});

test('safe P1-P5 active external role lease is not claimed by Core',async()=>{
  const pool=coreBacklogPool();
  const issue={number:2474,state:'open',title:'[P1][CORE] externally claimed',body:SAFE_AUTO_POLICY_BASE,labels:[],comments:1,html_url:'https://example/2474'};
  const claim={id:1,created_at:'2026-09-30T00:00:00Z',body:'[TIGERIQ_ROLE_CLAIM_V1]\nWORKER=NV12\nRESOURCE_SCOPE=SAFE_AUTO_TEST\nLEASE_UNTIL=2999-01-01T00:00:00Z'};
  const fetchImpl=async(url,init={})=>{
    if(String(init.method||'GET').toUpperCase()==='GET'&&url.includes('/issues/2474/comments?'))return response([claim]);
    return response({});
  };
  const out=await materializeGithubIssues({pool,openIssues:[issue],fetchImpl,token:'fake'});
  assert.strictEqual(out.created,0);
  assert.strictEqual(out.externalClaims,1);
  assert.strictEqual(pool.objectives.length,0);
  assert.strictEqual(pool.jobs.length,0);
});

test('pc_operator public evidence prompt is opt-in, allowlisted, and forbids raw content',()=>{
  const assigned='Use exactly tigeriq_pc action=file_read path="D:\\TigerIQ\\State\\core-runtime-updater.json".';
  const plain=buildGithubPcOperatorPrompt(assigned,[]);
  assert.match(plain,/ASSIGNED ACTION:/);
  assert.doesNotMatch(plain,/PUBLIC EVIDENCE CONTRACT/);
  const prompt=buildGithubPcOperatorPrompt(assigned,['installedSha','result','notAllowed'],{directAction:true});
  assert.match(prompt,/pre-admitted typed local PC action/);
  assert.match(prompt,/REQUESTED_PUBLIC_EVIDENCE_KEYS=installedSha,result/);
  assert.doesNotMatch(prompt,/notAllowed/);
  assert.match(prompt,/copy ONLY the requested keys/);
  assert.match(prompt,/Do not echo raw file content/);
  assert.match(prompt,/never invent a value/);
  const nearLimit='x'.repeat(5700);
  assert.ok(buildGithubPcOperatorPrompt(nearLimit,[]).length<=6000);
  assert.throws(()=>buildGithubPcOperatorPrompt(nearLimit,['installedSha']),/OPENCLAW_INSTRUCTION_INVALID/);
  assert.ok(buildGithubPcOperatorPrompt(nearLimit,['installedSha'],{directAction:true}).length>6000);
});

test('oversized pc_operator public evidence prompt is terminal-blocked per source revision and rearms only after source update',async()=>{
  const pool=coreBacklogPool();
  const assigned='x'.repeat(5700);
  const baseBody=`TIGERIQ_EXECUTABLE=true
OWNER_POLICY=AUTO
OWNER_DIRECT=true
PRIORITY=P1
CAPABILITY=pc_operator
NO_CODE_CHANGE=true
NO_PC01_SHELL=true
RESOURCE_SCOPE=OPENCLAW_OVERSIZE_TEST
PUBLIC_EVIDENCE_KEYS=installedSha
ASSIGNED_ACTION
${assigned}
ACCEPTANCE
Return requested public evidence only.`;
  let issues=[{number:1609,state:'open',title:'oversized OpenClaw canary',body:baseBody,html_url:'https://example/1609'}];
  const comments=[];
  let labelAdds=0,labelClears=0;
  const fetchImpl=async(url,init={})=>{
    if(url.includes('/issues?'))return response(issues);
    const method=String(init.method||'GET').toUpperCase();
    if(method==='POST'&&url.endsWith('/issues/1609/comments')){
      comments.push(JSON.parse(init.body).body);
      return response({id:comments.length});
    }
    if(method==='POST'&&url.endsWith('/issues/1609/labels')){
      labelAdds++;
      return response([]);
    }
    if(method==='DELETE'&&url.includes('/issues/1609/labels/')){
      labelClears++;
      return response({},true,204);
    }
    return response({});
  };
  let out=await materializeGithubIssues({pool,fetchImpl,token:'fake'});
  assert.strictEqual(out.created,0);
  assert.strictEqual(pool.objectives.length,0);
  assert.strictEqual(pool.jobs.length,0);
  assert.strictEqual(comments.length,1);
  assert.match(comments[0],/OPENCLAW_INSTRUCTION_INVALID/);
  assert.match(comments[0],/before objective\/job materialization/);
  let terminalFaults=pool.events.filter((e)=>e.type==='ROUTING_FAULT'&&e.data?.terminalBlocked===true);
  assert.strictEqual(terminalFaults.length,1);
  assert.ok(terminalFaults[0].data.sourceRevision);
  assert.strictEqual(labelAdds,1);
  assert.strictEqual(labelClears,0);

  out=await materializeGithubIssues({pool,fetchImpl,token:'fake'});
  assert.strictEqual(out.created,0);
  assert.strictEqual(comments.length,1);
  assert.strictEqual(labelAdds,1);
  assert.strictEqual(labelClears,0);
  assert.strictEqual(pool.events.filter((e)=>e.type==='ROUTING_FAULT').length,1);

  const firstRevision=terminalFaults[0].data.sourceRevision;
  issues=[{...issues[0],body:baseBody+'\nREARM_GENERATION=2'}];
  out=await materializeGithubIssues({pool,fetchImpl,token:'fake'});
  assert.strictEqual(out.created,0);
  assert.strictEqual(comments.length,2);
  assert.strictEqual(labelClears,1);
  assert.strictEqual(labelAdds,2);
  terminalFaults=pool.events.filter((e)=>e.type==='ROUTING_FAULT'&&e.data?.terminalBlocked===true);
  assert.strictEqual(terminalFaults.length,2);
  assert.notStrictEqual(terminalFaults[1].data.sourceRevision,firstRevision);
});

test('pc_operator intake fails closed when terminal routing state cannot be read',async()=>{
  const pool=coreBacklogPool({routingFaultTerminalQueryFailures:1});
  const body=[
    'TIGERIQ_EXECUTABLE=true','OWNER_POLICY=AUTO','OWNER_DIRECT=true','PRIORITY=P1',
    'CAPABILITY=pc_operator','NO_CODE_CHANGE=true','NO_PC01_SHELL=true',
    'RESOURCE_SCOPE=OPENCLAW_TERMINAL_QUERY_FAIL_CLOSED',
    'ASSIGNED_ACTION','Use exactly tigeriq_pc action=tcp_probe host="127.0.0.1" port=8798.',
    'ACCEPTANCE','Return bounded evidence.',
  ].join('\n');
  const issues=[{number:1608,state:'open',title:'terminal state query fail closed',body,html_url:'https://example/1608'}];
  await assert.rejects(
    ()=>materializeGithubIssues({pool,openIssues:issues,token:'fake'}),
    /SIMULATED_TERMINAL_ROUTING_QUERY_FAILURE/,
  );
  assert.strictEqual(pool.objectives.length,0);
  assert.strictEqual(pool.jobs.length,0);
});

test('pc_operator rearm fails closed until stale terminal label clears',async()=>{
  const pool=coreBacklogPool();
  const assigned='x'.repeat(5700);
  const baseBody=[
    'TIGERIQ_EXECUTABLE=true','OWNER_POLICY=AUTO','OWNER_DIRECT=true','PRIORITY=P1',
    'CAPABILITY=pc_operator','NO_CODE_CHANGE=true','NO_PC01_SHELL=true',
    'RESOURCE_SCOPE=OPENCLAW_REARM_CLEAR','PUBLIC_EVIDENCE_KEYS=installedSha',
    'ASSIGNED_ACTION',assigned,'ACCEPTANCE','Return requested public evidence only.',
  ].join('\n');
  let issues=[{number:1610,state:'open',title:'oversized rearm clear',body:baseBody,html_url:'https://example/1610'}];
  const comments=[];
  let labelAdds=0,labelClears=0,failNextClear=true;
  const fetchImpl=async(url,init={})=>{
    if(url.includes('/issues?'))return response(issues);
    const method=String(init.method||'GET').toUpperCase();
    if(method==='POST'&&url.endsWith('/issues/1610/comments')){
      comments.push(JSON.parse(init.body).body);
      return response({id:comments.length});
    }
    if(method==='POST'&&url.endsWith('/issues/1610/labels')){
      labelAdds++;
      return response([]);
    }
    if(method==='DELETE'&&url.includes('/issues/1610/labels/')){
      labelClears++;
      if(failNextClear){
        failNextClear=false;
        return response({message:'temporary'},false,503);
      }
      return response({},true,204);
    }
    return response({});
  };

  let out=await materializeGithubIssues({pool,fetchImpl,token:'fake'});
  assert.strictEqual(out.created,0);
  assert.strictEqual(comments.length,1);
  assert.strictEqual(labelAdds,1);
  assert.strictEqual(pool.events.filter((e)=>e.type==='ROUTING_FAULT'&&e.data?.terminalBlocked===true).length,1);

  issues=[{...issues[0],body:baseBody+'\nREARM_GENERATION=2'}];
  out=await materializeGithubIssues({pool,fetchImpl,token:'fake'});
  assert.strictEqual(out.created,0);
  assert.strictEqual(comments.length,1);
  assert.strictEqual(labelAdds,1);
  assert.strictEqual(labelClears,1);
  assert.strictEqual(pool.events.filter((e)=>e.type==='ROUTING_FAULT'&&e.data?.terminalBlocked===true).length,1);

  out=await materializeGithubIssues({pool,fetchImpl,token:'fake'});
  assert.strictEqual(out.created,0);
  assert.strictEqual(labelClears,2);
  assert.strictEqual(comments.length,2);
  assert.strictEqual(labelAdds,2);
  assert.strictEqual(pool.events.filter((e)=>e.type==='ROUTING_FAULT'&&e.data?.terminalBlocked===true).length,2);
});


test('cleared stale oversized fault is retired for the current revision and does not delete a later blocked-objective label',async()=>{
  const pool=coreBacklogPool();
  pool.events.push({type:'ROUTING_FAULT',data:{
    issueNumber:1616,reason:'OPENCLAW_INSTRUCTION_INVALID',sourceRevision:'older',ownerVisible:true,terminalBlocked:true,
  }});
  const body=[
    'TIGERIQ_EXECUTABLE=true','OWNER_POLICY=AUTO','OWNER_DIRECT=true','PRIORITY=P1',
    'CAPABILITY=pc_operator','NO_CODE_CHANGE=true','NO_PC01_SHELL=true',
    'RESOURCE_SCOPE=OPENCLAW_STALE_CLEAR_RETIRE',
    'ASSIGNED_ACTION','Use exactly tigeriq_pc action=tcp_probe host="127.0.0.1" port=8798.',
    'ACCEPTANCE','Return bounded evidence.',
  ].join('\n');
  const issue={number:1616,state:'open',title:'stale terminal clear retire',body,labels:['tigeriq:terminal-blocked'],html_url:'https://example/1616'};
  let labelClears=0;
  const fetchImpl=async(url,init={})=>{
    const method=String(init.method||'GET').toUpperCase();
    if(method==='DELETE'&&url.includes('/issues/1616/labels/')){
      labelClears++;
      issue.labels=[];
      return response({},true,204);
    }
    return response({});
  };

  let out=await materializeGithubIssues({pool,fetchImpl,openIssues:[issue],token:'fake'});
  assert.strictEqual(out.created,1);
  assert.strictEqual(labelClears,1);
  assert.strictEqual(pool.events.filter((e)=>e.type==='ROUTING_FAULT_CLEAR').length,1);

  pool.objectives[0].status='blocked';
  issue.labels=['tigeriq:terminal-blocked'];
  out=await materializeGithubIssues({pool,fetchImpl,openIssues:[issue],token:'fake'});
  assert.strictEqual(out.created,0);
  assert.strictEqual(labelClears,1);
  assert.deepStrictEqual(issue.labels,['tigeriq:terminal-blocked']);
});

test('OpenClaw terminal routing state is loaded once per reconciliation, not once per PC issue',async()=>{
  const pool=coreBacklogPool();
  const makeIssue=(number)=>({
    number,state:'open',title:`pc ${number}`,html_url:`https://example/${number}`,
    body:[
      'TIGERIQ_EXECUTABLE=true','OWNER_POLICY=AUTO','OWNER_DIRECT=true','PRIORITY=P1',
      'CAPABILITY=pc_operator','NO_CODE_CHANGE=true','NO_PC01_SHELL=true',
      `RESOURCE_SCOPE=PC_STATE_LOAD_${number}`,
      'ASSIGNED_ACTION','Use exactly tigeriq_pc action=tcp_probe host="127.0.0.1" port=8798.',
      'ACCEPTANCE','Return bounded evidence.',
    ].join('\n'),
  });
  const out=await materializeGithubIssues({pool,openIssues:[makeIssue(1617),makeIssue(1618)],token:'fake'});
  assert.strictEqual(out.created,2);
  const stateLoads=pool.queries.filter((q)=>q.includes('select type,data from tigeriq_events')&&q.includes('ROUTING_FAULT_CLEAR'));
  assert.strictEqual(stateLoads.length,1);
});

test('oversized pc_operator notification retries after transient comment failure and ignores legacy unreported faults',async()=>{
  const pool=coreBacklogPool();
  pool.events.push({type:'ROUTING_FAULT',data:{issueNumber:1611,reason:'OPENCLAW_INSTRUCTION_INVALID'}});
  const assigned='x'.repeat(5700);
  const body=[
    'TIGERIQ_EXECUTABLE=true','OWNER_POLICY=AUTO','OWNER_DIRECT=true','PRIORITY=P1',
    'CAPABILITY=pc_operator','NO_CODE_CHANGE=true','NO_PC01_SHELL=true',
    'RESOURCE_SCOPE=OPENCLAW_OVERSIZE_RETRY','PUBLIC_EVIDENCE_KEYS=installedSha',
    'ASSIGNED_ACTION',assigned,'ACCEPTANCE','Return requested public evidence only.',
  ].join('\n');
  const issues=[{number:1611,state:'open',title:'oversized OpenClaw retry',body,html_url:'https://example/1611'}];
  let attempts=0;
  const comments=[];
  const fetchImpl=async(url,init={})=>{
    if(url.includes('/issues?'))return response(issues);
    if(String(init.method||'GET').toUpperCase()==='POST'&&url.endsWith('/issues/1611/comments')){
      attempts++;
      if(attempts===1)return response({message:'temporary'},false,503);
      comments.push(JSON.parse(init.body).body);
      return response({id:2});
    }
    return response({});
  };
  let out=await materializeGithubIssues({pool,fetchImpl,token:'fake'});
  assert.strictEqual(out.created,0);
  assert.strictEqual(comments.length,0);
  assert.strictEqual(pool.events.filter((e)=>e.type==='ROUTING_FAULT').length,2);
  assert.strictEqual(pool.events.filter((e)=>e.type==='ROUTING_FAULT'&&e.data?.ownerVisible===false&&e.data?.sourceRevision).length,1);
  out=await materializeGithubIssues({pool,fetchImpl,token:'fake'});
  assert.strictEqual(out.created,0);
  assert.strictEqual(comments.length,1);
  assert.strictEqual(pool.events.filter((e)=>e.type==='ROUTING_FAULT'&&e.data?.ownerVisible===true&&e.data?.terminalBlocked===true).length,1);
  out=await materializeGithubIssues({pool,fetchImpl,token:'fake'});
  assert.strictEqual(comments.length,1);
  assert.strictEqual(pool.events.filter((e)=>e.type==='ROUTING_FAULT'&&e.data?.terminalBlocked===true).length,1);
});

test('oversized pc_operator retries terminal label sync without reposting blocked comment',async()=>{
  const pool=coreBacklogPool();
  const assigned='x'.repeat(5700);
  const body=[
    'TIGERIQ_EXECUTABLE=true','OWNER_POLICY=AUTO','OWNER_DIRECT=true','PRIORITY=P1',
    'CAPABILITY=pc_operator','NO_CODE_CHANGE=true','NO_PC01_SHELL=true',
    'RESOURCE_SCOPE=OPENCLAW_LABEL_RETRY','PUBLIC_EVIDENCE_KEYS=installedSha',
    'ASSIGNED_ACTION',assigned,'ACCEPTANCE','Return requested public evidence only.',
  ].join('\n');
  const issues=[{number:1612,state:'open',title:'oversized label retry',body,html_url:'https://example/1612'}];
  const comments=[];
  let labelAttempts=0;
  const fetchImpl=async(url,init={})=>{
    if(url.includes('/issues?'))return response(issues);
    const method=String(init.method||'GET').toUpperCase();
    if(method==='POST'&&url.endsWith('/issues/1612/comments')){
      comments.push(JSON.parse(init.body).body);
      issues[0].comments=comments.length;
      return response({id:comments.length});
    }
    if(method==='POST'&&url.endsWith('/issues/1612/labels')){
      labelAttempts++;
      if(labelAttempts===1)return response({message:'temporary'},false,503);
      return response([]);
    }
    if(method==='GET'&&url.includes('/issues/1612/comments?')){
      return response(comments.map((body,index)=>({id:index+1,body})));
    }
    return response({});
  };
  let out=await materializeGithubIssues({pool,fetchImpl,token:'fake'});
  assert.strictEqual(out.created,0);
  assert.strictEqual(comments.length,1);
  assert.strictEqual(labelAttempts,1);
  assert.strictEqual(pool.events.filter((e)=>e.type==='ROUTING_FAULT'&&e.data?.ownerVisible===true).length,1);
  assert.strictEqual(pool.events.filter((e)=>e.type==='ROUTING_FAULT'&&e.data?.terminalBlocked===true).length,0);

  out=await materializeGithubIssues({pool,fetchImpl,token:'fake'});
  assert.strictEqual(out.created,0);
  assert.strictEqual(comments.length,1);
  assert.strictEqual(labelAttempts,2);
  assert.strictEqual(pool.events.filter((e)=>e.type==='ROUTING_FAULT'&&e.data?.terminalBlocked===true).length,1);

  out=await materializeGithubIssues({pool,fetchImpl,token:'fake'});
  assert.strictEqual(comments.length,1);
  assert.strictEqual(labelAttempts,2);
});

test('oversized pc_operator blocked notice propagates GitHub rate limit to scheduler',async()=>{
  const pool=coreBacklogPool();
  const assigned='x'.repeat(5700);
  const body=[
    'TIGERIQ_EXECUTABLE=true','OWNER_POLICY=AUTO','OWNER_DIRECT=true','PRIORITY=P1',
    'CAPABILITY=pc_operator','NO_CODE_CHANGE=true','NO_PC01_SHELL=true',
    'RESOURCE_SCOPE=OPENCLAW_RATE_LIMIT','PUBLIC_EVIDENCE_KEYS=installedSha',
    'ASSIGNED_ACTION',assigned,'ACCEPTANCE','Return requested public evidence only.',
  ].join('\n');
  const issues=[{number:1613,state:'open',title:'oversized rate limited',body,html_url:'https://example/1613'}];
  const fetchImpl=async(url,init={})=>{
    if(url.includes('/issues?'))return response(issues);
    if(String(init.method||'GET').toUpperCase()==='POST'&&url.endsWith('/issues/1613/comments')){
      return response({message:'rate limit'},false,429,{'retry-after':'1'});
    }
    return response({});
  };
  await assert.rejects(()=>materializeGithubIssues({pool,fetchImpl,token:'fake'}),/GITHUB_HTTP_429/);
  assert.strictEqual(pool.objectives.length,0);
  assert.strictEqual(pool.jobs.length,0);
  assert.strictEqual(pool.events.filter((e)=>e.type==='ROUTING_FAULT').length,0);
});

test('oversized pc_operator recovers blocked-comment idempotency after routing marker insert failure',async()=>{
  const pool=coreBacklogPool({routingFaultInsertFailures:2});
  const assigned='x'.repeat(5700);
  const body=[
    'TIGERIQ_EXECUTABLE=true','OWNER_POLICY=AUTO','OWNER_DIRECT=true','PRIORITY=P1',
    'CAPABILITY=pc_operator','NO_CODE_CHANGE=true','NO_PC01_SHELL=true',
    'RESOURCE_SCOPE=OPENCLAW_MARKER_RECOVERY','PUBLIC_EVIDENCE_KEYS=installedSha',
    'ASSIGNED_ACTION',assigned,'ACCEPTANCE','Return requested public evidence only.',
  ].join('\n');
  const issues=[{number:1614,state:'open',title:'oversized marker recovery',body,comments:0,html_url:'https://example/1614'}];
  const comments=[];
  let labelAdds=0;
  const fetchImpl=async(url,init={})=>{
    if(url.includes('/issues?'))return response(issues);
    const method=String(init.method||'GET').toUpperCase();
    if(method==='GET'&&url.includes('/issues/1614/comments?')){
      return response(comments.map((body,index)=>({id:index+1,body})));
    }
    if(method==='POST'&&url.endsWith('/issues/1614/comments')){
      comments.push(JSON.parse(init.body).body);
      issues[0].comments=comments.length;
      return response({id:comments.length});
    }
    if(method==='POST'&&url.endsWith('/issues/1614/labels')){
      labelAdds++;
      return response([]);
    }
    return response({});
  };

  let out=await materializeGithubIssues({pool,fetchImpl,token:'fake'});
  assert.strictEqual(out.created,0);
  assert.strictEqual(comments.length,1);
  assert.strictEqual(pool.events.filter((e)=>e.type==='ROUTING_FAULT').length,0);

  out=await materializeGithubIssues({pool,fetchImpl,token:'fake'});
  assert.strictEqual(out.created,0);
  assert.strictEqual(comments.length,1);
  assert.ok(labelAdds>=2);
  assert.strictEqual(pool.events.filter((e)=>e.type==='ROUTING_FAULT'&&e.data?.ownerVisible===true).length>=1,true);
  assert.strictEqual(pool.events.filter((e)=>e.type==='ROUTING_FAULT'&&e.data?.terminalBlocked===true).length,1);

  out=await materializeGithubIssues({pool,fetchImpl,token:'fake'});
  assert.strictEqual(comments.length,1);
});

test('owner-direct pc_operator GitHub intake materializes bounded OpenClaw objective',async()=>{
  const pool=coreBacklogPool();
  const body=`TIGERIQ_EXECUTABLE=true
OWNER_POLICY=AUTO
OWNER_DIRECT=true
PRIORITY=P1
CAPABILITY=pc_operator
NO_CODE_CHANGE=true
NO_PC01_SHELL=true
RESOURCE_SCOPE=OPENCLAW_TEST_SCOPE
PUBLIC_EVIDENCE_KEYS=installedSha,result
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
  assert.match(pool.objectives[0].objective,/Core must dispatch only the assigned pc_operator action/);
  assert.match(pool.objectives[0].objective,/NO arbitrary PC01 shell/);
  assert.strictEqual(pool.jobs.length,1);
  assert.strictEqual(pool.jobs[0].id,'JOB-GH-1608-PC');
  assert.strictEqual(pool.jobs[0].capability,'pc_operator');
  assert.match(pool.jobs[0].prompt,/tcp_probe host=127.0.0.1 port=18789/);
  assert.match(pool.jobs[0].prompt,/REQUESTED_PUBLIC_EVIDENCE_KEYS=installedSha,result/);
  assert.match(pool.jobs[0].prompt,/Do not echo raw file content/);
  assert.doesNotMatch(pool.jobs[0].prompt,/Production\/main/);
});

test('typed direct pc_operator action keeps direct prompt and public evidence contract',async()=>{
  const pool=coreBacklogPool();
  const body=[
    'TIGERIQ_EXECUTABLE=true',
    'OWNER_POLICY=AUTO',
    'PRIORITY=P1',
    'CAPABILITY=pc_operator',
    'NO_CODE_CHANGE=true',
    'NO_PC01_SHELL=true',
    'RESOURCE_SCOPE=RDC_RECOVERY_STATE_READBACK',
    'PUBLIC_EVIDENCE_KEYS=installedSha,result',
    'PC_OPERATOR_DIRECT_ACTION_JSON={"action":"file_read","path":"D:\\\\TigerIQ\\\\State\\\\core-runtime-updater.json"}',
    'ASSIGNED_ACTION',
    'Use exactly tigeriq_pc action=file_read path="D:\\\\TigerIQ\\\\State\\\\core-runtime-updater.json".',
    'ACCEPTANCE',
    'Return requested public evidence only.',
  ].join('\n');
  const issues=[{number:1935,state:'open',title:'readback',body,html_url:'https://example/1935'}];
  const fetchImpl=async(url)=>url.includes('/issues?')?response(issues):response({});
  const out=await materializeGithubIssues({pool,fetchImpl,token:'fake'});
  assert.strictEqual(out.issueNumber,1935);
  assert.strictEqual(pool.jobs.length,1);
  assert.match(pool.jobs[0].prompt,/pre-admitted typed local PC action/);
  assert.match(pool.jobs[0].prompt,/REQUESTED_PUBLIC_EVIDENCE_KEYS=installedSha,result/);
  assert.match(pool.jobs[0].prompt,/Do not echo raw file content/);
});

test('Owner-direct v0.20 CI artifact signer is admitted only as an owner-direct local action',async()=>{
  const pool=coreBacklogPool();
  const body=[
    'TIGERIQ_EXECUTABLE=true',
    'OWNER_POLICY=AUTO',
    'OWNER_DIRECT=true',
    'PRIORITY=P3',
    'CAPABILITY=pc_operator',
    'NO_CODE_CHANGE=true',
    'NO_PC01_SHELL=true',
    'RESOURCE_SCOPE=ANDROID_V020_SIGNER_ADMISSION_TEST',
    'PUBLIC_EVIDENCE_KEYS=result',
    'PC_OPERATOR_DIRECT_ACTION_JSON={"action":"android_worker_sign_v020_ci_artifact"}',
    'ASSIGNED_ACTION',
    'Execute exactly the pre-admitted typed v0.20 CI artifact signer.',
    'ACCEPTANCE',
    'Return sanitized result evidence only.',
  ].join('\\n');
  const issues=[{number:3219,state:'open',title:'v0.20 signer',body,html_url:'https://example/3219'}];
  const out=await materializeGithubIssues({pool,openIssues:issues,token:'fake'});
  assert.strictEqual(out.created,1);
  assert.strictEqual(out.issueNumber,3219);
  assert.strictEqual(pool.objectives[0].metadata.executionSurface,'PC_OPERATOR_DIRECT_LOCAL');
  assert.deepStrictEqual(pool.objectives[0].metadata.pcOperatorDirectAction,{action:'android_worker_sign_v020_ci_artifact'});
  assert.strictEqual(pool.objectives[0].metadata.ownerDirect,true);
  assert.strictEqual(pool.jobs[0].capability,'pc_operator');

  const noOwnerPool=coreBacklogPool();
  const noOwnerBody=body.replace('OWNER_DIRECT=true\\n','');
  const blocked=await materializeGithubIssues({pool:noOwnerPool,openIssues:[{number:3220,state:'open',title:'v0.20 signer no owner',body:noOwnerBody,html_url:'https://example/3220'}],token:'fake'});
  assert.strictEqual(blocked.created,0);
  assert.strictEqual(noOwnerPool.jobs.length,0);

  const coreSource=readFileSync(new URL('../apps/tigeriq-core/core.mjs',import.meta.url),'utf8');
  assert.match(coreSource,/PC_OPERATOR_DIRECT_MUTATING_ACTIONS=new Set\\(\\['task_start','task_stop','android_worker_sign_v020_ci_artifact'/);
});

test('Owner-direct v0.20 signer ACL bootstrap is admitted only with owner authorization',async()=>{
  const pool=coreBacklogPool();
  const body=[
    'TIGERIQ_EXECUTABLE=true',
    'OWNER_POLICY=AUTO',
    'OWNER_DIRECT=true',
    'PRIORITY=P1',
    'CAPABILITY=pc_operator',
    'NO_CODE_CHANGE=true',
    'NO_PC01_SHELL=true',
    'RESOURCE_SCOPE=ANDROID_V020_SIGNER_ACL_TEST',
    'PC_OPERATOR_DIRECT_ACTION_JSON={"action":"android_worker_grant_v020_signer_read_acl"}',
    'ASSIGNED_ACTION',
    'Execute exactly the fixed v0.20 signer read ACL bootstrap.',
    'ACCEPTANCE',
    'Return sanitized ACL receipt only.',
  ].join('\n');
  const issues=[{number:3301,state:'open',title:'v0.20 signer ACL',body,html_url:'https://example/3301'}];
  const out=await materializeGithubIssues({pool,openIssues:issues,token:'fake'});
  assert.strictEqual(out.created,1);
  assert.deepStrictEqual(pool.objectives[0].metadata.pcOperatorDirectAction,{action:'android_worker_grant_v020_signer_read_acl'});
  assert.strictEqual(pool.objectives[0].metadata.ownerDirect,true);

  const noOwnerPool=coreBacklogPool();
  const blocked=await materializeGithubIssues({
    pool:noOwnerPool,
    openIssues:[{number:3302,state:'open',title:'v0.20 signer ACL no owner',body:body.replace('OWNER_DIRECT=true\n',''),html_url:'https://example/3302'}],
    token:'fake',
  });
  assert.strictEqual(blocked.created,0);
  assert.strictEqual(noOwnerPool.jobs.length,0);

  const coreSource=readFileSync(new URL('../apps/tigeriq-core/core.mjs',import.meta.url),'utf8');
  assert.match(coreSource,/android_worker_sign_v020_user_context/);
  assert.match(coreSource,/android_worker_grant_v020_signer_read_acl/);
});

test('Owner-direct v0.20 signed APK chunk export is fixed and validates chunk index',async()=>{
  const pool=coreBacklogPool();
  const body=[
    'TIGERIQ_EXECUTABLE=true',
    'OWNER_POLICY=AUTO',
    'OWNER_DIRECT=true',
    'PRIORITY=P1',
    'CAPABILITY=pc_operator',
    'NO_CODE_CHANGE=true',
    'NO_PC01_SHELL=true',
    'RESOURCE_SCOPE=ANDROID_V020_EXPORT_TEST',
    'PUBLIC_EVIDENCE_KEYS=status,apkSha256,totalBytes,chunkIndex,chunkCount,chunkBytes,chunkSha256,chunkBase64',
    'PC_OPERATOR_DIRECT_ACTION_JSON={"action":"android_worker_export_v020_signed_apk_chunk","chunkIndex":2}',
    'ASSIGNED_ACTION',
    'Export exactly one fixed signed APK chunk.',
    'ACCEPTANCE',
    'Return bounded chunk evidence only.',
  ].join('\n');
  const issues=[{number:3330,state:'open',title:'v0.20 export chunk',body,html_url:'https://example/3330'}];
  const out=await materializeGithubIssues({pool,openIssues:issues,token:'fake'});
  assert.strictEqual(out.created,1);
  assert.deepStrictEqual(pool.objectives[0].metadata.pcOperatorDirectAction,{
    action:'android_worker_export_v020_signed_apk_chunk',chunkIndex:2,
  });
  assert.strictEqual(pool.objectives[0].metadata.ownerDirect,true);

  const badPool=coreBacklogPool();
  const bad=await materializeGithubIssues({
    pool:badPool,
    openIssues:[{...issues[0],number:3331,body:body.replace('"chunkIndex":2','"chunkIndex":99')}],
    token:'fake',
  });
  assert.strictEqual(bad.created,0);
  assert.strictEqual(badPool.jobs.length,0);

  const noOwnerPool=coreBacklogPool();
  const noOwner=await materializeGithubIssues({
    pool:noOwnerPool,
    openIssues:[{...issues[0],number:3332,body:body.replace('OWNER_DIRECT=true\n','')}],
    token:'fake',
  });
  assert.strictEqual(noOwner.created,0);
  assert.strictEqual(noOwnerPool.jobs.length,0);
});

test('Owner-direct typed Paperclip broker install is admitted as local direct pc_operator action',async()=>{
  const pool=coreBacklogPool();
  const body=[
    'TIGERIQ_EXECUTABLE=true',
    'OWNER_POLICY=AUTO',
    'OWNER_DIRECT=true',
    'PRIORITY=P1',
    'CAPABILITY=pc_operator',
    'NO_CODE_CHANGE=true',
    'NO_PC01_SHELL=true',
    'RESOURCE_SCOPE=TIGERIQ_PAPERCLIP_LAB_PC01_TEST',
    'PC_OPERATOR_DIRECT_ACTION_JSON={"action":"paperclip_lab_broker_install"}',
    'ASSIGNED_ACTION',
    'Execute exactly the pre-admitted typed broker install action.',
    'ACCEPTANCE',
    'Return structured local-direct evidence.',
  ].join('\n');
  const issues=[{number:2048,state:'open',title:'Paperclip broker install',body,html_url:'https://example/2048'}];
  const out=await materializeGithubIssues({pool,openIssues:issues,token:'fake'});
  assert.strictEqual(out.created,1);
  assert.strictEqual(out.issueNumber,2048);
  assert.strictEqual(pool.objectives[0].metadata.executionSurface,'PC_OPERATOR_DIRECT_LOCAL');
  assert.deepStrictEqual(pool.objectives[0].metadata.pcOperatorDirectAction,{action:'paperclip_lab_broker_install'});
  assert.strictEqual(pool.jobs[0].capability,'pc_operator');
});

test('Owner-direct typed Paperclip OpenAI device auth start is admitted with UUID only',async()=>{
  const pool=coreBacklogPool();
  const body=[
    'TIGERIQ_EXECUTABLE=true',
    'OWNER_POLICY=AUTO',
    'OWNER_DIRECT=true',
    'PRIORITY=P1',
    'CAPABILITY=pc_operator',
    'NO_CODE_CHANGE=true',
    'NO_PC01_SHELL=true',
    'RESOURCE_SCOPE=TIGERIQ_PAPERCLIP_OPENAI_DEVICE_AUTH_TEST',
    'PC_OPERATOR_DIRECT_ACTION_JSON={"action":"paperclip_openai_device_auth_start","sessionId":"d780f0ee-b44c-41e1-830a-4aada9a68ceb"}',
    'ASSIGNED_ACTION',
    'Execute exactly the pre-admitted device auth start action.',
    'ACCEPTANCE',
    'Return safe start evidence only.',
  ].join('\n');
  const issues=[{number:2593,state:'open',title:'Paperclip OpenAI auth start',body,html_url:'https://example/2593'}];
  const out=await materializeGithubIssues({pool,openIssues:issues,token:'fake'});
  assert.strictEqual(out.created,1);
  assert.strictEqual(pool.objectives[0].metadata.executionSurface,'PC_OPERATOR_DIRECT_LOCAL');
  assert.deepStrictEqual(pool.objectives[0].metadata.pcOperatorDirectAction,{action:'paperclip_openai_device_auth_start',sessionId:'d780f0ee-b44c-41e1-830a-4aada9a68ceb'});
  assert.strictEqual(pool.jobs[0].capability,'pc_operator');
});
test('typed direct pc_operator action remains executable when explanatory prompt exceeds OpenClaw limit',async()=>{
  const pool=coreBacklogPool();
  const assigned='x'.repeat(6500);
  const body=[
    'TIGERIQ_EXECUTABLE=true',
    'OWNER_POLICY=AUTO',
    'OWNER_DIRECT=true',
    'PRIORITY=P1',
    'CAPABILITY=pc_operator',
    'NO_CODE_CHANGE=true',
    'NO_PC01_SHELL=true',
    'RESOURCE_SCOPE=DIRECT_OVERSIZE_TEST',
    'PUBLIC_EVIDENCE_KEYS=installedSha',
    'PC_OPERATOR_DIRECT_ACTION_JSON={"action":"file_read","path":"D:\\\\TigerIQ\\\\State\\\\core-runtime-updater.json"}',
    'ASSIGNED_ACTION',
    assigned,
    'ACCEPTANCE',
    'Return requested public evidence only.',
  ].join('\n');
  const issues=[{number:1610,state:'open',title:'direct oversized explanation',body,html_url:'https://example/1610'}];
  const out=await materializeGithubIssues({pool,openIssues:issues,token:'fake'});
  assert.strictEqual(out.created,1);
  assert.strictEqual(out.issueNumber,1610);
  assert.strictEqual(pool.objectives[0].metadata.executionSurface,'PC_OPERATOR_DIRECT_LOCAL');
  assert.strictEqual(pool.jobs.length,1);
  assert.ok(pool.jobs[0].prompt.length>6000);
});

test('Core manager excludes deterministic pc_operator execution surfaces',()=>{
  const core=readFileSync(new URL('../apps/tigeriq-core/core.mjs',import.meta.url),'utf8');
  assert.match(core,/not in \('CORE_OPENCLAW_BOUNDED','PC_OPERATOR_DIRECT_LOCAL','CORE_UI'\)/);
  assert.match(core,/reconcileCoreDirectPcOperatorObjectives/);
  assert.match(core,/PC_OPERATOR_DIRECT_OBJECTIVE_RECONCILED/);
});

test('P0 is excluded while system-routed P1-P5 materialize in priority order',async()=>{
  const pool=coreBacklogPool();
  const issues=[
    {number:30,state:'open',title:'Owner-only P0',body:`${READ_ONLY_BASE}\nPRIORITY=P0\nRESOURCE_SCOPE=S30`,html_url:'https://example/30'},
    {number:20,state:'open',title:'P2',body:`${READ_ONLY_BASE}\nOWNER_DIRECT=true\nPRIORITY=P2\nRESOURCE_SCOPE=S20`,html_url:'https://example/20'},
    {number:10,state:'open',title:'P1',body:`${READ_ONLY_BASE}\nOWNER_DIRECT=true\nPRIORITY=P1\nRESOURCE_SCOPE=S10`,html_url:'https://example/10'},
  ];
  const fetchImpl=async(url)=>url.includes('/issues?')?response(issues):response({});
  let out=await materializeGithubIssues({pool,fetchImpl,token:'fake'});
  assert.strictEqual(out.issueNumber,10);assert.strictEqual(pool.objectives.at(-1).priority,'P1');
  out=await materializeGithubIssues({pool,fetchImpl,token:'fake'});
  assert.strictEqual(out.issueNumber,20);assert.strictEqual(pool.objectives.at(-1).priority,'P2');
  out=await materializeGithubIssues({pool,fetchImpl,token:'fake'});
  assert.strictEqual(out.created,0);
  assert.strictEqual(pool.objectives.filter(o=>o.status==='active').length,2);
});

test('same-revision reopen marker does not rematerialize; explicit source revision rearm does',async()=>{
  const pool=coreBacklogPool();
  const baseBody=`${READ_ONLY_BASE}\nOWNER_DIRECT=true\nPRIORITY=P1`;
  let issues=[{number:50,state:'open',state_reason:null,updated_at:'2026-09-23T01:00:00Z',title:'Rearm me',body:baseBody,html_url:'https://example/50'}];
  const fetchImpl=async(url)=>url.includes('/issues?')?response(issues):response({});
  let out=await materializeGithubIssues({pool,fetchImpl,token:'fake'});
  assert.strictEqual(out.issueNumber,50);
  assert.strictEqual(pool.objectives.length,1);

  pool.objectives[0].status='completed';
  pool.objectives[0].metadata.githubClosed=true;

  // Reopened/stale OPEN snapshot with the exact same title/body must not create
  // a second objective for the same source revision.
  issues=[{...issues[0],state_reason:'reopened',updated_at:'2026-09-23T02:00:00Z'}];
  out=await materializeGithubIssues({pool,fetchImpl,token:'fake'});
  assert.strictEqual(out.created,0);
  assert.strictEqual(pool.objectives.length,1);

  // A legitimate rearm changes canonical source content and therefore sourceRevision.
  issues=[{...issues[0],body:`${baseBody}\nREARMED_AT=2026-09-23T02:05:00Z`,updated_at:'2026-09-23T02:05:00Z'}];
  out=await materializeGithubIssues({pool,fetchImpl,token:'fake'});
  assert.strictEqual(out.issueNumber,50);
  assert.strictEqual(pool.objectives.length,2);
  assert.match(pool.objectives[1].id,/^OBJ-GH-50-R/);
  assert.strictEqual(pool.objectives[1].metadata.rearmedFromObjectiveId,'OBJ-GH-50');
});

test('different GitHub dispatch lanes do not starve each other',async()=>{
  const pool=coreBacklogPool();
  const reasoningBody=['TIGERIQ_EXECUTABLE=true','OWNER_POLICY=AUTO','OWNER_DIRECT=true','PRIORITY=P1','CAPABILITY=reasoning','NO_CODE_CHANGE=true','NO_PC01_SHELL=true','RESOURCE_SCOPE=REASONING_ACTIVE'].join('\n');
  const pcBody=['TIGERIQ_EXECUTABLE=true','OWNER_POLICY=AUTO','OWNER_DIRECT=true','PRIORITY=P1','CAPABILITY=pc_operator','NO_CODE_CHANGE=true','NO_PC01_SHELL=true','RESOURCE_SCOPE=PC_STATE','ASSIGNED_ACTION','tigeriq_pc file_write path=D:\\TigerIQ\\State\\lane-canary.txt content=PASS','ACCEPTANCE','PASS'].join('\n');
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

test('App Chrome deploy-request State work is excluded from Core after LOCAL-only migration',async()=>{
  const pool=coreBacklogPool();
  const body=['TIGERIQ_EXECUTABLE=true','OWNER_POLICY=AUTO','OWNER_DIRECT=true','PRIORITY=P1','CAPABILITY=pc_operator','APP_CHROME_REQUEST_ONLY=true','NO_CODE_CHANGE=true','NO_PC01_SHELL=true','RESOURCE_SCOPE=APP_CHROME_DEPLOY_REQUEST_STATE','ASSIGNED_ACTION','Use tigeriq_pc file_write only:','path=D:\\TigerIQ\\State\\appchrome-install-request.json','Then use tigeriq_pc file_read on the same path.','ACCEPTANCE','PASS'].join('\n');
  const issue={number:1881,state:'open',title:'[P0][OPENCLAW] request state',body,html_url:'https://example/1881'};
  assert.strictEqual(parseExecutableIssue(issue),null);
  const out=await materializeGithubIssues({pool,openIssues:[issue],token:'fake'});
  assert.strictEqual(out.created,0);
  assert.strictEqual(pool.objectives.length,0);
  assert.strictEqual(pool.jobs.length,0);
});

test('preferred and default NV03 review are excluded from generic Core intake to avoid duplicate review',async()=>{
  for(const preferred of [true,false]){
    const pool=coreBacklogPool();
    const lines=['TIGERIQ_EXECUTABLE=true','OWNER_POLICY=AUTO','NO_CODE_CHANGE=true','NO_PC01_SHELL=true','CAPABILITY=review','PRIORITY=P1','EXECUTION_SURFACE=CORE_READ_ONLY','RESOURCE_SCOPE=REVIEW_PR_X'];
    if(preferred)lines.push('PREFERRED_REVIEWER=NV03');
    const issues=[{number:preferred?1874:1875,state:'open',title:'UI review',body:lines.join('\n'),html_url:'https://example/review'}];
    const fetchImpl=async(url)=>url.includes('/issues?')?response(issues):response({});
    const out=await materializeGithubIssues({pool,fetchImpl,token:'fake'});
    assert.strictEqual(out.created,0);assert.strictEqual(pool.objectives.length,0);
  }
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



test('accepted sibling reuse is exact-revision and exact-scope gated',()=>{
  const current={sourceRevision:'rev-1',resourceScope:'scope-a'};
  const accepted={
    sourceRevision:'rev-1',
    resourceScope:'scope-a',
    liveAcceptancePass:true,
    liveAcceptanceRevision:'rev-1',
    liveAcceptanceEvidenceCommentId:123,
    finalReviewPass:true,
    finalReviewRevision:'rev-1',
    finalReviewJobId:'JOB-REVIEW',
    finalReviewerEmployeeId:'NV18',
  };
  const patch=reusableAcceptedSiblingMetadata(current,accepted,{liveRequired:true,finalReviewRequired:true});
  assert.strictEqual(patch.liveAcceptancePass,true);
  assert.strictEqual(patch.finalReviewPass,true);
  assert.strictEqual(patch.finalReviewJobId,'JOB-REVIEW');
  assert.strictEqual(reusableAcceptedSiblingMetadata({...current,sourceRevision:'rev-2'},accepted,{liveRequired:true,finalReviewRequired:true}),null);
  assert.strictEqual(reusableAcceptedSiblingMetadata({...current,resourceScope:'scope-b'},accepted,{liveRequired:true,finalReviewRequired:true}),null);
  assert.strictEqual(reusableAcceptedSiblingMetadata(current,{...accepted,finalReviewRevision:'old'}, {liveRequired:true,finalReviewRequired:true}),null);
  assert.strictEqual(reusableAcceptedSiblingMetadata(current,{...accepted,liveAcceptancePass:false}, {liveRequired:true,finalReviewRequired:true}),null);
});

test('closed accepted sibling inheritance runs before new live/final review orchestration',()=>{
  const source=readFileSync(new URL('../apps/tigeriq-core/github-intake.mjs',import.meta.url),'utf8');
  const sync=source.slice(source.indexOf('export async function syncGithubOutcomes'));
  const inheritAt=sync.indexOf('const inheritedAcceptedSibling=await inheritClosedAcceptedSiblingCompletion');
  const acceptanceAt=sync.indexOf('if(!inheritedAcceptedSibling&&(row.metadata?.liveAcceptanceRequired===true||row.metadata?.finalReviewRequired===true))');
  const ensureAt=sync.indexOf('ensureFinalLiveReviewJob');
  assert.ok(inheritAt>0);
  assert.ok(acceptanceAt>inheritAt);
  assert.ok(ensureAt>acceptanceAt);
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

test('CORE_REVIEW GitHub objectives bypass generic manager and queue one direct review job',()=>{
  const core=readFileSync(new URL('../apps/tigeriq-core/core.mjs',import.meta.url),'utf8');
  const helperAt=core.indexOf('async function reconcileGithubCoreReviewObjective(o)');
  const managerAt=core.indexOf('async function managerTick()');
  const managerSlice=core.slice(managerAt,managerAt+4000);
  assert.ok(helperAt>0&&helperAt<managerAt);
  assert.match(core,/dispatchLane!=='CORE_REVIEW'/);
  assert.match(core,/values\(\$1,\$2,\$3,\$4,'review','github_review','queued',2\)/);
  assert.match(core,/\[TIGERIQ_INDEPENDENT_REVIEW_V1\]/);
  assert.match(core,/REVIEW=PASS\|CHANGES_REQUIRED/);
  assert.match(managerSlice,/if\(await reconcileGithubCoreReviewObjective\(o\)\) return;/);
  assert.ok(managerSlice.indexOf('reconcileGithubCoreReviewObjective(o)')<managerSlice.indexOf('callManagerDecision('));
});

test('CORE_REVIEW direct path preserves strict targetWorker routing and terminal evidence',()=>{
  const core=readFileSync(new URL('../apps/tigeriq-core/core.mjs',import.meta.url),'utf8');
  assert.match(core,/preferredEmployeeId:j\.objective_metadata\?\.targetWorker\|\|null/);
  assert.match(core,/CORE_REVIEW completed by \$\{reviewer\}\/\$\{provider\}/);
  assert.match(core,/GITHUB_CORE_REVIEW_COMPLETED/);
  assert.match(core,/GITHUB_CORE_REVIEW_BLOCKED/);
});


test('CORE_REVIEW evidence parser enforces exact reviewed head and structured decision',()=>{
  const core=readFileSync(new URL('../apps/tigeriq-core/core.mjs',import.meta.url),'utf8');
  const start=core.indexOf('export function parseGithubCoreReviewEvidence');
  const end=core.indexOf('\n}\n\nasync function reconcileGithubCoreReviewObjective',start)+2;
  assert.ok(start>0&&end>start);
  const source=core.slice(start,end).replace(/^export\s+/,'');
  const parse=(new Function(`${source}; return parseGithubCoreReviewEvidence;`))();
  const prompt='TARGET_HEAD=abcdef1234567890\nReview this exact head.';
  const valid=[
    '[TIGERIQ_INDEPENDENT_REVIEW_V1]',
    'REVIEW=PASS',
    'TARGET_HEAD=abcdef1234567890',
    'SUMMARY=checks and diff match',
    'FINDINGS=NONE',
  ].join('\n');
  assert.deepStrictEqual(parse(valid,prompt),{
    schema:'TIGERIQ_INDEPENDENT_REVIEW_V1',
    decision:'PASS',
    targetHead:'abcdef1234567890',
    summary:'checks and diff match',
    findings:'NONE',
  });
  assert.throws(()=>parse(valid.replace('abcdef1234567890','deadbeef'),prompt),/CORE_REVIEW_EVIDENCE_INVALID/);
  assert.throws(()=>parse(valid.replace('REVIEW=PASS','REVIEW=MAYBE'),prompt),/CORE_REVIEW_EVIDENCE_INVALID/);
});

test('github_review job validates reviewer evidence before terminal done write',()=>{
  const core=readFileSync(new URL('../apps/tigeriq-core/core.mjs',import.meta.url),'utf8');
  const run=core.slice(core.indexOf('async function claimJob()'),core.indexOf('async function callManagerDecision'));
  assert.match(run,/j\.kind==='github_review'\?parseGithubCoreReviewEvidence\(routed\.text,j\.prompt\):null/);
  assert.match(run,/reviewEvidence/);
});

test('github_api_autowork runtime restricts routing to NV11-NV20 API employees',()=>{
  const core=readFileSync(new URL('../apps/tigeriq-core/core.mjs',import.meta.url),'utf8');
  assert.match(core,/j\.kind==='github_api_autowork'\?\['NV11','NV12','NV13','NV14','NV15','NV16','NV17','NV18','NV19','NV20'\]:\[\]/);
  assert.match(core,/employeeAllowlist\.size/);
  assert.match(core,/employeeAllowlist\.has\(String\(x\.employee_id\|\|''\)\.toUpperCase\(\)\)/);
});
