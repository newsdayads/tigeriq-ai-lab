import test from 'node:test';
import assert from 'node:assert';
import {activeProviderCooldownIds,applyCompactEdits,assertPrOpenState,buildLocalFileContext,classifyAiFailure,codingPathsOverlap,gateFailureIssues,invokeJsonWithFailover,isRefreshableCompactPatchError,isRepairTransportExhausted,isResourceTransientError,preserveGenerationPrompt,recoverAfterCodingRestart,resourceWaitPlan,restartRecoveryDecision,runGateWithRepair,shouldResumeExistingPr,shrinkAiPrompt,validateCompactEdits,validateManagerJobPaths} from '../apps/tigeriq-coding-lane/coding-lane.mjs';
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

  await t.test('manager out-of-scope proposal retries/fails over instead of terminal blocking',async()=>{
    const canonical=['tests/coding-lane-ai-json-transport.test.mjs'];
    const calls=[];
    const invokeFn=async r=>{
      calls.push(r.id);
      if(r.id==='NV11')return '{"status":"continue","summary":"bad scope","job":{"title":"x","instruction":"x","paths":["apps/tigeriq-core/core.mjs"]}}';
      return '{"status":"continue","summary":"ok","job":{"title":"x","instruction":"x","paths":["tests/coding-lane-ai-json-transport.test.mjs"]}}';
    };
    const out=await invokeJsonWithFailover(nv11,'manager',{resourcePool:[nv11,nv19],maxResources:2,invokeFn,validateData:d=>validateManagerJobPaths(d,canonical)});
    assert.strictEqual(out.resource.id,'NV19');
    assert.deepStrictEqual(calls,['NV11','NV11','NV19']);
    assert.strictEqual(classifyAiFailure(new Error('MANAGER_SCOPE_MISMATCH:apps/tigeriq-core/core.mjs')),'output_contract');
    assert.strictEqual(isRetryableAiError(new Error('MANAGER_SCOPE_MISMATCH:apps/tigeriq-core/core.mjs')),true);
  });

  await t.test('manager path validation stays fail-closed for unsafe paths',()=>{
    const canonical=['tests/coding-lane-ai-json-transport.test.mjs'];
    assert.throws(()=>validateManagerJobPaths({status:'continue',job:{paths:['../escape.mjs']}},canonical),/MANAGER_PATHS_INVALID/);
    assert.deepStrictEqual(validateManagerJobPaths({status:'continue',job:{paths:canonical}},canonical),canonical);
  });

  await t.test('repair transport exhaustion is eligible for one bounded compact-changes fallback',()=>{
    const output=Object.assign(new Error('OUTPUT_CONTRACT_EXHAUSTED'),{code:'OUTPUT_CONTRACT_EXHAUSTED'});
    const budget=Object.assign(new Error('AI_RETRY_BUDGET_EXHAUSTED'),{code:'AI_RETRY_BUDGET_EXHAUSTED'});
    assert.strictEqual(isRepairTransportExhausted(output),true);
    assert.strictEqual(isRepairTransportExhausted(budget),true);
    assert.strictEqual(isRepairTransportExhausted(new Error('CODING_SCOPE_VIOLATION')),false);
  });

  await t.test('same-PR repair source contains compact changes fallback after direct edit-schema exhaustion',()=>{
    const src=require('node:fs').readFileSync(new URL('../apps/tigeriq-coding-lane/coding-lane.mjs',import.meta.url),'utf8');
    assert.match(src,/isRepairTransportExhausted\(error\)/);
    assert.match(src,/fallback=await generateChanges\(selected,j,context,fallbackIssues,exclude\)/);
    assert.match(src,/fallback:'compact_changes_transport'/);
  });

  await t.test('default failover can reach the sixth eligible coding provider',async()=>{
    const pool=Array.from({length:6},(_,i)=>({id:`NV${i+11}`,provider:'fake',model:String(i)}));
    const calls=[];
    const out=await invokeJsonWithFailover(pool[0],'x',{resourcePool:pool,invokeFn:async r=>{calls.push(r.id);if(r.id!=='NV16')return '{bad json';return '{"status":"blocked","summary":"ok"}';}});
    assert.strictEqual(out.resource.id,'NV16');
    assert.deepStrictEqual(calls.map(x=>x),['NV11','NV11','NV12','NV12','NV13','NV13','NV14','NV14','NV15','NV15','NV16']);
  });

  await t.test('HTTP 429 skips the limited provider immediately and fails over',async()=>{
    const calls=[];
    const invokeFn=async(r)=>{
      calls.push(r.id);
      if(r.id!=='NV13'){const e=new Error('HTTP_429:rate');e.status=429;throw e;}
      return '{"decision":"approve","summary":"ok","issues":[]}';
    };
    const out=await invokeJsonWithFailover(nv11,'review',{resourcePool:[nv11,nv19,nv13],invokeFn,maxResources:3});
    assert.strictEqual(out.resource.id,'NV13');
    assert.deepStrictEqual(calls,['NV11','NV19','NV13']);
    assert.deepStrictEqual(out.failureLedger.map(x=>x.class),['rate_limit','rate_limit']);
  });

  await t.test('mixed output failures and 429 become OUTPUT_CONTRACT_EXHAUSTED, not resource wait',async()=>{
    const calls=[];
    const invokeFn=async(r)=>{
      calls.push(r.id);
      if(r.id==='NV19'){const e=new Error('HTTP_429:rate');e.status=429;throw e;}
      return '{bad json';
    };
    await assert.rejects(()=>invokeJsonWithFailover(nv11,'x',{resourcePool:[nv11,nv13,nv19],invokeFn,maxResources:3}),e=>{
      assert.strictEqual(e.code,'OUTPUT_CONTRACT_EXHAUSTED');
      assert.deepStrictEqual(e.detail.failureLedger.map(x=>x.class),['output_contract','output_contract','output_contract','output_contract','rate_limit']);
      assert.strictEqual(isResourceTransientError(e),false);
      return true;
    });
    assert.deepStrictEqual(calls,['NV11','NV11','NV13','NV13','NV19']);
  });

  await t.test('all providers unavailable produce resource wait classification with cooldown evidence',async()=>{
    const invokeFn=async()=>{const e=new Error('HTTP_429:rate');e.status=429;throw e;};
    await assert.rejects(()=>invokeJsonWithFailover(nv11,'x',{resourcePool:[nv11,nv19],invokeFn,maxResources:2}),e=>{
      assert.strictEqual(e.code,'AI_RESOURCES_UNAVAILABLE');
      assert.strictEqual(isResourceTransientError(e),true);
      assert.strictEqual(e.detail.failureLedger.length,2);
      assert.ok(e.detail.failureLedger.every(x=>x.class==='rate_limit'&&Date.parse(x.cooldownUntil)>Date.now()));
      const excluded=activeProviderCooldownIds({detail:e.detail},Date.now());
      assert.deepStrictEqual(excluded.sort(),['NV11','NV19']);
      return true;
    });
  });

  await t.test('failure classifier separates output errors from provider exhaustion',()=>{
    assert.strictEqual(classifyAiFailure(Object.assign(new Error('HTTP_429:rate'),{status:429})),'rate_limit');
    assert.strictEqual(classifyAiFailure(new Error('JSON_OBJECT_INVALID:bad')),'output_contract');
    assert.strictEqual(classifyAiFailure(new Error('EMPTY_RESPONSE')),'invalid_response');
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

  await t.test('restart recovery classifies orphaned PR states fail closed',()=>{
    const job={status:'waiting_ci',pr_number:1105,branch:'tigeriq/nv17/job'};
    assert.deepStrictEqual(restartRecoveryDecision(job,{state:'closed',merged:false}),{action:'fail',code:'CODING_RESTART_PR_CLOSED',prNumber:1105});
    assert.deepStrictEqual(restartRecoveryDecision(job,{state:'open',merged:false}),{action:'queue',code:'CODING_RESTART_RESUME_PR_OPEN',prNumber:1105});
    assert.deepStrictEqual(restartRecoveryDecision(job,{state:'closed',merged:true,merged_at:'2026-09-20T00:00:00Z'}),{action:'done',code:'CODING_RESTART_PR_ALREADY_MERGED',prNumber:1105});
    assert.strictEqual(restartRecoveryDecision({...job,pr_number:null},null).code,'CODING_RESTART_RESUME_IDENTITY_INCOMPLETE');
    assert.strictEqual(restartRecoveryDecision({...job,status:'done'},{state:'closed'}).action,'ignore');
  });

  await t.test('restart recovery terminalizes a stale waiting_ci closed PR and frees the lane',async()=>{
    const job={id:'job-stale',objective_id:'obj-stale',status:'waiting_ci',pr_number:1105,branch:'tigeriq/nv17/job',created_at:'2026-09-19T00:00:00Z'};
    const calls=[];
    const db={async query(sql,params=[]){
      calls.push({sql,params});
      if(sql.startsWith('select * from tigeriq_coding_jobs'))return{rows:[job],rowCount:1};
      if(sql.startsWith("update tigeriq_coding_jobs set status='failed'"))return{rows:[],rowCount:1};
      return{rows:[],rowCount:1};
    }};
    const out=await recoverAfterCodingRestart({db,fetchPr:async number=>({number,state:'closed',merged:false})});
    assert.deepStrictEqual(out,{requeued:0,completed:0,failed:1,deferred:0});
    assert.ok(calls.some(x=>x.sql.includes("status='failed'")&&String(x.params[1]).includes('CODING_RESTART_PR_CLOSED')));
    assert.ok(calls.some(x=>x.sql.includes("tigeriq_coding_objectives set status='blocked'")));
  });

  await t.test('restart recovery requeues an open PR with preserved resume identity',async()=>{
    const job={id:'job-open',objective_id:'obj-open',status:'review',pr_number:1200,branch:'tigeriq/nv12/job-open',created_at:'2026-09-19T00:00:00Z'};
    const calls=[];
    const db={async query(sql,params=[]){
      calls.push({sql,params});
      if(sql.startsWith('select * from tigeriq_coding_jobs'))return{rows:[job],rowCount:1};
      if(sql.startsWith("update tigeriq_coding_jobs set status='queued'"))return{rows:[],rowCount:1};
      return{rows:[],rowCount:1};
    }};
    const out=await recoverAfterCodingRestart({db,fetchPr:async number=>({number,state:'open',merged:false})});
    assert.deepStrictEqual(out,{requeued:1,completed:0,failed:0,deferred:0});
    assert.ok(calls.some(x=>x.sql.includes("status='queued'")));
    assert.ok(calls.some(x=>x.sql.includes("tigeriq_coding_objectives set status='active'")));
  });

  await t.test('closed unmerged PR reconciles immediately',()=>{
    assert.throws(()=>assertPrOpenState({number:7,state:'closed',merged:false}),e=>e.code==='PR_CLOSED_UNMERGED'&&e.detail.number===7);
    assert.strictEqual(assertPrOpenState({number:8,state:'open',merged:false}),true);
  });

  await t.test('retry classifier covers malformed JSON and transport failures',()=>{
    assert.strictEqual(isRetryableAiError(new Error('JSON_OBJECT_INVALID:unterminated string')),true);
    assert.strictEqual(isRetryableAiError(new Error('CODING_CHANGES_COUNT_INVALID')),true);
    assert.strictEqual(isRetryableAiError(new Error('CODING_COMPACT_EDIT_INVALID')),true);
    assert.strictEqual(isRetryableAiError(new Error('CODING_COMPACT_EDIT_OLD_NOT_FOUND')),true);
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

  await t.test('generation retry preserves full prompt tail instead of shrinking existing-file context',async()=>{
    const prompt='CURRENT FILES:\nFILE apps/large.mjs\n'+'A'.repeat(25000)+'\nTAIL_SENTINEL\nReturn ONLY JSON {"summary":"short","changes":[{"path":"exact allowed path","content":"complete replacement UTF-8 file content"}]}.';
    const calls=[];
    const invokeFn=async(_resource,nextPrompt)=>{
      calls.push(nextPrompt);
      if(calls.length===1)throw new Error('CODING_CHANGES_COUNT_INVALID');
      return '{"summary":"ok","changes":[{"path":"tests/new.test.mjs","content":"ok"}]}';
    };
    const validateData=data=>{if(!Array.isArray(data.changes)||data.changes.length<1)throw new Error('CODING_CHANGES_COUNT_INVALID')};
    await invokeJsonWithFailover(nv11,prompt,{resourcePool:[nv11],invokeFn,maxResources:1,validateData,shrinkPrompt:preserveGenerationPrompt});
    assert.strictEqual(calls.length,2);
    assert.strictEqual(calls[1],prompt);
    assert.ok(calls[1].includes('TAIL_SENTINEL'));
    assert.ok(calls[1].length>18000);
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
    assert.strictEqual(isResourceTransientError(new Error('EMPTY_RESPONSE')),false);
    assert.strictEqual(isResourceTransientError(new Error('NO_INDEPENDENT_REVIEWER_AVAILABLE')),true);
    assert.strictEqual(isResourceTransientError(new Error('POLICY_DENIED')),false);
    assert.strictEqual(isResourceTransientError(new Error('CODING_SCOPE_VIOLATION')),false);
  });

  await t.test('scope leases serialize overlapping mutations but allow independent files',()=>{
    assert.strictEqual(codingPathsOverlap(['apps/a.mjs'],['apps/a.mjs']),true);
    assert.strictEqual(codingPathsOverlap(['apps/core/'],['apps/core/a.mjs']),true);
    assert.strictEqual(codingPathsOverlap(['apps/a.mjs'],['apps/b.mjs']),false);
  });

  await t.test('temporary all-provider busy is a resource wait condition',()=>{
    const e=new Error('AI_RESOURCES_BUSY');e.code='AI_RESOURCES_BUSY';
    assert.strictEqual(isResourceTransientError(e),true);
  });

  await t.test('production runJob persists implementer before long generation',()=>{
    const src=require('node:fs').readFileSync(new URL('../apps/tigeriq-coding-lane/coding-lane.mjs',import.meta.url),'utf8');
    assert.ok(src.includes("set employee_id=$2,status='running'"));
    assert.ok(src.indexOf("set employee_id=$2,status='running'")<src.indexOf('generated=await generateChanges'));
  });

  await t.test('existing branch and PR are resumable identity',()=>{
    assert.strictEqual(shouldResumeExistingPr({branch:'tigeriq/nv12/job',pr_number:722}),true);
    assert.strictEqual(shouldResumeExistingPr({branch:'',pr_number:722}),false);
    assert.strictEqual(shouldResumeExistingPr({branch:'tigeriq/nv12/job',pr_number:null}),false);
  });
  await t.test('stale compact patch errors are refreshable on the same PR',()=>{
    assert.strictEqual(isRefreshableCompactPatchError(new Error('CODING_COMPACT_EDIT_OLD_NOT_FOUND')),true);
    assert.strictEqual(isRefreshableCompactPatchError(new Error('CODING_COMPACT_EDIT_OLD_NOT_UNIQUE')),true);
    assert.strictEqual(isRefreshableCompactPatchError(new Error('CODING_SCOPE_VIOLATION')),false);
  });

  await t.test('compact repair applies one exact unique snippet only',()=>{
    const path='apps/tigeriq-core/core.mjs';
    const edits=[{path,old:'JSON.stringify(stateData)',new:'stateData'}];
    assert.strictEqual(validateCompactEdits(edits,[path]),true);
    assert.strictEqual(applyCompactEdits('before JSON.stringify(stateData) after',edits),'before stateData after');
    assert.throws(()=>applyCompactEdits('JSON.stringify(stateData) + JSON.stringify(stateData)',edits),/CODING_COMPACT_EDIT_OLD_NOT_UNIQUE/);
  });

  await t.test('local generation context preserves the full existing file tail for safe compact expansion',()=>{
    const content='HEAD\n'+'.'.repeat(60000)+'\nTAIL';
    const context=buildLocalFileContext([{path:'apps/large.mjs',content}]);
    assert.ok(context.includes('FILE apps/large.mjs'));
    assert.ok(context.includes('TAIL'));
    assert.ok(context.length>60000);
  });

  await t.test('model path placeholder is retryable output-contract noise, not a real scope violation',()=>{
    const error=()=>validateCompactEdits([{path:'exact allowed path',old:'a',new:'b'}],['apps/tigeriq-core/core.mjs']);
    assert.throws(error,/CODING_COMPACT_EDIT_PATH_PLACEHOLDER/);
    assert.strictEqual(isRetryableAiError(new Error('CODING_COMPACT_EDIT_PATH_PLACEHOLDER')),true);
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
    assert.strictEqual(validateCompactEdits([{path,old:'alpha',new:'A'},{path:'tests/other.mjs',old:'beta',new:'B'}],[path,'tests/other.mjs']),true);
  });
  await t.test('gate evidence is concise and machine-usable',()=>{
    const issues=gateFailureIssues({message:'CI_GATES_FAILED',detail:{states:[{name:'CI Verify',status:'completed',conclusion:'failure'},{name:'Queue Hygiene Verify',status:'completed',conclusion:'success'}]}});
    assert.ok(Array.isArray(issues));
    assert.ok(issues.includes('CI Verify: failure (completed)'));
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
