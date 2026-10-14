import {test} from 'node:test';
import assert from 'node:assert/strict';
import {workOrderChecklistGate,workOrderChecklistSteps} from '../apps/tigeriq-core/work-order-checklist-hard-gate.mjs';
const url='https://github.com/newsdayads/tigeriq-ai-lab/issues/4780#issuecomment-6171872076';
const card=body=>({number:4780,state:'open',body});
const legacy=['## Kế hoạch tuần tự và tiêu chí nghiệm thu',
 '- [ ] R00 — Kiểm kê',
 '- [x] R08 — jq 1.7 [Bằng chứng]('+url+')',
 '- [ ] R10 — Xây dựng ứng dụng',
 '## Phụ thuộc và thứ tự'].join('\n');
test('a checked verified partial step can be confirmed without inventing full completion',()=>{
 assert.equal(workOrderChecklistGate(card(legacy),{stepId:'R08',requireAll:false,expectedEvidenceUrl:url}).ok,true);
 assert.equal(workOrderChecklistGate(card(legacy)).reason,'STEP_UNCHECKED_ON_GITHUB');
});
test('missing checkbox or link fails closed',()=>{
 assert.equal(workOrderChecklistGate(card(legacy),{stepId:'R10',requireAll:false}).reason,'STEP_UNCHECKED_ON_GITHUB');
 assert.equal(workOrderChecklistGate(card('## STRUCTURED_PROGRESS_CHECKLIST\n- [x] M01 — stage')).reason,'CHECKED_WITHOUT_RECEIPT_LINK');
});
test('all checked linked steps read back passes, unverified content is not asserted',()=>{
 const done=card(['## STRUCTURED_PROGRESS_CHECKLIST','- [x] M01 — First [Receipt]('+url+')','- [x] M02 — Second [Receipt]('+url+')','## ACCEPTANCE'].join('\n'));
 assert.equal(workOrderChecklistGate(done).ok,true);
 assert.equal(workOrderChecklistSteps(done.body).steps.length,2);
});
test('reject missing, duplicate, wrong receipt and nonexistent IDs',()=>{
 assert.equal(workOrderChecklistGate(card('## GOAL\n- [x] R08 — Not a checklist')).reason,'CHECKLIST_MISSING');
 assert.equal(workOrderChecklistGate(card('## STRUCTURED_PROGRESS_CHECKLIST\n- [x] M01 — test [x]('+url+')\n- [x] M01 — duplicate [x]('+url+')')).reason,'DUPLICATE_STEP_ID');
 assert.equal(workOrderChecklistGate(card(legacy),{stepId:'R09',requireAll:false}).reason,'STEP_NOT_FOUND');
 assert.equal(workOrderChecklistGate(card(legacy),{stepId:'R08',requireAll:false,expectedEvidenceUrl:'https://example.com/fake'}).reason,'EXPECTED_RECEIPT_NOT_ON_CARD');
});
test('fail closed on malformed snapshots and prevent historical section counting',()=>{
 assert.equal(workOrderChecklistGate(null).reason,'GITHUB_ISSUE_READBACK_REQUIRED');
 assert.equal(workOrderChecklistGate({number:1,body:'## STRUCTURED_PROGRESS_CHECKLIST\n- [x] M01 — One [receipt]('+url+')\n## OLD\n- [ ] M02 — historical'}).ok,true);
});
