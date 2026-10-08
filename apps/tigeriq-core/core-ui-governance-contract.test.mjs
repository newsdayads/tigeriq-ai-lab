import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CORE_ROUTED_UI_WORKERS, classifyWorkOrder, roleCanPull} from './work-routing-policy.mjs';
import {parseCoreUiIssue, selectCoreUiWorker} from './core-ui-assignment.mjs';

const workflow=readFileSync(new URL('../../bootstrap/02_TIGERIQ_WORKFLOW.md',import.meta.url),'utf8');
const employeeModel=readFileSync(new URL('../../bootstrap/03_TIGERIQ_AI_EMPLOYEE_MODEL.md',import.meta.url),'utf8');

function reviewIssue({number=4565001,priority='P1',capability='review',scope='P0_TEST_CORE_UI_SCOPE',extra=''}={}){
  return {
    number,
    title:'[P1][TEST] Core-UI governance contract',
    state:'open',
    body:[
      'PRIORITY='+priority,
      'OWNER_POLICY=AUTO',
      'TIGERIQ_EXECUTABLE=true',
      'CAPABILITY='+capability,
      'RESOURCE_SCOPE='+scope,
      'NO_CODE_CHANGE=true',
      'NO_PC01_SHELL=true',
      'NO_DIRECT_MAIN=true',
      'NO_PAID_COST=true',
      'NO_CREDENTIAL_CHANGE=true',
      'NO_DESTRUCTIVE=true',
      'NO_PRODUCTION_RELEASE=true',
      extra,
    ].join('\n'),
  };
}

test('canonical Bootstrap and routing implementation agree on NV02/NV03/NV04 scope',()=>{
  assert.match(workflow,/\*\*NV02 \(ChatGPT Plus\)\*\*.*ngoài quyền giao việc của Core/);
  assert.match(workflow,/\*\*NV03 \(ChatGPT Go\)\*\*/);
  assert.match(workflow,/\*\*NV04 \(Gemini Pro\)\*\*/);
  assert.match(workflow,/Core \*\*giao trực tiếp Work Order P1–P5 đúng năng lực\*\*/);
  assert.match(employeeModel,/Core không giao, chuyển, thu hồi, hoặc tạo fallback cho NV02/);
  assert.match(employeeModel,/Core chỉ giao nhiệm vụ P1–P5 phù hợp cho NV03\/NV04/);
  assert.deepEqual(CORE_ROUTED_UI_WORKERS,['NV03','NV04']);
  assert.match(workflow,/App Chrome là hệ \*\*LOCAL-only trên PC01\*\*/);
});

test('NV03/NV04 are eligible for narrow independent roles and do not self-pull',()=>{
  assert.equal(selectCoreUiWorker('review'),'NV03');
  assert.equal(selectCoreUiWorker('deep_research'),'NV04');
  assert.equal(selectCoreUiWorker('second_opinion'),'NV04');
  const review=classifyWorkOrder(reviewIssue().body);
  assert.equal(review.workerId,'NV03');
  const research=classifyWorkOrder(reviewIssue({capability:'deep_research'}).body);
  assert.equal(research.workerId,'NV04');
  assert.deepEqual(parseCoreUiIssue(reviewIssue()).eligibleWorkerIds,['NV03','NV04']); // NV03 primary, NV04 eligible fallback
  assert.deepEqual(parseCoreUiIssue(reviewIssue({number:4565002,capability:'deep_research'})).eligibleWorkerIds,['NV04']);
  for(const worker of ['NV02','NV03','NV04'])assert.equal(roleCanPull(worker),false);
});

test('Core UI lane cannot select NV02, auto-claim P0, or cross App Chrome scope',()=>{
  assert.equal(parseCoreUiIssue(reviewIssue({extra:'ASSIGNED_EXECUTOR=NV02'})),null);
  const unsafe=reviewIssue({extra:'AUTONOMOUS_CODE=true\\nASSIGNED_EXECUTOR=NV03'});
  unsafe.body=unsafe.body.replace('NO_CODE_CHANGE=true','NO_CODE_CHANGE=false');
  assert.equal(parseCoreUiIssue(unsafe),null,'NV03/NV04 cannot use AUTONOMOUS_CODE to bypass the read-only gate');
  assert.equal(parseCoreUiIssue(reviewIssue({priority:'P0'})),null);
  assert.equal(parseCoreUiIssue(reviewIssue({scope:'APP_CHROME_GOVERNANCE_TEST'})),null);
  assert.equal(CORE_ROUTED_UI_WORKERS.includes('NV02'),false);
});
