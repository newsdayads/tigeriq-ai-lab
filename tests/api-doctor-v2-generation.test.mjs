import test from 'node:test';
import assert from 'node:assert/strict';
import {buildApiDoctorRepairWorkOrder} from '../apps/tigeriq-core/api-doctor.mjs';
import {validateWorkOrderLifecycleV2} from '../apps/tigeriq-core/work-order-lifecycle-v2.mjs';
import {safeAutoWorkAdmission} from '../apps/tigeriq-core/github-intake.mjs';

const create=()=>buildApiDoctorRepairWorkOrder({
 employeeId:'NV11',provider:'groq',
 resourceId:'res:groq:openai-gpt-oss-120b:default:core',
 failureClass:'source_contract',message:'EXECUTION_ACCEPTANCE_MISSING',
 signature:'NV11|groq|source_contract|execution_acceptance_missing',
});
test('API Doctor source repair must satisfy the native V2 new-ticket hard gate',()=>{
 const t=create();
 const issue={number:99901,state:'open',created_at:'2026-10-26T03:00:00.000Z',title:t.title,body:t.body};
 const gate=validateWorkOrderLifecycleV2(issue);
 assert.equal(gate.required,true);
 assert.deepEqual(gate.missing,[]);
 assert.equal(gate.valid,true);
 assert.equal(gate.steps.length,4);
 assert.equal(gate.steps.every(x=>!x.checked),true);
 assert.match(t.body,/^SAME_FAILURE_RETRY_MAX=2$/m);
 assert.match(t.body,/^VERIFICATION_MAX_PER_HEAD=2$/m);
 assert.match(t.body,/^MUTATION_OWNER=CORE_DYNAMIC_LEASE$/m);
 assert.match(t.body,/^NO_CREDENTIAL_CHANGE=true$/m);
 assert.match(t.body,/^NO_PRODUCTION_RELEASE=true$/m);
 assert.match(t.body,/^DONE=false$/m);
 assert.ok(!/^STARTED_AT=\d{4}/m.test(t.body));
 const admission=safeAutoWorkAdmission(issue);
 assert.notEqual(admission.reason,'LIFECYCLE_V2_CONTRACT_INVALID');
});

test('pre-fix legacy-shaped new repair is rejected rather than bypassing V2',()=>{
 const t=create();
 const bad=t.body.replace('WORK_ORDER_LIFECYCLE=V2','WORK_ORDER_LIFECYCLE=MISSING')
  .replace('## STRUCTURED_PROGRESS_CHECKLIST','## OLD_FORMAT');
 const issue={number:99902,state:'open',created_at:'2026-10-26T03:00:00.000Z',title:t.title,body:bad};
 const gate=validateWorkOrderLifecycleV2(issue);
 assert.equal(gate.required,true);
 assert.equal(gate.valid,false);
 assert.ok(gate.missing.includes('WORK_ORDER_LIFECYCLE=V2'));
 assert.ok(gate.missing.includes('CHECKLIST_2_TO_64'));
});
