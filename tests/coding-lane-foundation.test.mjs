import test from 'node:test';
import assert from 'node:assert';
import {applyCompactEdits,assertPrOpenState,gateFailureIssues,invokeJsonWithFailover,isResourceTransientError,resourceWaitPlan,runGateWithRepair,shouldResumeExistingPr,shrinkAiPrompt,validateCompactEdits} from '../apps/tigeriq-coding-lane/coding-lane.mjs';
import {isRetryableAiError,parseJsonObject} from '../apps/tigeriq-coding-lane/policy.mjs';

const nv11={id:'NV11',provider:'fake',model:'a'};
const nv19={id:'NV19',provider:'fake',model:'b'};
const nv13={id:'NV13',provider:'fake',model:'c'};

test('foundation bounded retry and autonomous repair',async(t)=>{
  await t.test('malformed JSON retries same NV once then fails over',async()=>{
    const calls=[];
    const invokeFn=async(r,prompt)=>{
      calls.push({id:r.id,prompt});
      if(calls.length<=2)return '{bad json';
      return '{"status":"blocked","summary":"ok"}';
    };
    const out=await invokeJsonWithFailover(nv11,'x'.repeat(40000),{resourcePool:[nv11,nv19],invokeFn,maxResources:2});
    assert.strictEqual(out.resource.id,'NV19');
    assert.strictEqual(out.attempts,3);
    assert.deepStrictEqual(calls.map(x=>x.id),['NV11','NV11','NV19']);
    assert.ok(calls[1].prompt.length<calls[0].prompt.length);
  });

  await t.test('outer markdown fence is stripped without mutating source literals',()=>{
    const source="const clean=String(text||'').replace(/```json|```/gi,'').trim();";
    const payload=JSON.stringify({summary:'ok',changes:[{path:'apps/tigeriq-core/core.mjs',content:source}]});
    const out=parseJsonObject(`\n\`\`\`json\n${payload}\n\`\`\`\n`);
    assert.strictEqual(out.changes[0].content,source);
  });

  await t.test('HTTP 413 retries same NV with a shrunken prompt',async()=>{
    const calls=[];
    const invokeFn=async(r,prompt)=>{
      calls.push({id:r.id,prompt});
      if(calls.length===1){const e=new Error('HTTP_413:payload too large');e.status=413;throw e;}
      return '{"status":"blocked","summary":"ok"}';
    };
    const out=await invokeJsonWithFailover(nv11,'x'.repeat(40000),{resourcePool:[nv11,nv19],invokeFn,maxResources:2});
    assert.strictEqual(out.resource.id,'NV11');
    assert.strictEqual(out.attempts,2);
    assert.deepStrictEqual(calls.map(x=>x.id),['NV11','NV11']);
    assert.ok(calls[1].prompt.length<calls[0].prompt.length);
  });

  await t.test('post-parse invalid changes retry same NV then fail over',async()=>{
    const calls=[];
    const invokeFn=async(r,prompt)=>{
      calls.push({id:r.id,prompt});
      if(calls.length<=2)return '{"summary":"bad","changes":[]}';
      return '{"summary":"ok","changes":[{"path":"tests/example.test.mjs","content":"ok"}]}';
    };
    const validateData=data=>{if(!Array.isArray(data.changes)||data.changes.length<1||data.changes.length>8)throw new Error('CODING_CHANGES_COUNT_INVALID')};
    const out=await invokeJsonWithFailover(nv11,'x'.repeat(40000),{resourcePool:[nv11,nv19],invokeFn,maxResources:2,validateData});
    assert.strictEqual(out.resource.id,'NV19');
    assert.strictEqual(out.attempts,3);
    assert.deepStrictEqual(calls.map(x=>x.id),['NV11','NV11','NV19']);
  });

  await t.test('scope validation remains fail-closed inside validator boundary',async()=>{
    let count=0;
    await assert.rejects(()=>invokeJsonWithFailover(nv11,'x',{resourcePool:[nv11,nv19],invokeFn:async()=>{count++;return '{"summary":"x","changes":[{"path":"bad","content":"x"}]}'},validateData:()=>{throw new Error('CODING_SCOPE_VIOLATION')}}),/CODING_SCOPE_VIOLATION/);
    assert.strictEqual(count,1);
  });

  await t.test('HTTP 429 can fail over through a third eligible free resource with bounded backoff',async()=>{
    const calls=[];const sleeps=[];
    const invokeFn=async(r)=>{
      calls.push(r.id);
      if(r.id!=='NV13'){const e=new Error('HTTP_429:rate');e.status=429;throw e;}
      return '{"decision":"approve","summary":"ok","issues":[]}';
    };
    const out=await invokeJsonWithFailover(nv11,'review',{resourcePool:[nv11,nv19,nv13],invokeFn,maxResources:3,sleepFn:async ms=>sleeps.push(ms),randomFn:()=>0.5,backoffBaseMs:100});
    assert.strictEqual(out.resource.id,'NV13');
    assert.deepStrictEqual(calls,['NV11','NV11','NV19','NV19','NV13']);
    assert.strictEqual(sleeps.length,2);
    assert.ok(sleeps.every(ms=>ms>=0&&ms<=10000));
  });

  await t.test('non-retryable error does not fail over',async()=>{
    let count=0;
    await assert.rejects(()=>invokeJsonWithFailover(nv11,'x',{resourcePool:[nv11,nv19],invokeFn:async()=>{count++;throw new Error('POLICY_DENIED')}}),/POLICY_DENIED/);
    assert.strictEqual(count,1);
  });

  await t.test('excluded implementer can never become reviewer',async()=>{
    const out=await invokeJsonWithFailover(nv11,'x',{exclude:['NV11'],resourcePool:[nv11,nv19],invokeFn:async(r)=>`{"decision":"approve","summary":"${r.id}","issues":[]}`});
    assert.strictEqual(out.resource.id,'NV19');
  });

  await t.test('closed unmerged PR reconciles immediately',()=>{
    assert.throws(()=>assertPrOpenState({number:7,state:'closed',merged:false}),e=>e.code==='PR_CLOSED_UNMERGED'&&e.detail.number===7);
    assert.strictEqual(assertPrOpenState({number:8,state:'open',merged:false}),true);
  });

  await t.test('retry classifier covers malformed JSON and transport failures',()=>{
    assert.strictEqual(isRetryableAiError(new Error('JSON_OBJECT_INVALID:unterminated string')),true);
    assert.strictEqual(isRetryableAiError(new Error('CODING_CHANGES_COUNT_INVALID')),true);
    const e413=new Error('HTTP_413:payload too large');e413.status=413;
    assert.strictEqual(isRetryableAiError(e413),true);
    const e429=new Error('rate');e429.status=429;
    assert.strictEqual(isRetryableAiError(e429),true);
    assert.strictEqual(isRetryableAiError(new Error('CODING_SCOPE_VIOLATION')),false);
    assert.strictEqual(isRetryableAiError(new Error('POLICY_DENIED')),false);
  });

  await t.test('prompt shrink is deterministic and bounded',()=>{
    const p='A'.repeat(50000)+'TAIL';
    const out=shrinkAiPrompt(p,18000);
    assert.ok(out.length<19000);
    assert.ok(out.includes('MODEL_CONTEXT_REDUCED'));
    assert.ok(out.endsWith('TAIL'));
  });

  await t.test('CI_GATES_FAILED repairs and reruns the same gate loop',async()=>{
    let waits=0;let repairs=0;const waiting=[];
    const result=await runGateWithRepair({
      waitFn:async()=>{
        waits++;
        if(waits===1){const e=new Error('CI_GATES_FAILED');e.code='CI_GATES_FAILED';e.detail={states:[{name:'CI Verify',status:'completed',conclusion:'failure'}]};throw e;}
        return {sha:'abc',state:'passed'};
      },
      repairFn:async({repairCycle,evidence})=>{repairs++;assert.strictEqual(repairCycle,1);assert.ok(evidence[0].includes('CI Verify'));},
      onWaiting:async x=>waiting.push(x.reason),
      maxRepairCycles:3,
      timeoutRetries:1,
    });
    assert.strictEqual(result.sha,'abc');
    assert.strictEqual(waits,2);
    assert.strictEqual(repairs,1);
    assert.deepStrictEqual(waiting,['failed']);
  });

  await t.test('CI_GATES_TIMEOUT retries once then blocks with evidence',async()=>{
    let waits=0;
    await assert.rejects(()=>runGateWithRepair({
      waitFn:async()=>{waits++;const e=new Error('CI_GATES_TIMEOUT');e.code='CI_GATES_TIMEOUT';throw e;},
      repairFn:async()=>{throw new Error('repair must not run for timeout');},
      maxRepairCycles:3,
      timeoutRetries:1,
    }),e=>e.code==='CI_GATES_TIMEOUT'&&e.detail.timeoutRetries===1);
    assert.strictEqual(waits,2);
  });

  await t.test('CI repair budget is finite',async()=>{
    let waits=0;let repairs=0;
    await assert.rejects(()=>runGateWithRepair({
      waitFn:async()=>{waits++;const e=new Error('CI_GATES_FAILED');e.code='CI_GATES_FAILED';e.detail={states:[{name:'CI Verify',status:'completed',conclusion:'failure'}]};throw e;},
      repairFn:async()=>{repairs++;},
      maxRepairCycles:3,
      timeoutRetries:1,
    }),e=>e.code==='CI_GATE_REPAIR_EXHAUSTED'&&e.detail.repairCycles===3);
    assert.strictEqual(repairs,3);
    assert.strictEqual(waits,4);
  });

  await t.test('non-CI failure is not converted into repair',async()=>{
    let repairs=0;
    await assert.rejects(()=>runGateWithRepair({
      waitFn:async()=>{const e=new Error('CODING_SCOPE_VIOLATION');e.code='CODING_SCOPE_VIOLATION';throw e;},
      repairFn:async()=>{repairs++;},
    }),/CODING_SCOPE_VIOLATION/);
    assert.strictEqual(repairs,0);
  });

  await t.test('retryable provider exhaustion becomes bounded WAITING_RESOURCE',()=>{
    const first=resourceWaitPlan({retryCount:0,startedAt:'2026-09-13T00:00:00.000Z',nowMs:Date.parse('2026-09-13T00:00:10.000Z')});
    assert.strictEqual(first.wait,true);
    assert.strictEqual(first.retryCount,1);
    assert.strictEqual(first.delayMs,30000);
    const exhausted=resourceWaitPlan({retryCount:6,startedAt:'2026-09-13T00:00:00.000Z',nowMs:Date.parse('2026-09-13T00:10:00.000Z')});
    assert.strictEqual(exhausted.wait,false);
  });

  await t.test('resource transient classifier stays fail-closed for policy errors',()=>{
    assert.strictEqual(isResourceTransientError(new Error('EMPTY_RESPONSE')),true);
    assert.strictEqual(isResourceTransientError(new Error('NO_INDEPENDENT_REVIEWER_AVAILABLE')),true);
    assert.strictEqual(isResourceTransientError(new Error('POLICY_DENIED')),false);
    assert.strictEqual(isResourceTransientError(new Error('CODING_SCOPE_VIOLATION')),false);
  });

  await t.test('existing branch and PR are resumable identity',()=>{
    assert.strictEqual(shouldResumeExistingPr({branch:'tigeriq/nv12/job',pr_number:722}),true);
    assert.strictEqual(shouldResumeExistingPr({branch:'',pr_number:722}),false);
    assert.strictEqual(shouldResumeExistingPr({branch:'tigeriq/nv12/job',pr_number:null}),false);
  });
  await t.test('compact repair applies one exact unique snippet only',()=>{
    const path='apps/tigeriq-core/core.mjs';
    const edits=[{path,old:'JSON.stringify(stateData)',new:'stateData'}];
    assert.strictEqual(validateCompactEdits(edits,[path]),true);
    assert.strictEqual(applyCompactEdits('before JSON.stringify(stateData) after',edits),'before stateData after');
    assert.throws(()=>applyCompactEdits('JSON.stringify(stateData) + JSON.stringify(stateData)',edits),/CODING_COMPACT_EDIT_OLD_NOT_UNIQUE/);
  });

  await t.test('compact repair remains fail-closed outside allowed scope',()=>{
    assert.throws(()=>validateCompactEdits([{path:'docs/SECURITY.md',old:'a',new:'b'}],['apps/tigeriq-core/core.mjs']),/CODING_SCOPE_VIOLATION/);
    assert.throws(()=>validateCompactEdits([{path:'apps/tigeriq-core/core.mjs',old:'same',new:'same'}],['apps/tigeriq-core/core.mjs']),/CODING_COMPACT_EDIT_INVALID/);
  });

  await t.test('multiple compact edits on one file are order-independent and reject overlap',()=>{
    const path='apps/tigeriq-core/core.mjs';
    const edits=[{path,old:'alpha',new:'A-LONG'},{path,old:'gamma',new:'G'}];
    assert.strictEqual(validateCompactEdits(edits,[path]),true);
    assert.strictEqual(applyCompactEdits('alpha beta gamma',edits),'A-LONG beta G');
    assert.strictEqual(applyCompactEdits('alpha beta gamma',[...edits].reverse()),'A-LONG beta G');
    assert.throws(()=>applyCompactEdits('abcdef',[{path,old:'abc',new:'x'},{path,old:'bcd',new:'y'}]),/CODING_COMPACT_EDIT_OVERLAP/);
    assert.throws(()=>validateCompactEdits([{path,old:'alpha',new:'A'},{path,old:'alpha',new:'B'}],[path]),/CODING_COMPACT_EDIT_DUPLICATE/);
    assert.throws(()=>validateCompactEdits([{path,old:'alpha',new:'A'},{path:'tests/other.mjs',old:'beta',new:'B'}],[path,'tests/other.mjs']),/CODING_COMPACT_REPAIR_MULTI_FILE_INVALID/);
  });
  await t.test('gate evidence is concise and machine-usable',()=>{
    const issues=gateFailureIssues({message:'CI_GATES_FAILED',detail:{states:[{name:'CI Verify',status:'completed',conclusion:'failure'},{name:'Queue Hygiene Verify',status:'completed',conclusion:'success'}]}});
    assert.deepStrictEqual(issues,['CI Verify: failure (completed)']);
  });
});
test('Gemini internal 429 exhaustion still fails over to next provider',async()=>{
  const gemini={id:'NV12',provider:'gemini',model:'gemini-test'};
  const backup={id:'NV13',provider:'fake',model:'backup'};
  const calls=[];
  const invokeFn=async r=>{
    calls.push(r.id);
    if(r.id==='NV12'){const e=new Error('HTTP_429 RESOURCE_EXHAUSTED');e.status=429;e.geminiRetryExhausted=true;throw e;}
    return '{"status":"blocked","summary":"backup-ok"}';
  };
  const out=await invokeJsonWithFailover(gemini,'x',{resourcePool:[gemini,backup],invokeFn,maxResources:2});
  assert.strictEqual(out.resource.id,'NV13');
  assert.deepStrictEqual(calls,['NV12','NV13']);
});
