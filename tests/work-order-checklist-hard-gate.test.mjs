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


test('NV07 #4783 canonical mixed-case stage IDs are included without faking S4b',()=>{
 const ids=['S1','S2','S3','S4a','S4b','S5a','S5b','S5c','S6','S7'];
 const checked=new Set(['S1','S2','S3','S4a','S5a','S5c']);
 const body=['## STRUCTURED_PROGRESS_CHECKLIST',...ids.map(id=>
  '- ['+(checked.has(id)?'x':' ')+'] '+id+' — Stage'+
  (checked.has(id)?' [Receipt]('+url+')':'')
 )].join('\n');
 const parsed=workOrderChecklistSteps(body);
 assert.equal(parsed.found,true);
 assert.deepEqual(parsed.steps.map(x=>x.id),ids);
 assert.equal(parsed.steps.filter(x=>x.checked).length,6);
 assert.equal(workOrderChecklistGate(card(body),{stepId:'S4a',requireAll:false,expectedEvidenceUrl:url}).ok,true);
 assert.equal(workOrderChecklistGate(card(body),{stepId:'s5c',requireAll:false,expectedEvidenceUrl:url}).ok,true);
 assert.equal(workOrderChecklistGate(card(body),{stepId:'S4b',requireAll:false}).reason,'STEP_UNCHECKED_ON_GITHUB');
 assert.equal(workOrderChecklistGate(card(body)).reason,'STEP_UNCHECKED_ON_GITHUB');
});

test('NV07 canonical case-only duplicate IDs are rejected before acceptance',()=>{
 const body='## STRUCTURED_PROGRESS_CHECKLIST\n- [x] S4a — first [Receipt]('+url+')\n- [x] S4A — duplicate [Receipt]('+url+')';
 assert.equal(workOrderChecklistSteps(body).steps.length,2);
 assert.equal(workOrderChecklistGate(card(body),{stepId:'S4a',requireAll:false}).reason,'DUPLICATE_STEP_ID');
});

test('NV07 S6 cannot be completed by a forged checked checkbox inside a fenced example',()=>{
 for(const [open,close] of [['```md','```'],['~~~markdown','~~~']]){
  const body=['## STRUCTURED_PROGRESS_CHECKLIST',open,
   '- [x] S6 — illustrative only [Receipt]('+url+')',close,
   '- [ ] S6 — actual pending GitHub to Core receipt','## ACCEPTANCE'].join('\n');
  const parsed=workOrderChecklistSteps(body);
  assert.deepEqual(parsed.steps.map(x=>({id:x.id,checked:x.checked})),[{id:'S6',checked:false}]);
  assert.equal(workOrderChecklistGate(card(body),{stepId:'S6',requireAll:false}).reason,
   'STEP_UNCHECKED_ON_GITHUB');
 }
});
test('NV07 indented Markdown code may not impersonate canonical S6 evidence',()=>{
 const body=['## STRUCTURED_PROGRESS_CHECKLIST',
  '    - [x] S6 — code sample [Receipt]('+url+')',
  '- [ ] S6 — real protected Core step','## ACCEPTANCE'].join('\n');
 assert.deepEqual(workOrderChecklistSteps(body).steps.map(x=>x.id),['S6']);
 assert.equal(workOrderChecklistGate(card(body),{stepId:'S6',requireAll:false}).reason,'STEP_UNCHECKED_ON_GITHUB');
});
test('fenced pseudo-checklist heading before real checklist is not a Work Order',()=>{
 const body=['```md','## STRUCTURED_PROGRESS_CHECKLIST',
  '- [x] S6 — fake checked [Receipt]('+url+')','```',
  '## STRUCTURED_PROGRESS_CHECKLIST','- [ ] S6 — only authoritative row',
  '## ACCEPTANCE'].join('\n');
 const parsed=workOrderChecklistSteps(body);
 assert.equal(parsed.found,true);
 assert.deepEqual(parsed.steps.map(x=>({id:x.id,checked:x.checked})),[{id:'S6',checked:false}]);
 assert.equal(workOrderChecklistGate(card(body),{stepId:'S6',requireAll:false}).reason,'STEP_UNCHECKED_ON_GITHUB');
});
test('long tilde fenced code cannot be closed by a shorter marker',()=>{
 const body=['## STRUCTURED_PROGRESS_CHECKLIST','~~~~mjs',
  '- [x] S6 — fake code [Receipt]('+url+')','~~~',
  '- [x] S7 — still code [Receipt]('+url+')','~~~~',
  '- [ ] S6 — pending','- [ ] S7 — pending','## ACCEPTANCE'].join('\n');
 assert.deepEqual(workOrderChecklistSteps(body).steps.map(x=>x.id),['S6','S7']);
 assert.equal(workOrderChecklistGate(card(body)).reason,'STEP_UNCHECKED_ON_GITHUB');
});

test('NV07 rejects a checked S6 hidden inside a Markdown HTML comment',()=>{
 const body=['## STRUCTURED_PROGRESS_CHECKLIST','<!--',
  '- [x] S6 — hidden fake [Receipt]('+url+')','-->','## ACCEPTANCE'].join('\n');
 assert.equal(workOrderChecklistGate(card(body),{stepId:'S6',requireAll:false}).reason,'CHECKLIST_MISSING');
});
test('NV07 rejects a forged checklist heading hidden inside an HTML comment',()=>{
 const body=['<!--','## STRUCTURED_PROGRESS_CHECKLIST',
  '- [x] S6 — hidden [Receipt]('+url+')','-->',
  '## STRUCTURED_PROGRESS_CHECKLIST','- [ ] S6 — actual','## ACCEPTANCE'].join('\n');
 assert.deepEqual(workOrderChecklistSteps(body).steps.map(x=>x.checked),[false]);
 assert.equal(workOrderChecklistGate(card(body),{stepId:'S6',requireAll:false}).reason,'STEP_UNCHECKED_ON_GITHUB');
});
test('NV07 ignores a fake fence marker inside an HTML comment',()=>{
 const body=['## STRUCTURED_PROGRESS_CHECKLIST','<!--','```md',
  '-->','- [ ] S6 — actual','## ACCEPTANCE'].join('\n');
 assert.deepEqual(workOrderChecklistSteps(body).steps.map(x=>x.id),['S6']);
});
test('NV07 preserves visible checked S5c with an inline HTML comment',()=>{
 const body=['## STRUCTURED_PROGRESS_CHECKLIST',
  '- [x] S5c — accepted <!-- note --> [Receipt]('+url+')',
  '- [ ] S6 — actual','## ACCEPTANCE'].join('\n');
 assert.equal(workOrderChecklistGate(card(body),{stepId:'S5c',requireAll:false,expectedEvidenceUrl:url}).ok,true);
});
