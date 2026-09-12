import test from 'node:test';
import assert from 'node:assert';
import {assertPrOpenState,invokeJsonWithFailover,shrinkAiPrompt} from '../apps/tigeriq-coding-lane/coding-lane.mjs';
import {isRetryableAiError} from '../apps/tigeriq-coding-lane/policy.mjs';

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
    const e=new Error('rate');e.status=429;
    assert.strictEqual(isRetryableAiError(e),true);
    assert.strictEqual(isRetryableAiError(new Error('POLICY_DENIED')),false);
  });

  await t.test('prompt shrink is deterministic and bounded',()=>{
    const p='A'.repeat(50000)+'TAIL';
    const out=shrinkAiPrompt(p,18000);
    assert.ok(out.length<19000);
    assert.ok(out.includes('MODEL_CONTEXT_REDUCED'));
    assert.ok(out.endsWith('TAIL'));
  });
});
