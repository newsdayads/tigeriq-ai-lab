import test from 'node:test';
import assert from 'node:assert/strict';
import {buildCoreUiAssignmentSnapshot,parseCoreUiIssue,readyUnassignedCoreUiSnapshot,selectCoreUiWorker} from '../apps/tigeriq-core/core-ui-assignment.mjs';

const safe=(extra=[])=>[
  'TIGERIQ_EXECUTABLE=true','OWNER_POLICY=AUTO','PRIORITY=P2','RESOURCE_SCOPE=UI_CANARY',
  'NO_CODE_CHANGE=true','NO_PC01_SHELL=true','NO_DIRECT_MAIN=true','NO_PAID_COST=true',
  'NO_CREDENTIAL_CHANGE=true','NO_DESTRUCTIVE=true','NO_PRODUCTION_RELEASE=true',...extra
].join('\n');
const issue=(number,body,title='Core UI canary')=>({number,title,state:'open',state_reason:null,html_url:'https://github.com/newsdayads/tigeriq-ai-lab/issues/'+number,body,comments:0,created_at:'2026-09-30T00:00:00Z',updated_at:'2026-09-30T00:00:00Z',closed_at:null});
function response(value,status=200){return{ok:status>=200&&status<300,status,json:async()=>value};}

function fakePool(){
  const objectives=[],jobs=[],events=[];
  const joined=(j)=>{const o=objectives.find(x=>x.id===j.objective_id);return {job_id:j.id,objective_id:j.objective_id,status:j.status,employee_id:j.employee_id,resource_id:j.resource_id,provider:j.provider,created_at:j.created_at,started_at:j.started_at,completed_at:j.completed_at,result:j.result,priority:o.priority,metadata:o.metadata,objective_updated_at:o.updated_at};};
  return {objectives,jobs,events,async query(sql,params=[]){
    if(sql.includes('from tigeriq_jobs j join tigeriq_objectives o')&&sql.includes('j.id=$1')){const j=jobs.find(x=>x.id===params[0]);return {rowCount:j?1:0,rows:j?[joined(j)]:[]};}
    if(sql.includes('from tigeriq_jobs j join tigeriq_objectives o')&&sql.includes('j.employee_id=$1')){const j=jobs.find(x=>x.employee_id===params[0]&&['ui_assigned','ui_running'].includes(x.status)&&objectives.find(o=>o.id===x.objective_id)?.status==='active');return {rowCount:j?1:0,rows:j?[joined(j)]:[]};}
    if(sql.startsWith('select 1 from tigeriq_objectives where id=$1')){const found=objectives.some(x=>x.id===params[0]);return{rowCount:found?1:0,rows:found?[{one:1}]:[]};}
    if(sql.startsWith('with locked as materialized')){const found=objectives.some(x=>x.status==='active'&&x.metadata.resourceScope===params[0]);if(found)return{rowCount:0,rows:[]};objectives.push({id:params[1],objective:params[2],priority:params[3],status:'active',summary:params[4],metadata:JSON.parse(params[5]),updated_at:'2026-09-30T00:00:01Z'});return{rowCount:1,rows:[{id:params[1]}]};}
    if(sql.includes("metadata->>'resourceScope'=$1")){const found=objectives.some(x=>x.status==='active'&&x.metadata.resourceScope===params[0]);return{rowCount:found?1:0,rows:found?[{one:1}]:[]};}
    if(sql.startsWith('insert into tigeriq_objectives')){objectives.push({id:params[0],objective:params[1],priority:params[2],status:'active',summary:params[3],metadata:JSON.parse(params[4]),updated_at:'2026-09-30T00:00:01Z'});return{rowCount:1,rows:[]};}
    if(sql.startsWith('insert into tigeriq_jobs')){jobs.push({id:params[0],objective_id:params[1],title:params[2],prompt:params[3],capability:params[4],kind:'ui',status:'ui_assigned',employee_id:params[5],resource_id:params[6],provider:'ui',created_at:'2026-09-30T00:00:01Z'});return{rowCount:1,rows:[]};}
    if(sql.includes('CORE_UI_ASSIGNMENT_CREATED')){events.push({type:'CORE_UI_ASSIGNMENT_CREATED',objectiveId:params[0],jobId:params[1],workerId:params[2]});return{rowCount:1,rows:[]};}
    if(sql.startsWith('select prompt from tigeriq_jobs')){const j=jobs.find(x=>x.id===params[0]);return{rowCount:j?1:0,rows:j?[{prompt:j.prompt}]:[]};}
    if(sql.includes("set status='ui_running'")){const j=jobs.find(x=>x.id===params[0]);if(j){j.status='ui_running';j.started_at='2026-09-30T00:01:00Z';}return{rowCount:j?1:0,rows:[]};}
    if(sql.startsWith('update tigeriq_jobs set status=$2')){const j=jobs.find(x=>x.id===params[0]);if(j){j.status=params[1];j.completed_at='2026-09-30T00:02:00Z';j.result=JSON.parse(params[2]);}return{rowCount:j?1:0,rows:[]};}
    if(sql.startsWith('update tigeriq_objectives set status=$2')){const o=objectives.find(x=>x.id===params[0]);if(o){o.status=params[1];o.summary=params[2];}return{rowCount:o?1:0,rows:[]};}
    throw new Error('UNHANDLED_SQL:'+sql);
  }};
}

test('Core routes only review/research UI work to NV03/NV04',()=>{
  assert.equal(parseCoreUiIssue(issue(200,safe(['CAPABILITY=general']))),null);
  let x=parseCoreUiIssue(issue(201,safe(['CAPABILITY=review'])));assert.equal(x.workerId,'NV03');
  x=parseCoreUiIssue(issue(202,safe(['CAPABILITY=research'])));assert.equal(x.workerId,'NV04');
  x=parseCoreUiIssue(issue(203,safe(['CAPABILITY=deep_research'])));assert.equal(x.workerId,'NV04');
  assert.equal(parseCoreUiIssue(issue(204,safe(['CAPABILITY=review']).replace('PRIORITY=P2','PRIORITY=P0'))),null);
  assert.equal(selectCoreUiWorker('general'),null);
  assert.equal(selectCoreUiWorker('review'),'NV03');
  assert.equal(selectCoreUiWorker('research'),'NV04');
});

test('Core can assign NV03 and NV04 concurrently while NV02 remains external',async()=>{
  const pool=fakePool();
  const issues=[
    issue(211,safe(['CAPABILITY=review']).replace('RESOURCE_SCOPE=UI_CANARY','RESOURCE_SCOPE=REVIEW_A'),'Review'),
    issue(212,safe(['CAPABILITY=research']).replace('RESOURCE_SCOPE=UI_CANARY','RESOURCE_SCOPE=RESEARCH_A'),'Research'),
  ];
  const fetchImpl=async url=>{const m=url.match(/\/issues\/(\d+)$/);return response(m?issues.find(x=>x.number===Number(m[1])):issues);};
  const snap=await buildCoreUiAssignmentSnapshot({pool,fetchImpl,token:'x'});
  assert.equal(pool.jobs.length,2);assert.equal(pool.events.length,2);
  assert.deepEqual(snap.nextJobs.map(x=>x.workerId).sort(),['NV03','NV04']);
  assert.equal(snap.workerBindings.NV02.state,'EXTERNAL_TO_CORE');
  assert.equal(snap.workerBindings.NV03.currentWorkOrder.jobId,'GH-211');
  assert.equal(snap.workerBindings.NV04.currentWorkOrder.jobId,'GH-212');
});

test('same RESOURCE_SCOPE cannot be assigned twice across NV03/NV04 using atomic advisory-lock insert',async()=>{
  const pool=fakePool();
  const issues=[issue(220,safe(['CAPABILITY=review'])),issue(221,safe(['CAPABILITY=research']))];
  const fetchImpl=async()=>response(issues);
  const snap=await buildCoreUiAssignmentSnapshot({pool,fetchImpl,token:'x'});
  assert.equal(pool.jobs.length,1);assert.equal(snap.nextJobs.length,1);
});

test('previous NV03 assignment becomes RUNNING then terminalizes from GitHub close',async()=>{
  const pool=fakePool();let current=issue(230,safe(['CAPABILITY=review']));
  const fetchImpl=async url=>response(url.includes('/issues/230')?current:[current]);
  await buildCoreUiAssignmentSnapshot({pool,fetchImpl,token:'x'});
  let snap=await buildCoreUiAssignmentSnapshot({pool,fetchImpl,token:'x',previousJobId:'GH-230'});
  assert.equal(snap.previousJob.status,'RUNNING');assert.equal(pool.jobs[0].status,'ui_running');
  current={...current,state:'closed',state_reason:'completed',closed_at:'2026-09-30T00:02:00Z'};
  snap=await buildCoreUiAssignmentSnapshot({pool,fetchImpl,token:'x',previousJobId:'GH-230'});
  assert.equal(snap.previousJob.status,'DONE');assert.equal(pool.objectives[0].status,'completed');
});

test('READY_UNASSIGNED keeps mixed authority explicit',()=>{
  const snap=readyUnassignedCoreUiSnapshot({observedAt:'2026-09-30T00:00:00Z'});
  assert.equal(snap.authority,'CORE');
  assert.equal(snap.assignmentState,'READY_UNASSIGNED');
  assert.equal(snap.workerBindings.NV02.state,'EXTERNAL_TO_CORE');
  assert.equal(snap.workerBindings.NV03.state,'READY_UNASSIGNED');
  assert.equal(snap.workerBindings.NV04.state,'READY_UNASSIGNED');
});
