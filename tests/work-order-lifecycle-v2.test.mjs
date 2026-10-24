import {describe,it,expect} from 'vitest';
import {validateWorkOrderLifecycleV2,requiresLifecycleV2,lifecycleTimeSnapshot,lifecycleStage} from '../apps/tigeriq-core/work-order-lifecycle-v2.mjs';
import {safeAutoWorkAdmission,parseExecutableIssue} from '../apps/tigeriq-core/github-intake.mjs';
import {parseOpenWorkIssue} from '../api/live-status.mjs';
const issue=(body,extra={})=>({
  number:900001,title:'[P2][CORE] Contract V2 test',state:'open',
  created_at:'2026-10-12T01:00:00Z',body,...extra
});
const header=[
  '## ACTIVE CONTRACT','WORK_ORDER_LIFECYCLE=V2','PROJECT_ID=TIGERIQ_AI',
  'WORKSTREAM_ID=core','PRIORITY=P2','OWNER_POLICY=AUTO','CURRENT_STATE=READY',
  'TIGERIQ_EXECUTABLE=true','AUTO_QUEUE=INCLUDED','CAPABILITY=reasoning',
  'EXECUTION_SURFACE=CORE','CURRENT_STEP=M02','NEXT_ACTION=Write canary safely',
  'LAST_COMPLETED_STEP=M01','BLOCKER=NONE','RESOURCE_SCOPE=WORK_V2_TEST',
  'MUTATION_OWNER=NONE','ETA_STATUS=UNVERIFIED','STARTED_AT=NOT_STARTED',
  'FINISHED_AT=NOT_FINISHED','NO_DIRECT_MAIN=true','NO_PRODUCTION_RELEASE=true',
  'NO_PAID_COST=true','NO_CREDENTIAL_CHANGE=true','NO_SECURITY_BOUNDARY_CHANGE=true',
  'NO_DESTRUCTIVE=true','## STRUCTURED_PROGRESS_CHECKLIST',
  '- [x] M01 approved source — [Evidence](https://github.com/newsdayads/tigeriq-ai-lab/pull/1)',
  '- [ ] M02 real task receipt pending',
  '## ACCEPTANCE','Requires real receipt','## STOP_CONDITIONS','No production or secrets'
].join('\n');
describe('Work Order Lifecycle V2 global source contract',()=>{
  it('maps stage transitions and rejects unrecognized states',()=>{
    expect(['READY','WORKING','REVIEW','VERIFY','WAIT','DONE','STOPPED'].map(
      state=>lifecycleStage(state))).toEqual(['READY','WORKING','REVIEW','VERIFY','WAIT','DONE','STOPPED']);
    expect(lifecycleStage('BLOCKED_NV09_TIMEOUT')).toBe('WAIT');
    expect(validateWorkOrderLifecycleV2(issue(header.replace('CURRENT_STATE=READY','CURRENT_STATE=FOO_BAR'))).missing)
      .toContain('UNRECOGNIZED_LIFECYCLE_STATE');
  });
  it('accepts a safe READY card and never invents a start time or ETA',()=>{
    const i=issue(header),audit=validateWorkOrderLifecycleV2(i);
    expect(audit).toMatchObject({required:true,valid:true,missing:[]});
    expect(audit.timestamps).toMatchObject({startedAt:null,finishedAt:null,targetFinishAt:null});
    expect(safeAutoWorkAdmission(i).eligible).toBe(true);
  });
  it('rejects a new card without a structured lifecycle even if other auto flags are true',()=>{
    const i=issue(header.replace('WORK_ORDER_LIFECYCLE=V2\n','').replace('- [x] M01 approved source — [Evidence](https://github.com/newsdayads/tigeriq-ai-lab/pull/1)','- [x] M01 no evidence'));
    expect(validateWorkOrderLifecycleV2(i).missing).toEqual(expect.arrayContaining(['WORK_ORDER_LIFECYCLE=V2','CHECKED_STEP_WITHOUT_EVIDENCE_URL']));
    expect(safeAutoWorkAdmission(i).reason).toBe('LIFECYCLE_V2_CONTRACT_INVALID');
  });
  it('prevents dishonest working without verified start timestamp and receipt',()=>{
    const i=issue(header.replace('CURRENT_STATE=READY','CURRENT_STATE=WORKING'));
    expect(validateWorkOrderLifecycleV2(i).missing).toContain('ACTIVITY_WITHOUT_START_TIME');
    expect(safeAutoWorkAdmission(i).eligible).toBe(false);
  });
  it('requires target finish when ETA is estimated and checks explicit time zone',()=>{
    const i=issue(header.replace('ETA_STATUS=UNVERIFIED','ETA_STATUS=ESTIMATED'));
    expect(validateWorkOrderLifecycleV2(i).missing).toContain('TARGET_FINISH_AT_REQUIRED_FOR_ETA');
    const j=issue(header.replace('ETA_STATUS=UNVERIFIED','ETA_STATUS=ESTIMATED\nTARGET_FINISH_AT=2026-10-16T15:00:00+07:00'));
    expect(validateWorkOrderLifecycleV2(j).valid).toBe(true);
    expect(lifecycleTimeSnapshot(j).targetFinishAt).toBe('2026-10-16T08:00:00.000Z');
  });
  it('does not let invalid lifecycle cards pass legacy fallback or P0 Owner scope',()=>{
    const i=issue(header.replace('FINISHED_AT=NOT_FINISHED','FINISHED_AT=2026-10-12T10:00:00+07:00'));
    expect(safeAutoWorkAdmission(i).reason).toBe('LIFECYCLE_V2_CONTRACT_INVALID');
    expect(safeAutoWorkAdmission(issue(header,{title:'[P0][CORE] Owner'})).eligible).toBe(false);
  });
  it('rejects a new runnable issue without priority bracket or with a misleading system-looking title',()=>{
    const noTitlePriority=issue(header.replace('WORK_ORDER_LIFECYCLE=V2\n',''),{title:'Core task without priority bracket'});
    expect(requiresLifecycleV2(noTitlePriority)).toBe(true);
    expect(safeAutoWorkAdmission(noTitlePriority).reason).toBe('LIFECYCLE_V2_CONTRACT_INVALID');
    const disguised=issue(header.replace('WORK_ORDER_LIFECYCLE=V2\n',''),{title:'[P2][CENTRAL] looks like reference'});
    expect(requiresLifecycleV2(disguised)).toBe(true);
    expect(safeAutoWorkAdmission(disguised).eligible).toBe(false);
  });
  it('ignores checklist-looking text inside a fenced code example',()=>{
    const body=header.replace('- [ ] M02 real task receipt pending',
      '```\n- [x] NOT REAL\n```\n- [ ] M02 real task receipt pending');
    expect(validateWorkOrderLifecycleV2(issue(body)).steps).toHaveLength(2);
  });
  it('grandfathers old issues without V2 but still validates any card explicitly opting in',()=>{
    const old=issue('PRIORITY=P2\nTIGERIQ_EXECUTABLE=true',{created_at:'2026-07-11T00:00:00Z'});
    expect(requiresLifecycleV2(old)).toBe(false);
    expect(validateWorkOrderLifecycleV2(old).source).toBe('LEGACY_NOT_ENFORCED');
    expect(requiresLifecycleV2(issue(header,{created_at:'2026-07-11T00:00:00Z'}))).toBe(true);
  });
  it('projects lifecycle and explicit time fields for each Owner-visible work card without fake timestamps',()=>{
    const row=parseOpenWorkIssue(issue(header));
    expect(row.lifecycleContract).toMatchObject({required:true,valid:true,missing:[]});
    expect(row.lifecycleTiming).toMatchObject({startedAt:null,targetFinishAt:null,finishedAt:null});
    expect(row.progressTotal).toBe(2);
  });
  it('parks a malformed NV02-local card even if UI markers pretend it is READY',()=>{
    const local=[
      'NV02_LOCAL_GITHUB_SELF_PULL=P1_P5_ONLY','ASSIGNED_EXECUTOR=NV02',
      'EXECUTION_SURFACE=UI','NO_RDC=true','NO_PC01_SHELL=true','NO_CODEX=true',
      'APP_CHROME_MUTATION=FORBIDDEN'
    ].join('\n');
    const invalid=issue(header.replace('## ACTIVE CONTRACT','## ACTIVE CONTRACT\n'+local)
      .replace('CURRENT_STEP=M02','CURRENT_STEP='),{title:'[P1][NV02][CLINE] Worker self-pull'});
    const row=parseOpenWorkIssue(invalid);
    expect(row.executionEligibility).toBe('PARKED_DEPENDENCY');
    expect(row.localSelfPullReady).toBe(false);
    expect(row.lifecycleContract).toMatchObject({required:true,valid:false});
  });
  it('requires a bounded failure/verification budget on new work, keeping existing cards compatible',()=>{
    const tomorrow=issue(header,{created_at:'2026-10-14T01:00:00Z'});
    expect(validateWorkOrderLifecycleV2(tomorrow).missing)
      .toContain('BOUNDED_SAME_FAILURE_RETRY_COUNT_INVALID');
    expect(safeAutoWorkAdmission(tomorrow).eligible).toBe(false);
    expect(validateWorkOrderLifecycleV2(issue(header)).valid).toBe(true);
  });
  it('stops READY tasks when the same failure or verification head reaches the attempt cap',()=>{
    const budget=[
      'SAME_FAILURE_RETRY_COUNT=0','SAME_FAILURE_RETRY_MAX=2',
      'VERIFICATION_COUNT_CURRENT_HEAD=0','VERIFICATION_MAX_PER_HEAD=2',
      'LAST_FAILURE_SIGNATURE=NV20_BAD_JSON',
      'RETRY_RESUME_TRIGGER=NEW_REVISION_OR_NEW_EVIDENCE_OR_DEPENDENCY_CHANGE'
    ].join('\n');
    const base=header.replace('CURRENT_STEP=M02',budget+'\nCURRENT_STEP=M02');
    expect(validateWorkOrderLifecycleV2(issue(base)).valid).toBe(true);
    const repeated=base.replace('SAME_FAILURE_RETRY_COUNT=0','SAME_FAILURE_RETRY_COUNT=2');
    expect(validateWorkOrderLifecycleV2(issue(repeated)).missing)
      .toContain('SAME_FAILURE_RETRY_BUDGET_EXHAUSTED_WAIT_FOR_CHANGE');
    expect(safeAutoWorkAdmission(issue(repeated)).eligible).toBe(false);
    const verified=base.replace('VERIFICATION_COUNT_CURRENT_HEAD=0','VERIFICATION_COUNT_CURRENT_HEAD=2');
    expect(validateWorkOrderLifecycleV2(issue(verified)).missing)
      .toContain('VERIFICATION_BUDGET_EXHAUSTED_WAIT_FOR_NEW_HEAD');
    expect(validateWorkOrderLifecycleV2(issue(repeated.replace('CURRENT_STATE=READY','CURRENT_STATE=BLOCKED_FAILURE').replace('BLOCKER=NONE','BLOCKER=NV20_BAD_JSON'))).valid).toBe(true);
  });
  it('rejects fake budgets outside a tight two-attempt maximum',()=>{
    const add=['SAME_FAILURE_RETRY_COUNT=0','SAME_FAILURE_RETRY_MAX=999',
      'VERIFICATION_COUNT_CURRENT_HEAD=0','VERIFICATION_MAX_PER_HEAD=2',
      'LAST_FAILURE_SIGNATURE=NONE','RETRY_RESUME_TRIGGER=SOURCE_CHANGE'].join('\n');
    const result=validateWorkOrderLifecycleV2(issue(header.replace('CURRENT_STEP=M02',add+'\nCURRENT_STEP=M02')));
    expect(result.missing).toContain('SAME_FAILURE_RETRY_MAX_OUT_OF_BOUNDS');
  });
  it('does not treat an administrative not-planned closure as a completed task',()=>{
    const stopped=issue(header,{state:'closed',state_reason:'not_planned'});
    expect(validateWorkOrderLifecycleV2(stopped).timestamps.finishedAt).toBe(null);
  });
});


describe('V2 checklist beneath a current checkpoint header',()=>{
  it('validates the active checklist instead of losing steps behind a separator (#4709)',()=>{
    const body=[
      '## Owner checkpoint — source merged, runtime still waiting',
      'No live acceptance is claimed.',
      '---',
      '## ACTIVE WORK ORDER — repair auto dispatch',
      'WORK_ORDER_LIFECYCLE=V2',
      'PROJECT_ID=tigeriq-platform',
      'WORKSTREAM_ID=queue',
      'CURRENT_STATE=WAITING_RUNTIME_RELEASE',
      'CURRENT_STEP=R00',
      'NEXT_ACTION=Obtain a real install receipt',
      'LAST_COMPLETED_STEP=NONE',
      'BLOCKER=EXACT_INSTALL_RECEIPT_NOT_VERIFIED',
      'RESOURCE_SCOPE=QUEUE_4709',
      'MUTATION_OWNER=NONE',
      'ETA_STATUS=UNVERIFIED',
      'STARTED_AT=NOT_STARTED',
      'FINISHED_AT=NOT_FINISHED',
      '## STRUCTURED_PROGRESS_CHECKLIST',
      '- [ ] R00 — Verify source',
      '- [ ] R01 — Verify runtime',
      '## ACCEPTANCE','Real runtime evidence required.',
      '## STOP_CONDITIONS','No unauthorized runtime mutation.',
    ].join('\n');
    const result=validateWorkOrderLifecycleV2(issue(body));
    expect(result.steps).toHaveLength(2);
    expect(result.missing).not.toContain('CHECKLIST_2_TO_64');
    expect(result.missing).not.toContain('WORK_ORDER_LIFECYCLE=V2');
  });
});

describe('GH-5290 Owner directive root-header regression',()=>{
  const root=[
    'TIGERIQ_JOB_V1',
    'WORK_ORDER_LIFECYCLE=V2',
    'PROJECT_ID=tigeriq-platform',
    'WORKSTREAM_ID=work-center-owner-request-intake',
    'SOURCE=AUTHENTICATED_OWNER_WORK_CARD',
    'PARENT_ISSUE=#5252',
    'OWNER_REQUEST_ID=3d1c32c4-9fe1-4157-b362-923aef2bb64f',
    'OWNER_REQUEST_RECEIPT=https://github.com/newsdayads/tigeriq-ai-lab/issues/5252#issuecomment-6379870823',
    'OWNER_DIRECT=true',
    'OWNER_POLICY=AUTO',
    'OWNER_HOLD=false',
    'OWNER_CONTROLLED=false',
    'PRIORITY=P1',
    'TIGERIQ_EXECUTABLE=true',
    'AUTO_QUEUE=INCLUDED',
    'CAPABILITY=reasoning',
    'EXECUTION_SURFACE=CORE_REASONING',
    'ASSIGNED_EXECUTOR=ELIGIBLE_ROLE_DYNAMIC',
    'MUTATION_OWNER=CORE_DYNAMIC_LEASE',
    'ONE_RESOURCE_SCOPE_ONE_WRITER=true',
    'RESOURCE_SCOPE=TIGERIQ_OWNER_DIRECTIVE_TRIAGE_5252',
    'CURRENT_STATE=READY_SOURCE_AUDIT',
    'CURRENT_STEP=R01 — Read the exact authenticated receipt',
    'LAST_COMPLETED_STEP=NOT_STARTED',
    'NEXT_ACTION=Read receipt; analyze safely using existing Core queue',
    'BLOCKER=NONE',
    'STARTED_AT=NOT_STARTED',
    'FINISHED_AT=NOT_FINISHED',
    'ETA_STATUS=UNVERIFIED',
    'DONE=false',
    'SAME_FAILURE_RETRY_COUNT=0',
    'SAME_FAILURE_RETRY_MAX=2',
    'VERIFICATION_COUNT_CURRENT_HEAD=0',
    'VERIFICATION_MAX_PER_HEAD=2',
    'LAST_FAILURE_SIGNATURE=NONE',
    'RETRY_RESUME_TRIGGER=NEW_PARENT_RECEIPT_OR_NEW_AUTHORITY',
    'NO_DIRECT_MAIN=true',
    'NO_PAID_COST=true',
    'NO_CREDENTIAL_CHANGE=true',
    'NO_SECURITY_BOUNDARY_CHANGE=true',
    'NO_DESTRUCTIVE=true',
    'NO_PRODUCTION_RELEASE=true',
    'NO_CODE_CHANGE=true',
    'NO_PC01_SHELL=true',
    'NO_BROWSER_AUTH=true',
    'NO_RDC=true',
    'APP_CHROME_MUTATION=FORBIDDEN',
    '## STRUCTURED_PROGRESS_CHECKLIST',
    '- [ ] R01 — Read source',
    '- [ ] R02 — Produce safe plan',
    '## ACCEPTANCE',
    'Native Core job and evidence required; never claim DONE from plan.',
    '## STOP_CONDITIONS',
    'Block without lease or worker acceptance.'
  ].join('\n');
  const target=issue(root,{number:5290,title:'[P1][OWNER REQUEST #5252] Phân tích chỉ đạo 3d1c32c4',created_at:'2026-10-24T04:56:52Z'});
  it('recognizes canonical V2 fields before first checklist heading and dispatches to existing Core',()=>{
    const life=validateWorkOrderLifecycleV2(target);
    expect(life).toMatchObject({required:true,valid:true,missing:[],stage:'READY'});
    const admission=safeAutoWorkAdmission(target);
    expect(admission.eligible).toBe(true);
    const parsed=parseExecutableIssue(target);
    expect(parsed).toBeTruthy();
    expect(parsed.resourceScope).toBe('TIGERIQ_OWNER_DIRECTIVE_TRIAGE_5252');
    expect(parsed.dispatchLane).toBe('CORE_REASONING');
  });
  it('fails closed for a malformed root and never promotes archived metadata across a historical divider',()=>{
    const absent=issue(root.replace('WORK_ORDER_LIFECYCLE=V2','WORK_ORDER_LIFECYCLE=INVALID'),{number:5290,created_at:'2026-10-24T04:56:52Z'});
    expect(validateWorkOrderLifecycleV2(absent).valid).toBe(false);
    expect(safeAutoWorkAdmission(absent).eligible).toBe(false);
    const archived=issue([
      '## OWNER CHECKPOINT',
      'No executable authority',
      '--- HISTORICAL ONLY ---',
      root
    ].join('\n'),{number:5290,created_at:'2026-10-24T04:56:52Z'});
    expect(safeAutoWorkAdmission(archived).eligible).toBe(false);
  });
});
