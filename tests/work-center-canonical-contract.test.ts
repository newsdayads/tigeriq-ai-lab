import { expect, it } from 'vitest';
// @ts-ignore Standalone JS contract intentionally has no declaration bundle.
import { projectCanonicalWorkOrder } from '../apps/tigeriq-core/work-center-canonical-contract.mjs';
const sha='a'.repeat(40);
const rows=(checked=6,total=16)=>Array.from({length:total},(_,i)=>`- [${i<checked?'x':' '}] R${String(i).padStart(2,'0')} — Step [Evidence](https://github.com/newsdayads/tigeriq-ai-lab/issues/4780#issuecomment-123)`).join('\n');
const make=(number=4780,settings:any={})=>({
  number,state:'open',updated_at:'2026-10-15T10:00:00Z',
  title:'[P2][ENGINEERING] REA',html_url:`https://github.com/newsdayads/tigeriq-ai-lab/issues/${number}`,
  body:`RESOURCE_SCOPE=TIGERIQ_REA_RECONSTRUCTION_LAB_V1
PRIORITY=P2
TIGERIQ_EXECUTABLE=true
CURRENT_STATE=PLANNED_AWAITING_SCOPED_DEVICE_AND_WRITER_VERIFICATION
CURRENT_STEP=R05 — Quyền thực thi
NEXT_ACTION=Claim hợp lệ sau chứng cứ
ACTIVE_EXECUTION=false
MUTATION_OWNER=NONE
DONE=false

## STRUCTURED_PROGRESS_CHECKLIST
${rows()}

## ACCEPTANCE
Only actual acceptance counts`,
  ...settings
});
const fresh=(updated='2026-10-15T10:00:00Z')=>({complete:true,stale:false,sourceSha:sha,issueUpdatedAt:updated});
const p=(issue:any=make(),source:any=fresh())=>projectCanonicalWorkOrder(issue,source);
it('P1 S01 issue #4780 checkbox projection is 6/16 and 38%, not accepted or running',()=>{
  const r=p();expect(r.ok).toBe(true);expect(r.progressCompleted).toBe(6);
  expect(r.progressTotal).toBe(16);expect(r.progressPercent).toBe(38);
  expect(r.currentStep).toContain('R05');expect(r.status).toBe('WAITING');
  expect(r.runtimeVerified).toBe(false);expect(r.leaseOwned).toBe(false);
  expect(r.doneDeclared).toBe(false);expect(r.source.complete).toBe(true);
});
it('P1 S01 current state NOT_EXECUTING from central #280 never means running',()=>{
  const x=make(280,{title:'[CENTRAL][ĐIỀU PHỐI] Queue',
    body:make().body.replace('CURRENT_STATE=PLANNED_AWAITING_SCOPED_DEVICE_AND_WRITER_VERIFICATION','CURRENT_STATE=NOT_EXECUTING')});
  const r=p(x);expect(r.status).toBe('SYSTEM');expect(r.runtimeVerified).toBe(false);
});
it('P1 S01 system policy #504 with _REVIEW does not become QA or running',()=>{
  const x=make(504,{title:'[P0][QUẢN TRỊ] Chính sách',
    body:make().body.replace('CURRENT_STATE=PLANNED_AWAITING_SCOPED_DEVICE_AND_WRITER_VERIFICATION','CURRENT_STATE=POLICY_OWNER_REVIEW')});
  expect(p(x).status).toBe('SYSTEM');
});
it('P1 S01 closed issue without external terminal proof is not DONE',()=>{
  const x=make(4780,{state:'closed',body:make().body.replace('DONE=false','DONE=true')});
  const r=p(x);expect(r.status).toBe('CLOSED_UNVERIFIED');
  expect(r.doneDeclared).toBe(true);expect(r.runtimeVerified).toBe(false);
});
it('P1 S01 all boxes checked cannot display 100% before acceptance',()=>{
  const x=make(4780,{body:make().body.replace(rows(),rows(16,16))});
  const r=p(x);expect(r.progressCompleted).toBe(16);
  expect(r.progressTotal).toBe(16);expect(r.progressPercent).toBeNull();
});
it('P1 S01 ACTIVE_EXECUTION=true only marks an unverified claim without lease receipt',()=>{
  const x=make(4858,{body:make().body.replace('ACTIVE_EXECUTION=false','ACTIVE_EXECUTION=true')});
  const r=p(x);expect(r.status).toBe('RUNNING_UNVERIFIED');
  expect(r.leaseOwned).toBe(false);expect(r.runtimeVerified).toBe(false);
});
it('P1 S01 READY but unclaimed is not running or authorized',()=>{
  const x=make(4858,{body:make().body.replace('CURRENT_STATE=PLANNED_AWAITING_SCOPED_DEVICE_AND_WRITER_VERIFICATION','CURRENT_STATE=READY_SCOPED_SOURCE_REPAIR_UNCLAIMED')});
  const r=p(x);expect(r.status).toBe('READY_UNCLAIMED');expect(r.leaseOwned).toBe(false);
});
it('P1 S01 blocked wins over optimistic active text',()=>{
  const x=make(4456,{body:make().body.replace('CURRENT_STATE=PLANNED_AWAITING_SCOPED_DEVICE_AND_WRITER_VERIFICATION','CURRENT_STATE=BLOCKED_AUTHORIZED_REAL_REPO_APPLY').replace('ACTIVE_EXECUTION=false','ACTIVE_EXECUTION=true')});
  const r=p(x);expect(r.status).toBe('BLOCKED');expect(r.runtimeVerified).toBe(false);
});
it('P1 S01 partial pages or stale mismatched issue revision never claim completeness',()=>{
  for(const src of [{complete:false,stale:false,sourceSha:sha}, {complete:true,stale:true,sourceSha:sha,issueUpdatedAt:make().updated_at}, fresh('2000-01-01T00:00:00Z'),{}]){
    const r=p(make(),src);expect(r.source.complete).toBe(false);expect(r.source.stale).toBe(true);
  }
});
it('P1 S01 missing checklist and duplicated step ID are fail-closed',()=>{
  const absent=make(4780,{body:'CURRENT_STATE=READY\nDONE=false'});
  expect(p(absent).progressPercent).toBeNull();expect(p(absent).checklistValid).toBe(false);
  const duplicate=make(4780,{body:make().body.replace(rows(),rows(6,16)+'\n'+rows(1,1))});
  expect(p(duplicate).checklistValid).toBe(false);expect(p(duplicate).progressCompleted).toBeNull();
});
it('P1 S01 source SHA and issue URL are never synthesized from arbitrary text',()=>{
  const r=p(make(4780,{html_url:'https://example.org/malicious'}),{complete:true,stale:false,sourceSha:'private-token',issueUpdatedAt:make().updated_at});
  expect(r.evidenceUrl).toBeNull();expect(r.source.sha).toBeNull();expect(r.source.complete).toBe(false);
});
it('P1 S01 three surfaces receive the same canonical fields for the same issue readback',()=>{
  const issue=make();const model=['Health','Web Control','Live'].map(()=>p(issue,fresh()));
  const keys=['number','resourceScope','currentStep','nextAction','status','progressCompleted','progressTotal','progressPercent','closed','runtimeVerified'];
  for(const k of keys)expect(model[0][k]).toEqual(model[1][k]);
  for(const k of keys)expect(model[1][k]).toEqual(model[2][k]);
});
