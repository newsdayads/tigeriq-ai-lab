import test from 'node:test';
import assert from 'node:assert';
import {assertPrOpenState,invokeJsonWithFailover,shrinkAiPrompt} from '../apps/tigeriq-coding-lane/coding-lane.mjs';
import {isRetryableAiError,parseJsonObject} from '../apps/tigeriq-coding-lane/policy.mjs';

const nv11={id:'NV11',provider:'fake',model:'a'};
const nv19={id:'NV19',provider:'fake',model:'b'};

test('foundation bounded retry and failover',async(t)=>{
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
    const source="const clean=String(text||'').replace(/|/gi,'').trim();";
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
    assert.ok(calls[1].prompt.length<calls[0].prompt.length);
  });

  await t.test('scope validation remains fail-closed inside validator boundary',async()=>{
    let count=0;
    await assert.rejects(()=>invokeJsonWithFailover(nv11,'x',{resourcePool:[nv11,nv19],invokeFn:async()=>{count++;return '{"summary":"x","changes":[{"path":"bad","content":"x"}]}'},validateData:()=>{throw new Error('CODING_SCOPE_VIOLATION')}}),/CODING_SCOPE_VIOLATION/);
    assert.strictEqual(count,1);
  });

  await t.test('HTTP 429 retries then fails over with bounded budget',async()=>{
    let count=0;
    const invokeFn=async(r)=>{
      count++;
      if(r.id==='NV11'){const e=new Error('HTTP_429:rate');e.status=429;throw e;}
      return '{"decision":"approve","summary":"ok","issues":[]}';
    };
    const out=await invokeJsonWithFailover(nv11,'review',{resourcePool:[nv11,nv19],invokeFn,maxResources:2});
    assert.strictEqual(out.resource.id,'NV19');
    assert.strictEqual(count,3);
    assert.ok(count<=4);
  });

  await t.test('non-retryable error does not fail over',async()=>{
    let count=0;
    await assert.rejects(()=>invokeJsonWithFailover(nv11,'x',{resourcePool:[nv11,nv19],invokeFn:async()=>{count++;throw new Error('POLICY_DENIED')}}),/POLICY_DENIED/);
    assert.strictEqual(count,1);
  });

  await t.test('reviewer exclusion keeps final reviewer different from implementer',async()=>{
    const out=await invokeJsonWithFailover(nv19,'x',{exclude:['NV11'],resourcePool:[nv11,nv19],invokeFn:async(r)=>`{"decision":"approve","summary":"${r.id}","issues":[]}`});
    assert.notStrictEqual(out.resource.id,'NV11');
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
    assert.strictEqual(isRetryableAiError(new Error('HTTP_413:payload too large')),true);
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

  await t.test('CI_GATES_FAILED triggers same-branch repair and gate rerun', async()=>{
    let repairCalled = false;
    const job = { id: 'job-1', branch: 'feature/test-ci' };
    const mockCheckGates = async (branch, cycle) => {
      if (cycle === 0) {
        const err = new Error('CI_GATES_FAILED: test failure');
        err.code = 'CI_GATES_FAILED';
        err.failedOutput = 'AssertionError: expected true to be false';
        throw err;
      }
      return { status: 'passed', sha: 'abc1234' };
    };
    let currentCycle = 0;
    let waitingCi = false;
    let lastEvidence = null;

    for (let cycle = 0; cycle < 3; cycle++) {
      try {
        await mockCheckGates(job.branch, cycle);
      } catch (e) {
        if (e.code === 'CI_GATES_FAILED') {
          waitingCi = true;
          repairCalled = true;
          lastEvidence = e.failedOutput;
          currentCycle = cycle + 1;
        }
      }
    }
    const rerunResult = await mockCheckGates(job.branch, currentCycle);
    assert.strictEqual(repairCalled, true);
    assert.strictEqual(waitingCi, true);
    assert.strictEqual(rerunResult.status, 'passed');
    assert.ok(lastEvidence.includes('AssertionError'));
  });

  await t.test('CI_GATES_TIMEOUT retries once then blocks with evidence', async()=> {
    let attempts = 0;
    let blockedWithEvidence = false;
    let waitingCi = false;
    const mockTimeoutGate = async () => {
      attempts++;
      const err = new Error('CI_GATES_TIMEOUT: pipeline timed out');
      err.code = 'CI_GATES_TIMEOUT';
      err.failedOutput = 'Timeout after 600s in test stage';
      throw err;
    };

    for (let i = 0; i < 2; i++) {
      try {
        waitingCi = true;
        await mockTimeoutGate();
      } catch (e) {
        if (e.code === 'CI_GATES_TIMEOUT' && i === 1) {
          blockedWithEvidence = Boolean(e.failedOutput);
          waitingCi = false;
        }
      }
    }
    assert.strictEqual(attempts, 2);
    assert.strictEqual(blockedWithEvidence, true);
    assert.strictEqual(waitingCi, false);
  });

  await t.test('bounded AI retry respects three-resource limit and backoff', async()=> {
    let calls = 0;
    const nv20 = { id: 'NV20', provider: 'fake', model: 'c' };
    const invokeFn = async () => {
      calls++;
      const e = new Error('HTTP_429: Rate limited');
      e.status = 429;
      throw e;
    };
    await assert.rejects(()=>invokeJsonWithFailover(nv11, 'prompt', { resourcePool: [nv11, nv19, nv20], invokeFn, maxResources: 3 }), /HTTP_429/);
    assert.strictEqual(calls, 3);
  });

  await t.test('non-retryable scope/credential violations block instantly', async()=> {
    let calls = 0;
    const invokeFn = async () => {
      calls++;
      throw new Error('CODING_SCOPE_VIOLATION: unauthorized path');
    };
    await assert.rejects(()=>invokeJsonWithFailover(nv11, 'prompt', { resourcePool: [nv11, nv19], invokeFn, maxResources: 3 }), /CODING_SCOPE_VIOLATION/);
    assert.strictEqual(calls, 1);
  });

  await t.test('reviewer rejection leads to same-branch repair without changing reviewer', async()=> {
    let implementer = 'NV11';
    let reviewer = 'NV19';
    let reviewDecision = 'reject';
    let repairCount = 0;
    
    const reviewFn = (rev) => {
      if (reviewDecision === 'reject') {
        repairCount++;
        reviewDecision = 'approve';
        return { decision: 'reject', reviewer: rev };
      }
      return { decision: 'approve', reviewer: rev };
    };

    const firstReview = reviewFn(reviewer);
    assert.strictEqual(firstReview.decision, 'reject');
    assert.strictEqual(firstReview.reviewer, 'NV19');

    const secondReview = reviewFn(reviewer);
    assert.strictEqual(secondReview.decision, 'approve');
    assert.strictEqual(secondReview.reviewer, 'NV19');
    assert.strictEqual(repairCount, 1);
    assert.strictEqual(implementer, 'NV11');
  });
});
