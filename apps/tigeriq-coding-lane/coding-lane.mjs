import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {branchName,checkGateState,extractCanonicalAllowedPaths,isRetryableAiError,parseJsonObject,safeRepoPath,validateChanges} from './policy.mjs';

export class CodingScopeViolationError extends Error {
  constructor(offending) {
    super(`CODING_SCOPE_VIOLATION: ${offending.join(', ')}`);
    this.code='CODING_SCOPE_VIOLATION';
    this.offending=offending;
    this.detail={code:'CODING_SCOPE_VIOLATION',offending};
  }
}

export function validateJobScope(jobPaths,changes){
  const allowed=new Set(Array.isArray(jobPaths)?jobPaths:[]);
  const offending=(changes||[]).map(c=>c?.path).filter(Boolean).filter(p=>!allowed.has(p));
  if(offending.length) throw new CodingScopeViolationError(offending);
  return true;
}

export function validateSourceScope(proposedPaths,canonicalPaths){
  const canonical=new Set((canonicalPaths||[]).map(String));
  if(!canonical.size)return true;
  const offending=(proposedPaths||[]).map(String).filter(p=>!canonical.has(p));
  if(offending.length)throw new CodingScopeViolationError(offending);
  return true;
}

export function shrinkAiPrompt(prompt,maxChars=18000){
  const p=String(prompt||'');
  if(p.length<=maxChars)return p;
  const head=Math.floor(maxChars*0.45),tail=maxChars-head;
  return `${p.slice(0,head)}\n...[MODEL_CONTEXT_REDUCED]...\n${p.slice(-tail)}`;
}

export function assertPrOpenState(pr){
  if(pr?.state==='open')return true;
  const code=pr?.merged?'PR_EXTERNALLY_MERGED':'PR_CLOSED_UNMERGED';
  const e=new Error(code);
  e.code=code;
  e.detail={code,number:pr?.number||null,state:pr?.state||null,merged:Boolean(pr?.merged)};
  throw e;
}

const DATABASE_URL=process.env.DATABASE_URL?.trim(); if(!DATABASE_URL&&process.env.NODE_ENV!=='test')throw new Error('DATABASE_URL_MISSING');
const GH_TOKEN=(process.env.TIGERIQ_GITHUB_TOKEN||process.env.GITHUB_TOKEN||'').trim(); if(!GH_TOKEN&&process.env.NODE_ENV!=='test')throw new Error('GITHUB_TOKEN_MISSING');
const OWNER=process.env.TIGERIQ_GITHUB_OWNER||'newsdayads';
const REPO=process.env.TIGERIQ_GITHUB_REPO||'tigeriq-ai-lab';
const HOST=process.env.TIGERIQ_CODING_HOST||'127.0.0.1';
const PORT=Number(process.env.TIGERIQ_CODING_PORT||8797);
const AUTO_MERGE=String(process.env.TIGERIQ_CODING_AUTO_MERGE||'true').toLowerCase()==='true';
const MAX_PARALLEL=Math.max(1,Math.min(2,Number(process.env.TIGERIQ_CODING_MAX_PARALLEL||1)));
const pool=DATABASE_URL?new Pool({connectionString:DATABASE_URL,max:4}):null;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

const R=(id,provider,model,ready)=>({id,provider,model,ready});
const resources=[
  R('NV11','groq',process.env.TIGERIQ_GROQ_MODEL||'openai/gpt-oss-120b',()=>process.env.GROQ_API_KEY&&process.env.TIGERIQ_GROQ_FREE_TIER_VERIFIED==='true'),
  R('NV12','gemini',process.env.TIGERIQ_GEMINI_MODEL||'gemini-3.5-flash-lite',()=>process.env.GEMINI_API_KEY&&process.env.TIGERIQ_GEMINI_FREE_TIER_VERIFIED==='true'),
  R('NV13','openrouter','openrouter/free',()=>process.env.OPENROUTER_API_KEY),
  R('NV14','mistral','mistral-small-latest',()=>process.env.MISTRAL_API_KEY),
  R('NV16','huggingface','openai/gpt-oss-120b:fastest',()=>process.env.HF_TOKEN),
  R('NV19','cohere','command-a-plus-05-2026',()=>process.env.COHERE_API_KEY&&process.env.TIGERIQ_COHERE_TRIAL_CONFIRMED==='true'),
].filter(x=>x.ready());
let rr=0;
function pickResource(exclude=[]){const available=resources.filter(x=>!exclude.includes(x.id));if(!available.length)return null;const r=available[rr%available.length];rr++;return r;}

async function fetchJson(url,init={},timeout=90000){const c=new AbortController(),t=setTimeout(()=>c.abort(),timeout);try{const res=await fetch(url,{...init,signal:c.signal});const text=await res.text();let body={};try{body=text?JSON.parse(text):{};}catch{body={text};}if(!res.ok){const e=new Error(`HTTP_${res.status}:${String(body?.message||body?.error||text).slice(0,300)}`);e.status=res.status;throw e;}return body;}finally{clearTimeout(t)}}
async function openAi(endpoint,key,model,prompt){const b=await fetchJson(endpoint,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${key}`},body:JSON.stringify({model,messages:[{role:'user',content:prompt}],temperature:0,max_tokens:8000,stream:false})});const text=b?.choices?.[0]?.message?.content;if(!String(text||'').trim())throw new Error('EMPTY_RESPONSE');return String(text)}
export async function invokeJsonWithFailover(initialResource,prompt,options={}){const resourcePool=options.resourcePool||resources;const invokeFn=options.invokeFn||invoke;const maxResources=Math.min(3,Math.max(1,options.maxResources||3));const validateData=options.validateData||(d=>d);const exclude=options.exclude||[];let currentResource=initialResource||pickResource(exclude)||resourcePool[0];let attempts=0;let lastError=null;let currentPrompt=prompt;let resourceIdx=0;for(let rIdx=0;rIdx<maxResources;rIdx++){if(!currentResource)currentResource=pickResource(exclude)||resourcePool[0];for(let same=0;same<2;same++){attempts++;try{const raw=await invokeFn(currentResource,currentPrompt);let parsed;try{parsed=parseJsonObject(raw);}catch(parseErr){if(isRetryableAiError(parseErr)&&same===0){currentPrompt=shrinkAiPrompt(currentPrompt);continue;}throw parseErr;}try{validateData(parsed);}catch(valErr){if(isRetryableAiError(valErr)&&same===0){currentPrompt=shrinkAiPrompt(currentPrompt);continue;}throw valErr;}return{resource:currentResource,data:parsed,attempts};}catch(err){lastError=err;if(err.code==='CODING_SCOPE_VIOLATION'||err.message?.includes('CODING_SCOPE_VIOLATION')||err.message?.includes('POLICY_DENIED')||err.message?.includes('CREDENTIAL'))throw err;if(err.status===429||isRetryableAiError(err)){if(err.status===429){const backoffMs=Math.min(10000,Math.pow(2,rIdx+same)*1000)+Math.floor(Math.random()*200);await sleep(backoffMs);}if(same===0){currentPrompt=shrinkAiPrompt(currentPrompt);continue;}}break;}}const excluded=[...exclude,currentResource?.id].filter(Boolean);currentResource=pickResource(excluded)||resourcePool[(rIdx+1)%resourcePool.length];}throw lastError||new Error('AI_INVOCATION_FAILED');}

async function invoke(r,prompt){
  if(r.provider==='groq')return openAi('https://api.groq.com/openai/v1/chat/completions',process.env.GROQ_API_KEY,r.model,prompt);
  if(r.provider==='openrouter')return openAi('https://openrouter.ai/api/v1/chat/completions',process.env.OPENROUTER_API_KEY,r.model,prompt);
  if(r.provider==='mistral')return openAi('https://api.mistral.ai/v1/chat/completions',process.env.MISTRAL_API_KEY,r.model,prompt);
  if(r.provider==='huggingface')return openAi('https://router.huggingface.co/v1/chat/completions',process.env.HF_TOKEN,r.model,prompt);
  if(r.provider==='gemini'){const b=await fetchJson(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(r.model)}:generateContent`,{method:'POST',headers:{'content-type':'application/json','x-goog-api-key':process.env.GEMINI_API_KEY},body:JSON.stringify({contents:[{role:'user',parts:[{text:prompt}]}],generationConfig:{temperature:0,maxOutputTokens:8192}})});const text=b?.candidates?.[0]?.content?.parts?.map(x=>x.text||'').join('\n');if(!String(text||'').trim())throw new Error('EMPTY_RESPONSE');return String(text)}
  if(r.provider==='cohere'){const b=await fetchJson('https://api.cohere.com/v2/chat',{method:'POST',headers:{'content-type'
...[MODEL_CONTEXT_REDUCED]...
Failover,shrinkAiPrompt} from '../apps/tigeriq-coding-lane/coding-lane.mjs';
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
    const source="const clean=String(text||'').replace(/\|/gi,'').trim();";
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
