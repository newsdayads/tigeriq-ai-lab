import {test} from 'node:test';
import assert from 'node:assert/strict';
import {planAcceptedChecklistStep,syncAcceptedChecklistStep} from '../apps/tigeriq-core/work-order-step-autosync.mjs';
const url='https://github.com/newsdayads/tigeriq-ai-lab/issues/4780#issuecomment-6171872076';
const body=['RESOURCE_SCOPE=TIGERIQ_CANARY',
 '## Kế hoạch tuần tự và tiêu chí nghiệm thu','- [ ] R00 — Kiểm tra','- [ ] R01 — Nghiệm thu riêng','## Phụ thuộc'].join('\n');
const initial=()=>({number:4780,state:'open',body});
function env(){
 let issue=initial(),updates=0,reads=0;
 return {args:{
 issueNumber:4780,stepId:'R00',evidenceUrl:url,resourceScope:'TIGERIQ_CANARY',leaseId:'LEASE-SCOPED-1',
 readIssue:async()=>{reads++;return {...issue}},
 verifyEvidence:async()=>({verified:true,stepId:'R00',evidenceUrl:url,resourceScope:'TIGERIQ_CANARY',workOrder:'#4780'}),
 assertWriter:async()=>({valid:true,resourceScope:'TIGERIQ_CANARY',leaseId:'LEASE-SCOPED-1'}),
 writeIssue:async(n,newBody)=>{assert.equal(n,4780);updates++;issue={...issue,body:newBody};}
 },get:()=>({issue,updates,reads})};
}
test('step receipt writes once, reads back, preserves other steps, repeats idempotently',async()=>{
 const x=env();const a=await syncAcceptedChecklistStep(x.args);
 assert.equal(a.ok,true);assert.equal(a.readbackVerified,true);
 assert.equal(x.get().updates,1);assert.match(x.get().issue.body,/- \[x\] R00/);
 assert.match(x.get().issue.body,/- \[ \] R01/);
 const b=await syncAcceptedChecklistStep(x.args);assert.equal(b.ok,true);assert.equal(x.get().updates,1);
});
test('missing lease, invalid URL, unverified evidence and unverified writer deny before write',async()=>{
 const x=env();
 assert.equal((await syncAcceptedChecklistStep({...x.args,leaseId:''})).reason,'SCOPED_IO_AND_LEASE_REQUIRED');
 assert.equal((await syncAcceptedChecklistStep({...x.args,evidenceUrl:'http://evil.test'})).reason,'CANONICAL_EVIDENCE_URL_REQUIRED');
 assert.equal((await syncAcceptedChecklistStep({...x.args,verifyEvidence:async()=>({verified:false})})).reason,'ORIGINAL_STEP_ACCEPTANCE_NOT_VERIFIED');
 assert.equal((await syncAcceptedChecklistStep({...x.args,assertWriter:async()=>({valid:false})})).reason,'ATOMIC_WRITER_AUTHORITY_REQUIRED');
 assert.equal(x.get().updates,0);
});
test('failed post-write readback cannot declare completion',async()=>{
 const x=env();let count=0;
 const res=await syncAcceptedChecklistStep({...x.args,readIssue:async()=>{count++;return count===3?initial():x.args.readIssue()}});
 assert.equal(res.ok,false);assert.match(res.reason,/POST_WRITE_READBACK_FAILED/);
});
test('source change and duplicate step fail closed',async()=>{
 const dup={...initial(),body:body.replace('- [ ] R01','- [ ] R00')};
 assert.equal(planAcceptedChecklistStep({issue:dup,stepId:'R00',evidenceUrl:url,resourceScope:'TIGERIQ_CANARY'}).reason,'DUPLICATE_STEP_ID');
 const x=env();let count=0;
 const r=await syncAcceptedChecklistStep({...x.args,readIssue:async()=>{count++;return count===2?{...initial(),body:body.replace('- [ ] R00','- [x] R00 — [other](https://github.com/newsdayads/tigeriq-ai-lab/issues/1#issuecomment-2)')}:initial()}});
 assert.equal(r.ok,false);assert.equal(r.reason,'STEP_ALREADY_CHECKED_DIFFERENT_EVIDENCE');
});
test('checked different evidence is never overwritten',()=>{
 const checked={...initial(),body:body.replace('- [ ] R00','- [x] R00 — [other](https://github.com/newsdayads/tigeriq-ai-lab/issues/1#issuecomment-2)')};
 const v=planAcceptedChecklistStep({issue:checked,stepId:'R00',evidenceUrl:url,resourceScope:'TIGERIQ_CANARY'});
 assert.equal(v.reason,'STEP_ALREADY_CHECKED_DIFFERENT_EVIDENCE');
});
test('handles bold markdown step IDs and suffixed section headers',()=>{
 const boldBody = body.replace('## STRUCTURED_PROGRESS_CHECKLIST', '## STRUCTURED_PROGRESS_CHECKLIST — 30 MỐC')
                      .replace('- [ ] R00', '- [ ] **R00** — Bước thử nghiệm')
                      .replace('- [ ] R01', '- [ ] **R01** — Bước tiếp theo');
 const boldIssue = { ...initial(), body: boldBody };
 const planned = planAcceptedChecklistStep({ issue: boldIssue, stepId: 'R00', evidenceUrl: url, resourceScope: 'TIGERIQ_CANARY' });
 assert.equal(planned.ok, true);
 assert.match(planned.newBody, /- \[x\] \*\*R00\*\*.*— \[Biên nhận nghiệm thu\]/);
});



test('structured Lifecycle V2 atomically updates the exact progress counter, never twice',async()=>{
 const original=['RESOURCE_SCOPE=TIGERIQ_CANARY','CHECKLIST_RECEIPT_STABLE_REVISION=V2',
  'PROGRESS_SOURCE=STRUCTURED_PROGRESS_CHECKLIST','PROGRESS_COMPLETED=1','PROGRESS_TOTAL=2',
  '## STRUCTURED_PROGRESS_CHECKLIST',
  '- [x] R00 — Verified source [Biên nhận](https://github.com/newsdayads/tigeriq-ai-lab/issues/4780#issuecomment-1)',
  '- [ ] R01 — Verify runtime','## ACCEPTANCE'].join('\n');
 let issue={...initial(),body:original},writes=0;
 const args={...env().args,stepId:'R01',
  verifyEvidence:async()=>({verified:true,stepId:'R01',evidenceUrl:url,resourceScope:'TIGERIQ_CANARY',workOrder:'#4780'}),
  readIssue:async()=>({...issue}),
  writeIssue:async(n,newBody)=>{assert.equal(n,4780);writes++;issue={...issue,body:newBody};}};
 const first=await syncAcceptedChecklistStep(args);
 assert.equal(first.ok,true);
 assert.match(issue.body,/^PROGRESS_COMPLETED=2$/m);
 assert.match(issue.body,/- \[x\] R01.*\[Biên nhận nghiệm thu\]/);
 assert.equal(writes,1);
 const repeated=await syncAcceptedChecklistStep(args);
 assert.equal(repeated.ok,true);assert.equal(writes,1);
 const drift={...initial(),body:original.replace('PROGRESS_COMPLETED=1','PROGRESS_COMPLETED=0')};
 assert.equal(planAcceptedChecklistStep({issue:drift,stepId:'R01',evidenceUrl:url,resourceScope:'TIGERIQ_CANARY'}).reason,
  'CHECKLIST_PROGRESS_COUNTER_MISMATCH');
});

test('a partial previous evidence link is retained after a new native-verified full receipt',async()=>{
 const partial='https://github.com/newsdayads/tigeriq-ai-lab/issues/4780#issuecomment-10';
 let issue={...initial(),body:body.replace('- [ ] R00 — Kiểm tra',
  '- [ ] R00 — Kiểm tra [Bằng chứng một phần]('+partial+')')},writes=0;
 const e=env();
 const args={...e.args,readIssue:async()=>({...issue}),
  writeIssue:async(n,newBody)=>{writes++;issue={...issue,body:newBody}}};
 assert.equal((await syncAcceptedChecklistStep({...args,verifyEvidence:async()=>({verified:false})})).reason,
  'ORIGINAL_STEP_ACCEPTANCE_NOT_VERIFIED');
 assert.equal(writes,0);
 assert.equal((await syncAcceptedChecklistStep(args)).ok,true);
 assert.equal(writes,1);
 assert.ok(issue.body.includes('[Bằng chứng một phần]('+partial+')'));
 assert.ok(issue.body.includes('[Biên nhận nghiệm thu]('+url+')'));
});
