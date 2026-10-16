import { expect, it } from 'vitest';
// @ts-ignore Pure ESM acceptance gate intentionally has no TS declarations.
import { workOrderChecklistGate, workOrderChecklistSteps } from '../apps/tigeriq-core/work-order-checklist-hard-gate.mjs';

const proof='https://github.com/newsdayads/tigeriq-ai-lab/issues/4783#issuecomment-6199127865';
const issue=(body: string): any=>({number:4783,state:'open',body});
const view=(body:string)=>workOrderChecklistSteps(body).steps.map((x:any)=>({id:x.id,checked:x.checked}));
const tick=String.fromCharCode(96).repeat(3);

it('NV07 excludes checked S6 examples in backtick and tilde fenced code',()=>{
 for(const [opener,closer] of [[tick+'md',tick],['~~~markdown','~~~']]){
  const body=['## STRUCTURED_PROGRESS_CHECKLIST',opener,
   '- [x] S6 — FORGED evidence [Receipt]('+proof+')',closer,
   '- [ ] S6 — actual protected write still pending','## ACCEPTANCE'].join('\n');
  expect(view(body)).toEqual([{id:'S6',checked:false}]);
  expect(workOrderChecklistGate(issue(body),{stepId:'S6',requireAll:false}).reason)
   .toBe('STEP_UNCHECKED_ON_GITHUB');
 }
});
it('NV07 does not parse indented code as checked S6 Work Order progress',()=>{
 const body=['## STRUCTURED_PROGRESS_CHECKLIST',
  '    - [x] S6 — fake example [Receipt]('+proof+')',
  '- [ ] S6 — real pending','## ACCEPTANCE'].join('\n');
 expect(view(body)).toEqual([{id:'S6',checked:false}]);
 expect(workOrderChecklistGate(issue(body),{stepId:'S6',requireAll:false}).reason)
  .toBe('STEP_UNCHECKED_ON_GITHUB');
});
it('NV07 skips an entire fabricated checklist heading inside fenced Markdown',()=>{
 const body=[tick+'md','## STRUCTURED_PROGRESS_CHECKLIST',
  '- [x] S6 — fake [Receipt]('+proof+')',tick,
  '## STRUCTURED_PROGRESS_CHECKLIST','- [ ] S6 — canonical pending','## ACCEPTANCE'].join('\n');
 expect(view(body)).toEqual([{id:'S6',checked:false}]);
 expect(workOrderChecklistGate(issue(body),{stepId:'S6',requireAll:false}).reason)
  .toBe('STEP_UNCHECKED_ON_GITHUB');
});
it('long tilde fence requires at least the same number of closing tildes',()=>{
 const body=['## STRUCTURED_PROGRESS_CHECKLIST','~~~~mjs',
  '- [x] S6 — fake in code [Receipt]('+proof+')','~~~',
  '- [x] S7 — still code [Receipt]('+proof+')','~~~~',
  '- [ ] S6 — pending','- [ ] S7 — pending','## ACCEPTANCE'].join('\n');
 expect(view(body)).toEqual([{id:'S6',checked:false},{id:'S7',checked:false}]);
 expect(workOrderChecklistGate(issue(body),{requireAll:true}).reason).toBe('STEP_UNCHECKED_ON_GITHUB');
});
it('NV07 real checked S5c remains linked while real S6 stays unaccepted',()=>{
 const body=['## STRUCTURED_PROGRESS_CHECKLIST',
  '- [x] S5c — source gate previously accepted [Receipt]('+proof+')',
  '- [ ] S6 — protected write pending','- [ ] S7 — runtime pending','## ACCEPTANCE'].join('\n');
 expect(workOrderChecklistGate(issue(body),{stepId:'S5c',requireAll:false,expectedEvidenceUrl:proof}).ok).toBe(true);
 expect(workOrderChecklistGate(issue(body),{stepId:'S6',requireAll:false}).reason).toBe('STEP_UNCHECKED_ON_GITHUB');
});

it('NV07 rejects fake S6 acceptance hidden inside an HTML comment',()=>{
 const body=['## STRUCTURED_PROGRESS_CHECKLIST','<!--',
  '- [x] S6 — hidden fake [Receipt]('+proof+')','-->','## ACCEPTANCE'].join('\n');
 expect(workOrderChecklistSteps(body).steps).toEqual([]);
 expect(workOrderChecklistGate(issue(body),{stepId:'S6',requireAll:false}).reason).toBe('CHECKLIST_MISSING');
});
it('NV07 ignores a forged checklist heading inside an HTML comment',()=>{
 const body=['<!--','## STRUCTURED_PROGRESS_CHECKLIST',
  '- [x] S6 — invisible forged row [Receipt]('+proof+')','-->',
  '## STRUCTURED_PROGRESS_CHECKLIST','- [ ] S6 — actual pending','## ACCEPTANCE'].join('\n');
 expect(view(body)).toEqual([{id:'S6',checked:false}]);
 expect(workOrderChecklistGate(issue(body),{stepId:'S6',requireAll:false}).reason).toBe('STEP_UNCHECKED_ON_GITHUB');
});
it('NV07 does not let a fenced opener hidden in an HTML comment swallow the real S6 row',()=>{
 const body=['## STRUCTURED_PROGRESS_CHECKLIST','<!--',tick+'md',
  '-->','- [ ] S6 — actual pending','## ACCEPTANCE'].join('\n');
 expect(view(body)).toEqual([{id:'S6',checked:false}]);
 expect(workOrderChecklistGate(issue(body),{stepId:'S6',requireAll:false}).reason).toBe('STEP_UNCHECKED_ON_GITHUB');
});
it('NV07 preserves a visible linked step with an inline HTML comment',()=>{
 const body=['## STRUCTURED_PROGRESS_CHECKLIST',
  '- [x] S5c — accepted <!-- annotation --> [Receipt]('+proof+')',
  '- [ ] S6 — actual pending','## ACCEPTANCE'].join('\n');
 expect(workOrderChecklistGate(issue(body),{stepId:'S5c',requireAll:false,expectedEvidenceUrl:proof}).ok).toBe(true);
 expect(workOrderChecklistGate(issue(body),{stepId:'S6',requireAll:false}).reason).toBe('STEP_UNCHECKED_ON_GITHUB');
});

it('NV07 raw HTML block examples never count as accepted S6',()=>{
 for(const [open,close] of [['<pre>','</pre>'],['<script type="text/plain">','</script>'],['<details>','</details>']]){
  const body=['## STRUCTURED_PROGRESS_CHECKLIST',open,
   '- [x] S6 — forged [Receipt]('+proof+')',close,'## ACCEPTANCE'].join('\n');
  expect(workOrderChecklistSteps(body).steps).toEqual([]);
  expect(workOrderChecklistGate(issue(body),{stepId:'S6',requireAll:false}).reason).toBe('CHECKLIST_MISSING');
 }
});
it('NV07 skips a forged checklist heading inside a raw HTML block',()=>{
 const body=['<div>','## STRUCTURED_PROGRESS_CHECKLIST',
  '- [x] S6 — forged [Receipt]('+proof+')','</div>',
  '## STRUCTURED_PROGRESS_CHECKLIST','- [ ] S6 — actual pending','## ACCEPTANCE'].join('\n');
 expect(view(body)).toEqual([{id:'S6',checked:false}]);
});
it('NV07 nested HTML cannot close early and expose forged S6',()=>{
 const body=['## STRUCTURED_PROGRESS_CHECKLIST','<div>','<div>','</div>',
  '- [x] S6 — still hidden [Receipt]('+proof+')','</div>',
  '- [ ] S6 — real pending','## ACCEPTANCE'].join('\n');
 expect(view(body)).toEqual([{id:'S6',checked:false}]);
 expect(workOrderChecklistGate(issue(body),{stepId:'S6',requireAll:false}).reason)
  .toBe('STEP_UNCHECKED_ON_GITHUB');
});
it('NV07 preserves visible legitimate receipt after a raw HTML block',()=>{
 const body=['## STRUCTURED_PROGRESS_CHECKLIST','<pre>',
  '- [x] S6 — hidden [Receipt]('+proof+')','</pre>',
  '- [x] S5c — real [Receipt]('+proof+')',
  '- [ ] S6 — real pending','## ACCEPTANCE'].join('\n');
 expect(view(body)).toEqual([{id:'S5c',checked:true},{id:'S6',checked:false}]);
 expect(workOrderChecklistGate(issue(body),{stepId:'S5c',requireAll:false,expectedEvidenceUrl:proof}).ok).toBe(true);
});

it('NV07 rejects Markdown image, escaped, and inline-code receipt spoofing',()=>{
 const tick=String.fromCharCode(96);
 const forged=[
  tick+'[Receipt]('+proof+')'+tick,
  tick+tick+'[Receipt]('+proof+')'+tick+tick,
  '\\[Receipt]('+proof+')',
  '![Receipt]('+proof+')',
  '<code>[Receipt]('+proof+')</code>'
 ];
 for(const fragment of forged){
  const body=['## STRUCTURED_PROGRESS_CHECKLIST',
   '- [x] S6 — '+fragment,'## ACCEPTANCE'].join('\n');
  expect(workOrderChecklistGate(issue(body),{stepId:'S6',requireAll:false}).reason)
   .toBe('CHECKED_WITHOUT_RECEIPT_LINK');
 }
});
it('NV07 accepts visible receipt after inline code, not the code example',()=>{
 const tick=String.fromCharCode(96);
 const body=['## STRUCTURED_PROGRESS_CHECKLIST',
  '- [x] S5c — '+tick+'literal example'+tick+' [Receipt]('+proof+')',
  '- [ ] S6 — pending','## ACCEPTANCE'].join('\n');
 expect(workOrderChecklistGate(issue(body),{stepId:'S5c',requireAll:false,expectedEvidenceUrl:proof}).ok)
  .toBe(true);
 expect(workOrderChecklistGate(issue(body),{stepId:'S6',requireAll:false}).reason)
  .toBe('STEP_UNCHECKED_ON_GITHUB');
});
it('NV07 honors escaped backtick without suppressing real receipt link',()=>{
 const tick=String.fromCharCode(96);
 const body=['## STRUCTURED_PROGRESS_CHECKLIST',
  '- [x] S5c — \\'+tick+' [Receipt]('+proof+')','## ACCEPTANCE'].join('\n');
 expect(workOrderChecklistGate(issue(body),{stepId:'S5c',requireAll:false,expectedEvidenceUrl:proof}).ok).toBe(true);
});

it('NV07 QA #4940: iframe, figure and unknown HTML blocks cannot inject S6 evidence',()=>{
 for(const tag of ['iframe','figure','custom-widget']){
  const body=['## STRUCTURED_PROGRESS_CHECKLIST','<'+tag+'>',
   '- [x] S6 — fake [Receipt]('+proof+')','</'+tag+'>',
   '- [ ] S6 — actual pending','## ACCEPTANCE'].join('\n');
  expect(view(body)).toEqual([{id:'S6',checked:false}]);
  expect(workOrderChecklistGate(issue(body),{stepId:'S6',requireAll:false}).reason)
   .toBe('STEP_UNCHECKED_ON_GITHUB');
 }
});
it('NV07 QA #4940: nested iframe and forged HTML heading remain fail closed',()=>{
 const nested=['## STRUCTURED_PROGRESS_CHECKLIST','<iframe>','<iframe>',
  '</iframe>','- [x] S6 — false [Receipt]('+proof+')','</iframe>',
  '- [ ] S6 — actual pending','## ACCEPTANCE'].join('\n');
 expect(view(nested)).toEqual([{id:'S6',checked:false}]);
 const heading=['<iframe>','## STRUCTURED_PROGRESS_CHECKLIST',
  '- [x] S6 — false [Receipt]('+proof+')','</iframe>',
  '## STRUCTURED_PROGRESS_CHECKLIST','- [ ] S6 — real pending'].join('\n');
 expect(view(heading)).toEqual([{id:'S6',checked:false}]);
});
it('NV07 QA #4940: void HTML followed by valid S5c and pending S6 remains visible',()=>{
 const body=['## STRUCTURED_PROGRESS_CHECKLIST','<br>',
  '- [x] S5c — valid [Receipt]('+proof+')',
  '- [ ] S6 — still pending','## ACCEPTANCE'].join('\n');
 expect(workOrderChecklistGate(issue(body),{stepId:'S5c',requireAll:false,expectedEvidenceUrl:proof}).ok).toBe(true);
 expect(workOrderChecklistGate(issue(body),{stepId:'S6',requireAll:false}).reason).toBe('STEP_UNCHECKED_ON_GITHUB');
});

it('NV07 QA rejects receipt links wrapped in inline HTML or mixed with inline HTML',()=>{
 for(const fragment of [
  '<span>[Receipt]('+proof+')</span>',
  '<span class="note">[Receipt]('+proof+')</span>',
  '<a href="'+proof+'">[Receipt]('+proof+')</a>',
  '<span>untrusted</span> [Receipt]('+proof+')',
  '[Receipt]('+proof+') <span>untrusted</span>'
 ]){
  const body=['## STRUCTURED_PROGRESS_CHECKLIST',
   '- [x] S6 — '+fragment,'## ACCEPTANCE'].join('\n');
  expect(workOrderChecklistGate(issue(body),{stepId:'S6',requireAll:false}).reason)
   .toBe('CHECKED_WITHOUT_RECEIPT_LINK');
 }
 const actual=['## STRUCTURED_PROGRESS_CHECKLIST',
  '- [x] S5c — plain Markdown [Receipt]('+proof+')',
  '- [ ] S6 — not yet accepted','## ACCEPTANCE'].join('\n');
 expect(workOrderChecklistGate(issue(actual),{stepId:'S5c',requireAll:false,expectedEvidenceUrl:proof}).ok).toBe(true);
 expect(workOrderChecklistGate(issue(actual),{stepId:'S6',requireAll:false}).reason)
  .toBe('STEP_UNCHECKED_ON_GITHUB');
});
