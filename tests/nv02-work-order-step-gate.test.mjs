import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  nv02StepUpdatePlan,nv02PrecloseGate,nv02TerminalReadback,NV02_STEP_CHECKPOINT_MARKER,
} from '../apps/tigeriq-core/nv02-work-order-step-gate.mjs';
import {selectNv02WorkOrder,nv02WorkOrderMeta} from '../apps/tigeriq-core/nv02-local-self-pull.mjs';

const url='https://github.com/newsdayads/tigeriq-ai-lab/issues/9001#issuecomment-12345';
const body=(completed=false)=>[
 '## ACTIVE WORK ORDER',
 'WORK_ORDER_LIFECYCLE=V2','PROJECT_ID=unit','WORKSTREAM_ID=steps','PRIORITY=P2',
 'OWNER_POLICY=AUTO','TIGERIQ_EXECUTABLE=true','AUTO_QUEUE=INCLUDED',
 'CURRENT_STATE='+(completed?'DONE':'READY'),
 'CURRENT_STEP=R04 — bước kế tiếp','NEXT_ACTION=Đọc biên nhận thật',
 'LAST_COMPLETED_STEP=R03','BLOCKER=NONE','RESOURCE_SCOPE=NV02_FIXTURE_9001',
 'MUTATION_OWNER=NONE','ETA_STATUS=UNVERIFIED',
 'STARTED_AT='+(completed?'2026-10-13T01:00:00Z':'NOT_STARTED'),
 'START_RECEIPT_URL='+url,
 'FINISHED_AT='+(completed?'2026-10-13T02:00:00Z':'NOT_FINISHED'),
 'FINISH_RECEIPT_URL='+(completed?url:'NOT_AVAILABLE'),
 'DONE='+(completed?'true':'false'),
 '## STRUCTURED_PROGRESS_CHECKLIST',
 '- [x] R03 — Đã có biên nhận [Nguồn]('+url+')',
 '- ['+(completed?'x':' ')+'] R04 — Bước mới'+(completed?' [Nguồn]('+url+')':''),
 '## ACCEPTANCE','Đầy đủ hai bước và biên nhận.',
 '## STOP_CONDITIONS','Không phí, không bí mật mới',
].join('\n');
const work=(completed=false)=>({
 number:9001,title:'[P2] test step contract',body:body(completed),
 state:completed?'closed':'open',state_reason:completed?'completed':null,
 created_at:'2026-10-13T00:00:00Z',
});
const lease={leaseId:'NV02-9001-aaaa-bbbb-cccc',workOrder:'#9001',resourceScope:'NV02_FIXTURE_9001'};
const leaseComment=[{id:1,body:'[TIGERIQ_NV02_LEASE_V1]\nLEASE_ID='+lease.leaseId+'\nWORK_ORDER=#9001\nRESOURCE_SCOPE='+lease.resourceScope+'\nWORKER=NV02\nEXPIRES_AT=2099-01-01T00:00:00Z'}];

test('unverified GitHub comment or source-only checkbox can never check new step',()=>{
 const base={issue:work(),lease,comments:leaseComment,stepId:'R04',evidenceUrl:url};
 assert.equal(nv02StepUpdatePlan(base).reason,'ORIGINAL_EVIDENCE_READBACK_REQUIRED');
 assert.equal(nv02StepUpdatePlan({...base,evidenceReadbackVerified:true,comments:[]}).reason,'LIVE_LEASE_RECEIPT_REQUIRED');
 assert.equal(nv02StepUpdatePlan({...base,evidenceReadbackVerified:true,lease:{...lease,resourceScope:'WRONG'}}).reason,'LEASE_SCOPE_MISMATCH');
 const plan=nv02StepUpdatePlan({...base,evidenceReadbackVerified:true});
 assert.equal(plan.ok,true);
 assert.match(plan.updatedBody,/^- \[x\] R04 — Bước mới — \[Biên nhận đã đối chiếu\]\(/m);
 assert.equal(nv02StepUpdatePlan({...base,issue:{...work(),body:plan.updatedBody},evidenceReadbackVerified:true}).reason,'ALREADY_CHECKED');
});

test('preclose remains blocked until evidence, exact-head CI, review and live receipt',()=>{
 const original=work();
 const checked=nv02StepUpdatePlan({issue:original,lease,comments:leaseComment,stepId:'R04',evidenceUrl:url,evidenceReadbackVerified:true});
 const issue={...original,body:checked.updatedBody};
 const args={issue,lease,comments:leaseComment,verifiedEvidenceIds:[url],checks:{exactHead:true,requiredCi:true,independentReview:true,runtimeAcceptance:true,ownerGateSatisfied:true}};
 assert.deepEqual(nv02PrecloseGate({...args,verifiedEvidenceIds:[]}).reason,'ORIGINAL_EVIDENCE_NOT_VERIFIED');
 assert.equal(nv02PrecloseGate({...args,checks:{exactHead:true,requiredCi:false}}).reason,'EXACT_HEAD_OR_CI_NOT_VERIFIED');
 assert.equal(nv02PrecloseGate({...args,checks:{...args.checks,independentReview:false}}).reason,'INDEPENDENT_REVIEW_NOT_VERIFIED');
 assert.equal(nv02PrecloseGate({...args,checks:{...args.checks,runtimeAcceptance:false}}).reason,'LIVE_RUNTIME_NOT_VERIFIED');
 assert.equal(nv02PrecloseGate(args).decision,'PREPARE_FINAL_RECEIPT_THEN_CLOSE_COMPLETED');
});

test('terminal DONE requires verified closed GitHub V2; random STATE=DONE must be ignored',()=>{
 assert.equal(nv02TerminalReadback({issue:work(),lease,comments:[...leaseComment,{id:2,body:'STATE=DONE'}]}).state,'UNVERIFIED');
 assert.equal(nv02TerminalReadback({issue:work(),lease,comments:[...leaseComment,{id:2,body:'[TIGERIQ_NV02_RELEASE_V1]\nLEASE_ID='+lease.leaseId+'\nSTATE=DONE'}]}).state,'UNVERIFIED');
 assert.equal(nv02TerminalReadback({issue:work(true),lease,comments:[]}).state,'DONE');
});

test('blocked/wait requires same lease, issue, scope, blocker and verified evidence',()=>{
 const checkpoint=[NV02_STEP_CHECKPOINT_MARKER,'WORK_ORDER=#9001','LEASE_ID='+lease.leaseId,
 'RESOURCE_SCOPE='+lease.resourceScope,'STATE=EXTERNAL_WAIT','BLOCKER=NO_API_TOKEN',
 'EVIDENCE_URL='+url,'EVIDENCE_READBACK_VERIFIED=true'].join('\n');
 assert.equal(nv02TerminalReadback({issue:work(),lease,comments:[{id:2,body:checkpoint.replace('NO_API_TOKEN','')}] }).state,'UNVERIFIED');
 assert.equal(nv02TerminalReadback({issue:work(),lease,comments:[{id:2,body:checkpoint.replace('LEASE_ID='+lease.leaseId,'LEASE_ID=FORGED')}] }).state,'UNVERIFIED');
 assert.equal(nv02TerminalReadback({issue:work(),lease,comments:[{id:2,body:checkpoint}] }).state,'EXTERNAL_WAIT');
});

test('A blocked can lead to independent B; source-only simulation does not claim live deployment',()=>{
 const a={...work(),number:9001,body:work().body+'\nOWNER_HOLD=true'};
 const b={number:9002,title:'[P3] independent B',state:'open',body:[
 'PRIORITY=P3','TIGERIQ_EXECUTABLE=true','AUTO_QUEUE=INCLUDED','CAPABILITY=general',
 'RESOURCE_SCOPE=NV02_FIXTURE_B','MUTATION_OWNER=NONE','OWNER_HOLD=false'
 ].join('\n')};
 assert.equal(selectNv02WorkOrder([a,b])?.issue?.number,9002);
});

test('NV02 routing uses current first H2 and cannot revive archived P1 executable flags',()=>{
 const issue={number:4456,title:'[P2] media',state:'open',body:[
  '## LỆNH OWNER — CURRENT',
  'PRIORITY=P2','OWNER_POLICY=AUTO','TIGERIQ_EXECUTABLE=false',
  'AUTO_QUEUE=EXCLUDED_WAIT_REVIEW','RESOURCE_SCOPE=NEWS_CURRENT',
  '## HISTORY (STALE)',
  'PRIORITY=P1','OWNER_POLICY=AUTO','TIGERIQ_EXECUTABLE=true',
  'AUTO_QUEUE=INCLUDED','RESOURCE_SCOPE=NEWS_OLD',
 ].join('\\n')};
 const meta=nv02WorkOrderMeta(issue);
 assert.equal(meta.PRIORITY,'P2');
 assert.equal(meta.TIGERIQ_EXECUTABLE,'false');
 assert.equal(meta.AUTO_QUEUE,'EXCLUDED_WAIT_REVIEW');
 assert.equal(meta.RESOURCE_SCOPE,'NEWS_CURRENT');
 assert.equal(selectNv02WorkOrder([issue]),null);
});
test('intro-only first H2 fails closed; metadata in old H2 cannot silently authorize',()=>{
 const issue={number:4457,title:'[P2] intro card',state:'open',body:[
  '## P0 — TÓM TẮT CHỨNG CỨ',
  'Đây là phần dẫn nhập, không có quyền điều phối.',
  '## LỊCH SỬ',
  'PRIORITY=P2','OWNER_POLICY=AUTO','TIGERIQ_EXECUTABLE=true',
  'AUTO_QUEUE=INCLUDED','CAPABILITY=general','RESOURCE_SCOPE=OLD',
 ].join('\\n')};
 const meta=nv02WorkOrderMeta(issue);
 assert.equal(meta.TIGERIQ_EXECUTABLE,undefined);
 assert.equal(selectNv02WorkOrder([issue]),null);
});
