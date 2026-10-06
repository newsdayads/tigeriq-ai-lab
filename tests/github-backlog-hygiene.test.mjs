import test from 'node:test';
import assert from 'node:assert/strict';
import {backlogCanonicalDedupeKey,sortBacklogSpecs} from '../apps/tigeriq-core/github-backlog-policy.mjs';
import {
  GITHUB_DEEP_HYGIENE_INTERVAL_MS,
  GITHUB_LIGHT_HYGIENE_INTERVAL_MS,
  backlogHygieneFindings,
  dedupeBacklogWorkOrders,
  eventBacklogDedupeDecision,
  githubBacklogHygieneSweepPlan,
  safeAutoWorkAdmission,
  workOrderDedupIdentity,
} from '../apps/tigeriq-core/github-intake.mjs';

const safety=[
  'OWNER_POLICY=AUTO',
  'MUTATION_OWNER=NONE',
  'NO_DIRECT_MAIN=true',
  'NO_PRODUCTION_RELEASE=true',
  'NO_PAID_COST=true',
  'NO_CREDENTIAL_CHANGE=true',
  'NO_SECURITY_BOUNDARY_CHANGE=true',
  'NO_DESTRUCTIVE=true',
].join('\n');

function body({
  priority='P2',
  project='tigeriq-ai-lab',
  workstream='queue-hygiene',
  objective='dedupe-sort-sweep',
  scope='BACKLOG_DEDUP_SORT_SCHEDULER_V1',
  target='apps/tigeriq-core/github-intake.mjs',
  extra='',
}={}){
  return [
    'TIGERIQ_JOB_V1',
    'PRIORITY='+priority,
    'PROJECT_ID='+project,
    'WORKSTREAM_ID='+workstream,
    'OBJECTIVE_ID='+objective,
    'RESOURCE_SCOPE='+scope,
    'TARGET_ARTIFACT='+target,
    extra,
    safety,
  ].filter(Boolean).join('\n');
}

function issue(number,bodyText,title='[P2][QUEUE HYGIENE] sample',state='open'){
  return {number,title,body:bodyText,state,labels:[],updated_at:'2026-10-06T10:00:00Z'};
}

test('canonical dedupe key ignores retry/rearm scope suffixes through intake identity normalization',()=>{
  const a={number:100,title:'[P2] original',body:body({scope:'BACKLOG_DEDUP_SORT_SCHEDULER_V1'}),resourceScope:'BACKLOG_DEDUP_SORT_SCHEDULER'};
  const b={number:101,title:'[P2] retry',body:body({scope:'BACKLOG_DEDUP_SORT_SCHEDULER_RETRY_2'}),resourceScope:'BACKLOG_DEDUP_SORT_SCHEDULER'};
  assert.equal(workOrderDedupIdentity(a),workOrderDedupIdentity(b));
  assert.equal(backlogCanonicalDedupeKey(a),backlogCanonicalDedupeKey(b));
});

test('dedupe keeps deterministic canonical issue even when newest duplicate arrives first',()=>{
  const canonical={number:100,title:'[P2] canonical',body:body(),resourceScope:'BACKLOG_DEDUP_SORT_SCHEDULER_V1'};
  const duplicate={number:200,title:'[P2] duplicate',body:body(),resourceScope:'BACKLOG_DEDUP_SORT_SCHEDULER_V1'};
  const deduped=dedupeBacklogWorkOrders([duplicate,canonical]);
  assert.equal(deduped.length,1);
  assert.equal(deduped[0].number,100);
  const decision=eventBacklogDedupeDecision(duplicate,[duplicate,canonical]);
  assert.equal(decision.duplicate,true);
  assert.equal(decision.canonical.number,100);
  assert.ok(decision.key);
});

test('queue ordering is active lease then executable P1-P5 then review then waiting then owner gate then terminal',()=>{
  const specs=[
    {number:90,priority:'P1',capability:'reasoning',body:'PRIORITY=P1\nCURRENT_STATE=WAIT_DEPENDENCY'},
    {number:80,priority:'P1',capability:'review',body:'PRIORITY=P1\nCURRENT_STATE=READY_INDEPENDENT_REVIEW\nREVIEW_ONLY=true'},
    {number:70,priority:'P1',capability:'reasoning',body:'PRIORITY=P1\nOWNER_GATE=true'},
    {number:60,priority:'P1',capability:'reasoning',body:'PRIORITY=P1\nDONE=true'},
    {number:50,priority:'P5',capability:'reasoning',body:'PRIORITY=P5\nCURRENT_STATE=READY'},
    {number:40,priority:'P2',capability:'reasoning',body:'PRIORITY=P2\nCURRENT_STATE=READY'},
    {number:30,priority:'P1',capability:'reasoning',body:'PRIORITY=P1\nCURRENT_STATE=READY'},
    {number:20,priority:'P5',capability:'reasoning',body:'PRIORITY=P5\nACTIVE_LEASE=true\nHEARTBEAT_FRESH=true'},
  ];
  assert.deepEqual(sortBacklogSpecs(specs).map((x)=>x.number),[20,30,40,50,80,90,70,60]);
});

test('queue ordering uses FIFO readyAt inside the same priority',()=>{
  const specs=[
    {number:20,priority:'P2',body:'PRIORITY=P2\nREADY_AT=2026-10-06T12:00:00Z'},
    {number:30,priority:'P2',body:'PRIORITY=P2\nREADY_AT=2026-10-06T10:00:00Z'},
  ];
  assert.deepEqual(sortBacklogSpecs(specs).map((x)=>x.number),[30,20]);
});

test('hygiene cadence is bounded, non-overlapping, and prefers deep when both are due',()=>{
  const now=Date.parse('2026-10-06T18:00:00Z');
  assert.deepEqual(githubBacklogHygieneSweepPlan({nowMs:now,lastLightMs:now-GITHUB_LIGHT_HYGIENE_INTERVAL_MS,lastDeepMs:now}),{kind:'LIGHT',reason:'LIGHT_INTERVAL_DUE'});
  assert.deepEqual(githubBacklogHygieneSweepPlan({nowMs:now,lastLightMs:now-GITHUB_LIGHT_HYGIENE_INTERVAL_MS,lastDeepMs:now-GITHUB_DEEP_HYGIENE_INTERVAL_MS}),{kind:'DEEP',reason:'DEEP_INTERVAL_DUE'});
  assert.deepEqual(githubBacklogHygieneSweepPlan({nowMs:now,lastLightMs:0,lastDeepMs:0,running:true}),{kind:'NONE',reason:'ALREADY_RUNNING'});
});

test('deep hygiene findings detect duplicate, terminal executable, stale lease and parked lease fixtures',()=>{
  const now=Date.parse('2026-10-06T18:00:00Z');
  const rows=[
    issue(100,body()),
    issue(101,body()),
    issue(102,body({objective:'terminal',scope:'TERMINAL_SCOPE',extra:'DONE=true\nTIGERIQ_EXECUTABLE=true\nAUTO_QUEUE=INCLUDED'})),
    issue(103,body({objective:'stale',scope:'STALE_SCOPE',extra:'MUTATION_OWNER=NV02\nLEASE_UNTIL=2026-10-06T17:00:00Z'})),
    issue(104,body({objective:'parked',scope:'PARKED_SCOPE',extra:'MUTATION_OWNER=NV02\nCURRENT_STATE=WAIT_DEPENDENCY'})),
  ];
  const findings=backlogHygieneFindings(rows,now);
  assert.deepEqual(findings.duplicates.map((x)=>[x.issueNumber,x.canonicalIssueNumber]),[[101,100]]);
  assert.deepEqual(findings.terminalExecutable.map((x)=>x.issueNumber),[102]);
  assert.deepEqual(findings.staleLeases.map((x)=>x.issueNumber),[103]);
  assert.deepEqual(findings.parkedHoldingLease.map((x)=>x.issueNumber),[104]);
});

test('historical DONE=true below current DONE=false does not create terminal finding',()=>{
  const current=issue(120,body({objective:'history',scope:'HISTORY_SCOPE',extra:'DONE=false\nTIGERIQ_EXECUTABLE=true\n\n<details>\nDONE=true\n</details>'}));
  assert.deepEqual(backlogHygieneFindings([current],Date.now()).terminalExecutable,[]);
});

test('P0 stays owner-only while safe P1-P5 remain admissible',()=>{
  const p0=issue(1,body({priority:'P0',objective:'owner-only',scope:'P0_SCOPE'}),'[P0] owner only');
  assert.equal(safeAutoWorkAdmission(p0).eligible,false);
  for(const priority of ['P1','P2','P3','P4','P5']){
    const candidate=issue(Number(priority.slice(1))+10,body({priority,objective:'safe-'+priority,scope:'SAFE_'+priority}));
    assert.equal(safeAutoWorkAdmission(candidate).eligible,true,priority);
  }
});
