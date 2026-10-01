import test from 'node:test';
import assert from 'node:assert/strict';
import {buildCoreUiAssignmentSnapshot,buildCoreUiPrompt,completeCoreUiAssignment,coreUiSourceRevision,parseCoreUiIssue,readyUnassignedCoreUiSnapshot,selectCoreUiWorker} from '../apps/tigeriq-core/core-ui-assignment.mjs';

const safe=(extra=[])=>[
  'TIGERIQ_EXECUTABLE=true','OWNER_POLICY=AUTO','PRIORITY=P2','RESOURCE_SCOPE=UI_CANARY',
  'NO_CODE_CHANGE=true','NO_PC01_SHELL=true','NO_DIRECT_MAIN=true','NO_PAID_COST=true',
  'NO_CREDENTIAL_CHANGE=true','NO_DESTRUCTIVE=true','NO_PRODUCTION_RELEASE=true',...extra
].join('\n');
const issue=(number,body,title='Core UI canary')=>({number,title,state:'open',state_reason:null,html_url:'https://github.com/newsdayads/tigeriq-ai-lab/issues/'+number,body,comments:0,created_at:'2026-09-30T00:00:00Z',updated_at:'2026-09-30T00:00:00Z',closed_at:null});
function response(value,status=200){return{ok:status>=200&&status<300,status,json:async()=>value};}

function fakePool(){
  const objectives=[],jobs=[],events=[];let terminalLock=Promise.resolve();
  const joined=(j)=>{const o=objectives.find(x=>x.id===j.objective_id);return {job_id:j.id,objective_id:j.objective_id,status:j.status,employee_id:j.employee_id,resource_id:j.resource_id,provider:j.provider,created_at:j.created_at,started_at:j.started_at,completed_at:j.completed_at,result:j.result,priority:o.priority,metadata:o.metadata,objective_updated_at:o.updated_at};};
  const pool={objectives,jobs,events,async connect(){
    let unlock=()=>{};
    return {
      async query(sql,params=[]){
        if(sql==='begin')return{rowCount:0,rows:[]};
        if(sql.startsWith('select pg_advisory_xact_lock')){
          const previous=terminalLock;let release;
          terminalLock=new Promise(resolve=>{release=resolve;});
          await previous;unlock=()=>release();return{rowCount:1,rows:[{locked:true}]};
        }
        if(sql==='commit'||sql==='rollback'){unlock();unlock=()=>{};return{rowCount:0,rows:[]};}
        return pool.query(sql,params);
      },
      release(){},
    };
  },async query(sql,params=[]){
    if(sql.includes('from tigeriq_jobs j join tigeriq_objectives o')&&sql.includes('j.id=$1')){const j=jobs.find(x=>x.id===params[0]);return {rowCount:j?1:0,rows:j?[joined(j)]:[]};}
    if(sql.includes('from tigeriq_jobs j join tigeriq_objectives o')&&sql.includes('j.employee_id=$1')){const j=jobs.find(x=>x.employee_id===params[0]&&['ui_assigned','ui_running'].includes(x.status)&&objectives.find(o=>o.id===x.objective_id)?.status==='active');return {rowCount:j?1:0,rows:j?[joined(j)]:[]};}
    if(sql.startsWith("select id,status,metadata,updated_at from tigeriq_objectives where metadata->>'source'='github_ui'")){
      const rows=objectives.filter(x=>x.metadata?.source==='github_ui'&&String(x.metadata?.issueNumber)===String(params[0])).sort((a,b)=>Date.parse(b.updated_at||0)-Date.parse(a.updated_at||0));
      return{rowCount:rows.length?1:0,rows:rows.length?[{id:rows[0].id,status:rows[0].status,metadata:rows[0].metadata,updated_at:rows[0].updated_at}]:[]};
    }
    if(sql.startsWith('select 1 from tigeriq_objectives where id=$1')){const found=objectives.some(x=>x.id===params[0]);return{rowCount:found?1:0,rows:found?[{one:1}]:[]};}
    if(sql.startsWith('with locked as materialized')){const found=objectives.some(x=>x.status==='active'&&x.metadata.resourceScope===params[0]);if(found)return{rowCount:0,rows:[]};objectives.push({id:params[1],objective:params[2],priority:params[3],status:'active',summary:params[4],metadata:JSON.parse(params[5]),updated_at:'2026-09-30T00:00:01Z'});return{rowCount:1,rows:[{id:params[1]}]};}
    if(sql.includes("metadata->>'resourceScope'=$1")){const found=objectives.some(x=>x.status==='active'&&x.metadata.resourceScope===params[0]);return{rowCount:found?1:0,rows:found?[{one:1}]:[]};}
    if(sql.startsWith('insert into tigeriq_objectives')){objectives.push({id:params[0],objective:params[1],priority:params[2],status:'active',summary:params[3],metadata:JSON.parse(params[4]),updated_at:'2026-09-30T00:00:01Z'});return{rowCount:1,rows:[]};}
    if(sql.startsWith('insert into tigeriq_jobs')){jobs.push({id:params[0],objective_id:params[1],title:params[2],prompt:params[3],capability:params[4],kind:'ui',status:'ui_assigned',employee_id:params[5],resource_id:params[6],provider:'ui',created_at:'2026-09-30T00:00:01Z'});return{rowCount:1,rows:[]};}
    if(sql.includes('CORE_UI_ASSIGNMENT_CREATED')){events.push({type:'CORE_UI_ASSIGNMENT_CREATED',objectiveId:params[0],jobId:params[1],workerId:params[2]});return{rowCount:1,rows:[]};}
    if(sql.includes('CORE_UI_ASSIGNMENT_TERMINAL')){events.push({type:'CORE_UI_ASSIGNMENT_TERMINAL',objectiveId:params[0],jobId:params[1],workerId:params[2]});return{rowCount:1,rows:[]};}
    if(sql.startsWith('select prompt from tigeriq_jobs')){const j=jobs.find(x=>x.id===params[0]);return{rowCount:j?1:0,rows:j?[{prompt:j.prompt}]:[]};}
    if(sql.includes("set status='ui_running'")){const j=jobs.find(x=>x.id===params[0]);if(j){j.status='ui_running';j.started_at='2026-09-30T00:01:00Z';}return{rowCount:j?1:0,rows:[]};}
    if(sql.startsWith('update tigeriq_jobs set status=$2')){const j=jobs.find(x=>x.id===params[0]);if(j){j.status=params[1];j.completed_at='2026-09-30T00:02:00Z';j.result=JSON.parse(params[2]);}return{rowCount:j?1:0,rows:[]};}
    if(sql.startsWith('update tigeriq_objectives set status=$2')){const o=objectives.find(x=>x.id===params[0]);if(o){o.status=params[1];o.summary=params[2];}return{rowCount:o?1:0,rows:[]};}
    throw new Error('UNHANDLED_SQL:'+sql);
  }};
  return pool;
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

test('Core UI honors TARGET_EMPLOYEE precedence for NV03/NV04',()=>{
  let x=parseCoreUiIssue(issue(208,safe(['TARGET_EMPLOYEE=NV03','ASSIGNED_EXECUTOR=NV11','PRIMARY_EMPLOYEE=NV12','CAPABILITY=review']),'Explicit review target'));
  assert.equal(x.workerId,'NV03');assert.equal(x.capability,'review');
  x=parseCoreUiIssue(issue(209,safe(['TARGET_EMPLOYEE=NV04','ASSIGNED_EXECUTOR=NV11','PRIMARY_EMPLOYEE=NV12','CAPABILITY=deep_research']),'Explicit research target'));
  assert.equal(x.workerId,'NV04');assert.equal(x.capability,'deep_research');
});

test('Core UI never assigns App Chrome LOCAL-only work',()=>{
  const byScope=issue(205,safe(['CAPABILITY=review']).replace('RESOURCE_SCOPE=UI_CANARY','RESOURCE_SCOPE=APP_CHROME_REPAIR'),'Local boundary');
  const byTitle=issue(206,safe(['CAPABILITY=research']),'[P1][APP-CHROME] local repair');
  const byPath=issue(207,safe(['CAPABILITY=review'])+'\nSOURCE_PATH=apps/chrome-controller/direct-cdp-bridge.mjs','Local path');
  assert.equal(parseCoreUiIssue(byScope),null);
  assert.equal(parseCoreUiIssue(byTitle),null);
  assert.equal(parseCoreUiIssue(byPath),null);
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


test('Core UI prompt is self-contained and NV04 satisfies explicit assignment contract',()=>{
  const review=parseCoreUiIssue(issue(2601,safe(['CAPABILITY=review']),'Review contract'));
  const research=parseCoreUiIssue(issue(2602,safe(['CAPABILITY=research']),'Research contract'));
  const p3=buildCoreUiPrompt(review);
  const p4=buildCoreUiPrompt(research);
  assert.match(p3,/ROLE=INDEPENDENT_REVIEW_QA/);
  assert.match(p3,/WORK_ORDER_BODY_BEGIN/);
  assert.match(p3,/DONE hoặc BLOCKED hoặc EXTERNAL_WAIT/);
  assert.match(p4,/NV04_ROLE=DEEP_RESEARCH/);
  assert.match(p4,/CURRENT_WORK_ORDER=#2602/);
  assert.match(p4,/EXACT_INPUT=https:\/\/github\.com\//);
  assert.match(p4,/RESOURCE_SCOPE=UI_CANARY/);
  assert.match(p4,/CHECKLIST=/);
  assert.match(p4,/OUTPUT=/);
  assert.match(p4,/EVIDENCE_DESTINATION=/);
  assert.match(p4,/MUTATION_ALLOWED=false/);
  assert.match(p4,/WORK_ORDER_BODY_BEGIN/);
});


test('Core UI injects bounded exact-head PR context for NV03 review',async()=>{
  const pool=fakePool();
  const head='a'.repeat(40);
  const review=issue(27430,safe(['TARGET_EMPLOYEE=NV03','CAPABILITY=review','TARGET_PR=#123 - exact review','TARGET_HEAD='+head]),'Exact-head review');
  const seen=[];
  const fetchImpl=async url=>{
    seen.push(url);
    if(url.includes('/pulls/123/files?'))return response([{filename:'apps/core.mjs',status:'modified',patch:'@@ -1 +1 @@\n-old\n+new'}]);
    if(url.endsWith('/pulls/123'))return response({title:'Fix exact context',state:'open',head:{sha:head},base:{sha:'b'.repeat(40)},changed_files:1,additions:1,deletions:1});
    if(url.includes('/issues?'))return response([review]);
    if(url.endsWith('/issues/27430'))return response(review);
    return response([]);
  };
  const snap=await buildCoreUiAssignmentSnapshot({pool,fetchImpl,token:'x'});
  assert.equal(pool.jobs.length,1);
  assert.equal(snap.nextJobs[0].workerId,'NV03');
  const prompt=pool.jobs[0].prompt;
  assert.match(prompt,/EXACT_HEAD_CONTEXT_BEGIN/);
  assert.match(prompt,/TARGET_PR=#123/);
  assert.match(prompt,new RegExp('TARGET_HEAD='+head));
  assert.match(prompt,/FILE=apps\/core\.mjs/);
  assert.match(prompt,/\+new/);
  assert.match(prompt,/EXACT_HEAD_CONTEXT_END/);
  assert.equal(pool.objectives[0].metadata.targetPr,123);
  assert.equal(pool.objectives[0].metadata.targetHead,head);
  assert.equal(seen.some(x=>!x.startsWith('https://api.github.com/repos/newsdayads/tigeriq-ai-lab/')),false);
});

test('Core UI fails closed when TARGET_HEAD does not match current PR head',async()=>{
  const pool=fakePool();
  const expected='a'.repeat(40),actual='c'.repeat(40);
  const review=issue(27431,safe(['TARGET_EMPLOYEE=NV03','CAPABILITY=review','TARGET_PR=#124','TARGET_HEAD='+expected]),'Stale-head review');
  const seen=[];
  const fetchImpl=async url=>{
    seen.push(url);
    if(url.endsWith('/pulls/124'))return response({title:'Mismatch',state:'open',head:{sha:actual},base:{sha:'b'.repeat(40)},changed_files:1});
    if(url.includes('/issues?'))return response([review]);
    return response([]);
  };
  const snap=await buildCoreUiAssignmentSnapshot({pool,fetchImpl,token:'x'});
  assert.equal(pool.jobs.length,0);
  assert.equal(pool.objectives.length,0);
  assert.equal(snap.assignmentState,'READY_UNASSIGNED');
  assert.equal(seen.some(x=>x.includes('/pulls/124/files?')),false);
});

test('Core UI bounds exact-head patches before sending to UI worker',async()=>{
  const pool=fakePool();
  const head='d'.repeat(40);
  const review=issue(27432,safe(['TARGET_EMPLOYEE=NV03','CAPABILITY=review','TARGET_PR=#125','TARGET_HEAD='+head]),'Bounded context');
  const huge='x'.repeat(40000);
  const files=Array.from({length:30},(_,i)=>({filename:'f'+i+'.mjs',status:'modified',patch:huge}));
  const fetchImpl=async url=>{
    if(url.includes('/pulls/125/files?'))return response(files);
    if(url.endsWith('/pulls/125'))return response({title:'Large PR',state:'open',head:{sha:head},base:{sha:'e'.repeat(40)},changed_files:30,additions:100,deletions:90});
    if(url.includes('/issues?'))return response([review]);
    return response([]);
  };
  await buildCoreUiAssignmentSnapshot({pool,fetchImpl,token:'x'});
  assert.equal(pool.jobs.length,1);
  assert.equal(pool.objectives[0].metadata.exactContextTruncated,true);
  assert.ok(pool.jobs[0].prompt.length<39000);
  assert.match(pool.jobs[0].prompt,/CONTEXT_FILE_LIMIT=20/);
  assert.match(pool.jobs[0].prompt,/CONTEXT_PATCH_CHAR_LIMIT=24000/);
});

test('Core UI source revision is stable for title+body and changes with canonical source',()=>{
  const a=issue(2700,safe(['CAPABILITY=review']),'Revision canary');
  const b={...a,updated_at:'2026-10-01T01:00:00Z'};
  assert.equal(coreUiSourceRevision(a),coreUiSourceRevision(b));
  assert.notEqual(coreUiSourceRevision(a),coreUiSourceRevision({...a,body:a.body+'\nREARMED_AT=2026-10-01T01:00:00Z'}));
  assert.notEqual(coreUiSourceRevision(a),coreUiSourceRevision({...a,title:'Revision canary v2'}));
});

test('terminal Core UI Work Order rearms exactly once when source revision changes',async()=>{
  const pool=fakePool();
  let current=issue(2733,safe(['CAPABILITY=review'])+'\nREARMED_AT=2026-10-01T18:00:00Z','Final review');
  const fetchImpl=async url=>response(url.includes('/issues/2733')?current:[current]);
  await buildCoreUiAssignmentSnapshot({pool,fetchImpl,token:'x'});
  assert.equal(pool.jobs.length,1);
  assert.equal(pool.jobs[0].id,'GH-2733');
  const firstObjective=pool.objectives[0];
  assert.equal(firstObjective.metadata.sourceRevision,coreUiSourceRevision(current));
  assert.equal(firstObjective.metadata.rearmedFromObjectiveId,null);

  pool.jobs[0].status='failed';pool.jobs[0].completed_at='2026-10-01T18:01:00Z';
  firstObjective.status='blocked';firstObjective.updated_at='2026-10-01T18:01:00Z';
  current={...current,body:current.body+'\nPOST_FIX_EVIDENCE=true\nREARMED_AT=2026-10-01T18:10:00Z',updated_at:'2026-10-01T18:10:00Z'};
  const revision=coreUiSourceRevision(current);
  await buildCoreUiAssignmentSnapshot({pool,fetchImpl,token:'x'});
  assert.equal(pool.jobs.length,2);
  assert.equal(pool.jobs[1].id,'GH-2733-R'+revision);
  assert.equal(pool.objectives[1].id,'OBJ-UI-GH-2733-R'+revision);
  assert.equal(pool.objectives[1].metadata.sourceRevision,revision);
  assert.equal(pool.objectives[1].metadata.rearmedFromObjectiveId,'OBJ-UI-GH-2733');

  pool.jobs[1].status='failed';pool.jobs[1].completed_at='2026-10-01T18:11:00Z';
  pool.objectives[1].status='blocked';pool.objectives[1].updated_at='2026-10-01T18:11:00Z';
  await buildCoreUiAssignmentSnapshot({pool,fetchImpl,token:'x'});
  assert.equal(pool.jobs.length,2);
  assert.equal(pool.objectives.length,2);
});

test('legacy Core UI objective can rearm only with a newer explicit rearm epoch',async()=>{
  const pool=fakePool();
  pool.objectives.push({id:'OBJ-UI-GH-2734',objective:'legacy',priority:'P1',status:'blocked',summary:'legacy',metadata:{source:'github_ui',issueNumber:2734,resourceScope:'UI_CANARY',uiWorkerId:'NV03'},updated_at:'2026-10-01T18:01:00Z'});
  let current=issue(2734,safe(['CAPABILITY=review'])+'\nREARMED_AT=2026-10-01T18:10:00Z','Legacy rearm');
  const fetchImpl=async url=>response(url.includes('/issues/2734')?current:[current]);
  const revision=coreUiSourceRevision(current);
  await buildCoreUiAssignmentSnapshot({pool,fetchImpl,token:'x'});
  assert.equal(pool.jobs.length,1);
  assert.equal(pool.jobs[0].id,'GH-2734-R'+revision);
  assert.equal(pool.objectives.at(-1).metadata.rearmedFromObjectiveId,'OBJ-UI-GH-2734');
});

test('Core UI terminal evidence closes DONE issue and frees the worker durably',async()=>{
  const pool=fakePool();
  let current=issue(2603,safe(['CAPABILITY=review']),'Terminal canary');
  const fetchImpl=async(url,init={})=>{
    if(url.endsWith('/comments')&&init.method==='POST')return response({html_url:'https://github.com/newsdayads/tigeriq-ai-lab/issues/2603#issuecomment-1',body:JSON.parse(init.body).body});
    if(url.includes('/comments?'))return response([]);
    if(url.endsWith('/issues/2603')&&init.method==='PATCH'){current={...current,state:'closed',state_reason:'completed',closed_at:'2026-09-30T00:03:00Z'};return response(current);}
    if(url.endsWith('/issues/2603'))return response(current);
    return response([current]);
  };
  await buildCoreUiAssignmentSnapshot({pool,fetchImpl,token:'x'});
  assert.equal(pool.jobs[0].status,'ui_assigned');
  const out=await completeCoreUiAssignment({pool,fetchImpl,token:'x',jobId:'GH-2603',workerId:'NV03',terminal:'DONE',result:'QA PASS\nDONE'});
  assert.equal(out.terminal,'DONE');
  assert.match(out.evidenceRef,/issuecomment-1/);
  assert.equal(pool.jobs[0].status,'done');
  assert.equal(pool.objectives[0].status,'completed');
  assert.equal(pool.events.at(-1).type,'CORE_UI_ASSIGNMENT_TERMINAL');
});


test('concurrent terminal replay creates one evidence comment and one terminal transition',async()=>{
  const pool=fakePool();let current=issue(2604,safe(['CAPABILITY=review']),'Concurrent terminal canary');
  let postCount=0;const comments=[];
  const fetchImpl=async(url,init={})=>{
    if(url.includes('/comments?'))return response(comments);
    if(url.endsWith('/comments')&&init.method==='POST'){
      postCount+=1;
      const body=JSON.parse(init.body).body;
      const comment={html_url:'https://github.com/newsdayads/tigeriq-ai-lab/issues/2604#issuecomment-'+postCount,body};
      comments.push(comment);
      await new Promise(resolve=>setTimeout(resolve,5));
      return response(comment);
    }
    if(url.endsWith('/issues/2604')&&init.method==='PATCH'){current={...current,state:'closed',state_reason:'completed',closed_at:'2026-09-30T00:04:00Z'};return response(current);}
    if(url.endsWith('/issues/2604'))return response(current);
    return response([current]);
  };
  await buildCoreUiAssignmentSnapshot({pool,fetchImpl,token:'x'});
  const [a,b]=await Promise.all([
    completeCoreUiAssignment({pool,fetchImpl,token:'x',jobId:'GH-2604',workerId:'NV03',terminal:'DONE',result:'PASS A\nDONE'}),
    completeCoreUiAssignment({pool,fetchImpl,token:'x',jobId:'GH-2604',workerId:'NV03',terminal:'DONE',result:'PASS B\nDONE'}),
  ]);
  assert.equal(postCount,1);
  assert.equal(pool.events.filter(x=>x.type==='CORE_UI_ASSIGNMENT_TERMINAL').length,1);
  assert.equal(pool.jobs[0].status,'done');
  assert.equal(a.evidenceRef,b.evidenceRef);
  assert.equal(b.alreadyTerminal,true);
});
