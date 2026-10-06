import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BACKLOG_DEEP_SWEEP_MS,
  BACKLOG_LIGHT_SWEEP_MS,
  backlogHygieneDedupeKey,
  backlogHygieneFindings,
  backlogSweepDue,
  beginBacklogSweep,
  createBacklogSweepState,
  finishBacklogSweep,
} from '../apps/tigeriq-core/backlog-hygiene.mjs';
import { backlogQueueLane, sortBacklogSpecs } from '../apps/tigeriq-core/github-backlog-policy.mjs';
import { githubSpecBlockedByActive, safeAutoWorkAdmission, workOrderDedupIdentity } from '../apps/tigeriq-core/github-intake.mjs';

const BASE=Date.parse('2026-10-06T00:00:00Z');

test('#4385 sweep cadence is bounded, non-overlapping, and deep takes precedence',()=>{
  let state=createBacklogSweepState(BASE);
  assert.deepEqual(backlogSweepDue(state,BASE+BACKLOG_LIGHT_SWEEP_MS-1),{due:false,kind:null,reason:'NOT_DUE'});
  assert.deepEqual(backlogSweepDue(state,BASE+BACKLOG_LIGHT_SWEEP_MS),{due:true,kind:'light',reason:'LIGHT_INTERVAL'});
  state=beginBacklogSweep(state,'light',BASE+BACKLOG_LIGHT_SWEEP_MS);
  assert.deepEqual(backlogSweepDue(state,BASE+BACKLOG_LIGHT_SWEEP_MS+1),{due:false,kind:null,reason:'SWEEP_ALREADY_RUNNING'});
  state=finishBacklogSweep(state,'light',BASE+BACKLOG_LIGHT_SWEEP_MS,'cursor-light-1');
  assert.deepEqual(backlogSweepDue(state,BASE+(2*BACKLOG_LIGHT_SWEEP_MS)),{due:true,kind:'light',reason:'LIGHT_INTERVAL'});
  state=beginBacklogSweep(state,'light',BASE+(2*BACKLOG_LIGHT_SWEEP_MS));
  state=finishBacklogSweep(state,'light',BASE+(2*BACKLOG_LIGHT_SWEEP_MS),'cursor-light-2');
  assert.equal(state.cursor,'cursor-light-2');
  assert.deepEqual(backlogSweepDue(state,BASE+BACKLOG_DEEP_SWEEP_MS),{due:true,kind:'deep',reason:'DEEP_INTERVAL'});
});

test('#4385 deep fixture detects duplicate family, stale/parked lease, terminal marker, and orphan review',()=>{
  const common=[
    'PROJECT_ID=TIGERIQ',
    'WORKSTREAM_ID=QUEUE',
    'OBJECTIVE_FAMILY=BACKLOG_HYGIENE',
    'TARGET_ARTIFACT=github-intake',
  ];
  const issues=[
    {number:10,state:'open',title:'canonical',body:[...common,'RESOURCE_SCOPE=BACKLOG_FAMILY_V1','CURRENT_STATE=READY','TIGERIQ_EXECUTABLE=true'].join('\n')},
    {number:11,state:'open',title:'retry v2',body:[...common,'RESOURCE_SCOPE=BACKLOG_FAMILY_V2','CURRENT_STATE=READY','TIGERIQ_EXECUTABLE=true'].join('\n')},
    {number:12,state:'open',title:'stale lease',body:['RESOURCE_SCOPE=STALE','CURRENT_STATE=READY','TIGERIQ_EXECUTABLE=true','LEASE_UNTIL=2026-10-05T00:00:00Z'].join('\n')},
    {number:13,state:'open',title:'parked lease',body:['RESOURCE_SCOPE=PARKED','CURRENT_STATE=WAITING_RESOURCE','TIGERIQ_EXECUTABLE=false','LEASE_UNTIL=2026-10-07T00:00:00Z'].join('\n')},
    {number:14,state:'closed',title:'terminal marker',body:['RESOURCE_SCOPE=TERM','CURRENT_STATE=DONE','DONE=true','TIGERIQ_EXECUTABLE=true'].join('\n')},
    {number:15,state:'open',title:'orphan review',body:['RESOURCE_SCOPE=REVIEW','CURRENT_STATE=WAITING_REVIEW','TIGERIQ_EXECUTABLE=false','CAPABILITY=review','REVIEW_ONLY=true'].join('\n')},
  ];
  assert.equal(backlogHygieneDedupeKey(issues[0]),backlogHygieneDedupeKey(issues[1]));
  const findings=backlogHygieneFindings(issues,{nowMs:BASE,deep:true});
  assert.ok(findings.some((x)=>x.type==='DUPLICATE_FAMILY'&&x.issueNumber===11&&x.canonicalIssueNumber===10));
  assert.ok(findings.some((x)=>x.type==='STALE_LEASE'&&x.issueNumber===12));
  assert.ok(findings.some((x)=>x.type==='PARKED_ITEM_HOLDS_LEASE'&&x.issueNumber===13));
  assert.ok(findings.some((x)=>x.type==='TERMINAL_EXECUTABLE_MARKER'&&x.issueNumber===14));
  assert.ok(findings.some((x)=>x.type==='ORPHAN_REVIEW'&&x.issueNumber===15));
});

test('#4385 deterministic queue order keeps active lease, executable P1-P5, resource-backed review, parked, owner, terminal',()=>{
  const rows=[
    {number:90,priority:'P2',terminal:true,readyAt:'2026-10-01T00:00:00Z'},
    {number:80,priority:'P1',ownerControlled:true,readyAt:'2026-10-01T00:00:00Z'},
    {number:70,priority:'P1',parked:true,readyAt:'2026-10-01T00:00:00Z'},
    {number:60,priority:'P1',capability:'review',resourceAvailable:true,readyAt:'2026-10-01T00:00:00Z'},
    {number:50,priority:'P5',readyAt:'2026-10-01T00:00:00Z'},
    {number:40,priority:'P2',readyAt:'2026-10-02T00:00:00Z'},
    {number:30,priority:'P1',readyAt:'2026-10-03T00:00:00Z'},
    {number:20,priority:'P1',readyAt:'2026-10-02T00:00:00Z'},
    {number:10,priority:'P3',activeLeaseValid:true,readyAt:'2026-10-04T00:00:00Z'},
  ];
  assert.equal(backlogQueueLane(rows[0]),5);
  assert.deepEqual(sortBacklogSpecs(rows).map((x)=>x.number),[10,20,30,40,50,60,70,80,90]);
});

test('#4385 intra-priority sort prefers satisfied dependency, capability match, then FIFO',()=>{
  const rows=[
    {number:4,priority:'P2',dependencySatisfied:true,capabilityMatch:true,readyAt:'2026-10-04T00:00:00Z'},
    {number:3,priority:'P2',dependencySatisfied:true,capabilityMatch:false,readyAt:'2026-10-01T00:00:00Z'},
    {number:2,priority:'P2',dependencySatisfied:false,capabilityMatch:true,readyAt:'2026-10-01T00:00:00Z'},
    {number:1,priority:'P2',dependencySatisfied:true,capabilityMatch:true,readyAt:'2026-10-02T00:00:00Z'},
  ];
  assert.deepEqual(sortBacklogSpecs(rows).map((x)=>x.number),[1,4,3,2]);
});

test('#4385 canonical event identity blocks family duplicate before a second active writer',()=>{
  const baseBody=[
    'PROJECT_ID=TIGERIQ',
    'WORKSTREAM_ID=QUEUE',
    'OBJECTIVE_FAMILY=BACKLOG_HYGIENE',
    'TARGET_ARTIFACT=github-intake',
  ].join('\n');
  const a={number:100,title:'[P2] backlog hygiene retry v1',body:baseBody+'\nRESOURCE_SCOPE=BACKLOG_FAMILY_V1',resourceScope:'BACKLOG_FAMILY_V1',capability:'coding'};
  const b={number:101,title:'[P2] backlog hygiene rearm v2',body:baseBody+'\nRESOURCE_SCOPE=BACKLOG_FAMILY_V2',resourceScope:'BACKLOG_FAMILY_V2',capability:'coding'};
  const key=workOrderDedupIdentity(a);
  assert.equal(key,workOrderDedupIdentity(b));
  assert.equal(githubSpecBlockedByActive(b,[{resourceScope:a.resourceScope,workOrderDedupeKey:key}]),true);
});

test('#4385 generic WAIT/BLOCKED states stay outside executable queue until explicit rearm',()=>{
  const base=[
    'PRIORITY=P2','OWNER_POLICY=AUTO','TIGERIQ_EXECUTABLE=true','AUTO_QUEUE=INCLUDED',
    'ZERO_COST=true','NO_PAID_COST=true','NO_CREDENTIAL_CHANGE=true',
    'NO_SECURITY_BOUNDARY_CHANGE=true','NO_PRODUCTION_RELEASE=true','NO_DESTRUCTIVE=true',
    'NO_DIRECT_MAIN=true','RESOURCE_SCOPE=QUEUE_WAIT_FIXTURE','CAPABILITY=coding',
    'EXECUTION_SURFACE=CODING','MUTATION_OWNER=CORE_DYNAMIC_LEASE',
  ];
  for(const state of ['WAIT_INDEPENDENT_REVIEW_RESULT','WAITING_RESOURCE','BLOCKED_REVIEW_RESOURCE','PARKED_EXTERNAL_WAIT']){
    const issue={number:200,state:'open',title:'[P2][CORE] wait fixture',body:[...base,`CURRENT_STATE=${state}`].join('\n'),labels:[]};
    assert.deepEqual(
      {eligible:safeAutoWorkAdmission(issue).eligible,reason:safeAutoWorkAdmission(issue).reason},
      {eligible:false,reason:'NON_EXECUTABLE_STATE'}
    );
  }
});
