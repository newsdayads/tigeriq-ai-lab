import {describe,it,expect} from 'vitest';
import {validateWorkOrderLifecycleV2,requiresLifecycleV2,lifecycleTimeSnapshot} from '../apps/tigeriq-core/work-order-lifecycle-v2.mjs';
import {safeAutoWorkAdmission} from '../apps/tigeriq-core/github-intake.mjs';
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
  it('grandfathers old issues without V2 but still validates any card explicitly opting in',()=>{
    const old=issue('PRIORITY=P2\nTIGERIQ_EXECUTABLE=true',{created_at:'2026-07-11T00:00:00Z'});
    expect(requiresLifecycleV2(old)).toBe(false);
    expect(validateWorkOrderLifecycleV2(old).source).toBe('LEGACY_NOT_ENFORCED');
    expect(requiresLifecycleV2(issue(header,{created_at:'2026-07-11T00:00:00Z'}))).toBe(true);
  });
  it('does not treat an administrative not-planned closure as a completed task',()=>{
    const stopped=issue(header,{state:'closed',state_reason:'not_planned'});
    expect(validateWorkOrderLifecycleV2(stopped).timestamps.finishedAt).toBe(null);
  });
});
