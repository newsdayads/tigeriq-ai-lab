import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildCoreUiAssignmentSnapshot,parseCoreUiIssue,readyUnassignedCoreUiSnapshot,selectCoreUiWorker} from '../apps/tigeriq-core/core-ui-assignment.mjs';

const body=(capability='general')=>[
  'TIGERIQ_EXECUTABLE=true','OWNER_POLICY=AUTO','EXECUTION_SURFACE=UI','PRIORITY=P0',
  'CAPABILITY='+capability,'RESOURCE_SCOPE=UI_CANARY_SCOPE',
  'NO_CODE_CHANGE=true','NO_PC01_SHELL=true','NO_DIRECT_MAIN=true','NO_PAID_COST=true',
  'NO_CREDENTIAL_CHANGE=true','NO_DESTRUCTIVE=true','NO_PRODUCTION_RELEASE=true',
].join('\n');
const issue=(number=200,capability='general')=>({number,title:'Core UI canary',state:'open',state_reason:null,html_url:'https://github.com/newsdayads/tigeriq-ai-lab/issues/'+number,body:body(capability),created_at:'2026-09-23T05:00:00Z',updated_at:'2026-09-23T05:00:00Z',closed_at:null});

function response(value,status=200){return{ok:status>=200&&status<300,status,json:async()=>value};}
function fakePool(){
  const objectives=[],jobs=[],events=[];
  return {objectives,jobs,events,async query(sql,params=[]){
    if(sql.includes("from tigeriq_jobs j join tigeriq_objectives o")&&sql.includes("j.id=$1")){
      const j=jobs.find(x=>x.id===params[0]);if(!j)return{rowCount:0,rows:[]};const o=objectives.find(x=>x.id===j.objective_id);
      return{rowCount:1,rows:[{job_id:j.id,objective_id:j.objective_id,status:j.status,employee_id:j.employee_id,resource_id:j.resource_id,provider:j.provider,created_at:j.created_at,started_at:j.started_at,completed_at:j.completed_at,result:j.result,priority:o.priority,metadata:o.metadata,objective_updated_at:o.updated_at}]};
    }
    if(sql.includes("from tigeriq_jobs j join tigeriq_objectives o")&&sql.includes("executionSurface")){
      const o=objectives.find(x=>x.status==='active'&&x.metadata.executionSurface==='CORE_UI');if(!o)return{rowCount:0,rows:[]};
      const j=jobs.find(x=>x.objective_id===o.id&&x.kind==='ui'&&['ui_assigned','ui_running'].includes(x.status));if(!j)return{rowCount:0,rows:[]};
      return{rowCount:1,rows:[{job_id:j.id,objective_id:j.objective_id,status:j.status,employee_id:j.employee_id,resource_id:j.resource_id,provider:j.provider,created_at:j.created_at,started_at:j.started_at,completed_at:j.completed_at,result:j.result,priority:o.priority,metadata:o.metadata,objective_updated_at:o.updated_at}]};
    }
    if(sql.startsWith('select 1 from tigeriq_objectives where id=$1')){const found=objectives.some(x=>x.id===params[0]);return{rowCount:found?1:0,rows:found?[{one:1}]:[]};}
    if(sql.includes("metadata->>'resourceScope'=$1")){const found=objectives.some(x=>x.status==='active'&&x.metadata.resourceScope===params[0]);return{rowCount:found?1:0,rows:found?[{one:1}]:[]};}
    if(sql.startsWith('insert into tigeriq_objectives')){objectives.push({id:params[0],objective:params[1],priority:params[2],status:'active',summary:params[3],metadata:JSON.parse(params[4]),updated_at:'2026-09-23T05:00:01Z'});return{rowCount:1,rows:[]};}
    if(sql.startsWith('insert into tigeriq_jobs')){jobs.push({id:params[0],objective_id:params[1],title:params[2],prompt:params[3],capability:params[4],kind:'ui',status:'ui_assigned',employee_id:params[5],resource_id:params[6],provider:'ui',created_at:'2026-09-23T05:00:01Z'});return{rowCount:1,rows:[]};}
    if(sql.includes("CORE_UI_ASSIGNMENT_CREATED")){events.push({type:'CORE_UI_ASSIGNMENT_CREATED',objectiveId:params[0],jobId:params[1],workerId:params[2]});return{rowCount:1,rows:[]};}
    if(sql.startsWith('select prompt from tigeriq_jobs')){const j=jobs.find(x=>x.id===params[0]);return{rowCount:j?1:0,rows:j?[{prompt:j.prompt}]:[]};}
    if(sql.includes("set status='ui_running'")){const j=jobs.find(x=>x.id===params[0]);if(j){j.status='ui_running';j.started_at='2026-09-23T05:01:00Z';}return{rowCount:j?1:0,rows:[]};}
    if(sql.startsWith('update tigeriq_jobs set status=$2')){const j=jobs.find(x=>x.id===params[0]);if(j){j.status=params[1];j.completed_at='2026-09-23T05:02:00Z';j.result=JSON.parse(params[2]);}return{rowCount:j?1:0,rows:[]};}
    if(sql.startsWith('update tigeriq_objectives set status=$2')){const o=objectives.find(x=>x.id===params[0]);if(o){o.status=params[1];o.summary=params[2];}return{rowCount:o?1:0,rows:[]};}
    throw new Error('UNHANDLED_SQL:'+sql);
  }};
}

test('modern Core UI contract removes legacy AUTO_UI/PRIMARY_EMPLOYEE selection',()=>{
  const general=parseCoreUiIssue(issue(200,'general'));assert.equal(general.workerId,'NV02');assert.equal(general.jobId,'GH-200');
  assert.equal(selectCoreUiWorker('review'),'NV03');assert.equal(selectCoreUiWorker('research'),'NV04');assert.equal(selectCoreUiWorker('reasoning'),'NV04');
  assert.equal(parseCoreUiIssue({...issue(201),body:body().replace('OWNER_POLICY=AUTO','OWNER_POLICY=AUTO_UI')}),null);
  assert.equal(parseCoreUiIssue({...issue(202),body:body().replace('EXECUTION_SURFACE=UI\n','')}),null);
  assert.equal(parseCoreUiIssue({...issue(203),body:body().replace('NO_CODE_CHANGE=true','NO_CODE_CHANGE=false')}),null);
  const codingBody=body('general').replace('NO_CODE_CHANGE=true','NO_CODE_CHANGE=false\nAUTONOMOUS_CODE=true');
  const coding=parseCoreUiIssue({...issue(204,'general'),body:codingBody});
  assert.equal(coding.workerId,'NV02');assert.equal(coding.autonomousCode,true);assert.equal(coding.readOnly,false);
  const missingAuthority=body('general').replace('NO_CODE_CHANGE=true','NO_CODE_CHANGE=false');
  assert.equal(parseCoreUiIssue({...issue(205,'general'),body:missingAuthority}),null);
});

test('Core persists one current UI assignment, projects working without duplicate, and terminalizes from GitHub evidence',async()=>{
  const pool=fakePool();let current=issue(210);
  const fetchImpl=async url=>response(url.includes('/issues/210')?current:[current]);
  let snap=await buildCoreUiAssignmentSnapshot({pool,fetchImpl,token:'x'});
  assert.equal(pool.jobs.length,1);assert.equal(pool.events.length,1);
  assert.deepEqual(snap.nextJob&&{jobId:snap.nextJob.jobId,workerId:snap.nextJob.workerId,status:snap.nextJob.status,coreSelected:snap.nextJob.coreSelected},{jobId:'GH-210',workerId:'NV02',status:'READY',coreSelected:true});
  assert.equal(snap.workerBindings.NV02.currentWorkOrder.title,'#210 - Core UI canary');
  const same=await buildCoreUiAssignmentSnapshot({pool,fetchImpl,token:'x'});
  assert.equal(pool.jobs.length,1);assert.equal(same.nextJob.jobId,'GH-210');
  snap=await buildCoreUiAssignmentSnapshot({pool,fetchImpl,token:'x',previousJobId:'GH-210'});
  assert.equal(snap.previousJob.status,'RUNNING');assert.equal(snap.nextJob,undefined);assert.equal(pool.jobs[0].status,'ui_running');
  current={...current,state:'closed',state_reason:'completed',closed_at:'2026-09-23T05:02:00Z',updated_at:'2026-09-23T05:02:00Z'};
  snap=await buildCoreUiAssignmentSnapshot({pool,fetchImpl,token:'x',previousJobId:'GH-210'});
  assert.equal(snap.previousJob.status,'DONE');assert.equal(snap.previousJob.evidence[0].jobId,'GH-210');assert.equal(pool.objectives[0].status,'completed');
});

test('READY_UNASSIGNED is explicit and never emits a job',()=>{
  const snap=readyUnassignedCoreUiSnapshot({observedAt:'2026-09-23T05:00:00Z'});
  assert.equal(snap.assignmentState,'READY_UNASSIGNED');assert.equal(snap.nextJob,undefined);assert.deepEqual(snap.requiredWorkers,[]);
});

test('Core endpoint and continuity source preserve Core-only authority',()=>{
  const core=readFileSync('apps/tigeriq-core/core.mjs','utf8');
  const adapter=readFileSync('apps/tigeriq-core/ui-autopilot-snapshot.mjs','utf8');
  const installer=readFileSync('apps/chrome-controller/runtime/Install-NV02-Continuity.ps1','utf8');
  assert.match(core,/buildCoreUiAssignmentSnapshot/);
  assert.match(core,/CORE_OPENCLAW_BOUNDED','CORE_UI/);
  assert.doesNotMatch(core,/const selected=await buildUiAutopilotSnapshot/);
  assert.doesNotMatch(adapter,/const fallback=await buildUiAutopilotSnapshot/);
  assert.match(adapter,/core-ui-failclosed-v1/);
  assert.match(installer,/autopilot\.enabled=\$true/);
  assert.match(installer,/externalWorkAutopilotEnabled=\$true/);
});
