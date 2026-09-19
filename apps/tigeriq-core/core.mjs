import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import { createGeminiRateController } from '../shared/gemini-rate-control.mjs';
import { runBoundedManagerDecision } from './manager-json.mjs';
import { appendSkillContextToPrompt, matchAndLoadSkills } from './skill-loader.mjs';
import { buildManagerHistoryContext } from './context-gateway.mjs';
import { buildFailureLearningCandidates, failureLearningEventTypes } from './failure-learning.mjs';
import { normalizeCampaignPhases, currentCampaignGoal, campaignTransition, makePhaseCheckpoint, campaignNeedsEvidence, campaignEvidenceJobId } from './campaign-runner.mjs';
import { normalizeTerminalWorkItems, handoffGenerationKey, evaluateChildObjectiveStates, isCodingHandoff } from './work-handoff.mjs';
import { ROUTING_PROFILE_LABELS, createResourceId, deriveRoutingProfile, failurePolicy, normalizeQuota, rankCandidates, rateLimitFailureState } from './smart-router.mjs';

const DATABASE_URL = process.env.DATABASE_URL?.trim();
if (!DATABASE_URL) throw new Error('DATABASE_URL_MISSING');
const HOST = process.env.TIGERIQ_CORE_HOST?.trim() || '127.0.0.1';
const PORT = Number(process.env.TIGERIQ_CORE_PORT || 8795);
const TOKEN = process.env.TIGERIQ_CORE_TOKEN?.trim() || '';
const POLL_MS = Number(process.env.TIGERIQ_CORE_POLL_MS || 1000);
const MANAGER_IDLE_MS = Number(process.env.TIGERIQ_MANAGER_IDLE_MS || 5000);
const FAILURE_LEARNING_INTERVAL_MS = Math.max(60000, Number(process.env.TIGERIQ_FAILURE_LEARNING_INTERVAL_MS || 600000));
const SURFSENSE_APP_URL = process.env.TIGERIQ_SURFSENSE_APP_URL?.trim() || 'http://127.0.0.1:3929';
const SURFSENSE_SEARCH_URL = process.env.TIGERIQ_SURFSENSE_SEARCH_URL?.trim() || 'http://127.0.0.1:3930/search';
const SURFSENSE_SUMMARY_MODEL = process.env.TIGERIQ_SURFSENSE_SUMMARY_MODEL?.trim() || 'gemma3:4b';
const OLLAMA_EMPLOYEE_ID = 'NV10';
const GEMINI_MIN_INTERVAL_MS = Math.max(4500, Number(process.env.TIGERIQ_GEMINI_MIN_INTERVAL_MS || 4500));
const GEMINI_BACKOFF_BASE_MS = Math.max(4500, Number(process.env.TIGERIQ_GEMINI_BACKOFF_BASE_MS || 4500));
const GEMINI_MAX_ATTEMPTS = Math.max(1, Number(process.env.TIGERIQ_GEMINI_MAX_ATTEMPTS || 4));
const OLLAMA_TIMEOUT_MS = Math.max(30000, Number(process.env.TIGERIQ_OLLAMA_TIMEOUT_MS || 30000));
const NV14_FALLBACK_MODEL = process.env.TIGERIQ_NV14_FALLBACK_MODEL?.trim() || 'gemini-3.1-flash-lite';
const NV16_FAILURE_THRESHOLD = Math.min(1, Math.max(0, Number(process.env.TIGERIQ_NV16_FAILURE_THRESHOLD || 0.5)));
const NV16_FAILURE_WINDOW = Math.max(10, Number(process.env.TIGERIQ_NV16_FAILURE_WINDOW || 20));
const geminiRateController = createGeminiRateController({minIntervalMs:GEMINI_MIN_INTERVAL_MS,backoffBaseMs:GEMINI_BACKOFF_BASE_MS,maxAttempts:GEMINI_MAX_ATTEMPTS});
const pool = new Pool({ connectionString: DATABASE_URL, max: 4 });
pool.on('error', (err) => console.error(JSON.stringify({event:'PG_POOL_ERROR',error:String(err?.message||err)})));

const R = (id, name, provider, model, req = [], rank = 50) => ({
  id, employeeId:id, resourceId:createResourceId(provider,model,'default','core'), name, provider, model, req, rank,
  accountBinding:'default', runtimeBinding:'core', costTier:provider==='ollama'?'LOCAL':'FREE', zeroOutOfPocket:true,
  capabilities: ['general', 'reasoning', 'review'],
});
const resources = [
  R(OLLAMA_EMPLOYEE_ID,'Ollama','ollama',process.env.TIGERIQ_OLLAMA_MODEL || 'qwen3:4b',[],90),
  R('NV11','Groq','groq',process.env.TIGERIQ_GROQ_MODEL || 'openai/gpt-oss-120b',[['GROQ_API_KEY'],['TIGERIQ_GROQ_FREE_TIER_VERIFIED','true']],10),
  R('NV12','Gemini','gemini',process.env.TIGERIQ_GEMINI_MODEL || 'gemini-3.5-flash-lite',[['GEMINI_API_KEY'],['TIGERIQ_GEMINI_FREE_TIER_VERIFIED','true']],20),
  R('NV13','OpenRouter','openrouter','openrouter/free',[['OPENROUTER_API_KEY']],30),
  R('NV14','Mistral','mistral','mistral-small-latest',[['MISTRAL_API_KEY']],35),
  R('NV15','Cloudflare','cloudflare','@cf/meta/llama-3.1-8b-instruct',[['CLOUDFLARE_ACCOUNT_ID'],['CLOUDFLARE_AUTH_TOKEN']],40),  R('NV16','HuggingFace','huggingface','openai/gpt-oss-120b:fastest',[['HF_TOKEN']],45),
  R('NV17','Inception','inception',process.env.TIGERIQ_INCEPTION_MODEL || 'mercury-2.5',[['INCEPTION_API_KEY'],['TIGERIQ_INCEPTION_FREE_TIER_VERIFIED','true']],50),
  R('NV18','Watsonx','watsonx',process.env.WATSONX_MODEL_ID || 'configured-model',[['WATSONX_API_KEY'],['WATSONX_PROJECT_ID'],['WATSONX_MODEL_ID'],['TIGERIQ_WATSONX_LITE_CONFIRMED','true']],55),
  R('NV19','Cohere','cohere','command-a-plus-05-2026',[['COHERE_API_KEY'],['TIGERIQ_COHERE_TRIAL_CONFIRMED','true']],60),
  R('NV20','NVIDIA','nvidia','nvidia/nemotron-3-super-120b-a12b',[['NVIDIA_API_KEY'],['TIGERIQ_NVIDIA_FREE_DEV_CONFIRMED','true']],65),
];
const nowIso = () => new Date().toISOString();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const credentialEnvByProvider = { groq:['GROQ_API_KEY'], gemini:['GEMINI_API_KEY'], openrouter:['OPENROUTER_API_KEY'], mistral:['MISTRAL_API_KEY'], cloudflare:['CLOUDFLARE_AUTH_TOKEN'], huggingface:['HF_TOKEN'], inception:['INCEPTION_API_KEY'], watsonx:['WATSONX_API_KEY'], cohere:['COHERE_API_KEY'], nvidia:['NVIDIA_API_KEY'] };
const credentialPresent = (r) => r.provider === 'ollama' || (credentialEnvByProvider[r.provider] || []).every(k => process.env[k]);
const reqReady = (r) => r.req.every(([k,v]) => process.env[k] && (v === undefined || process.env[k] === v));

function classifyHttp(status) {
  if (status === 429) return 'rate_limit';
  if (status === 402) return 'configuration';
  if (status === 401 || status === 403) return 'auth';
  if (status === 408 || status === 504) return 'timeout';
  if (status >= 500) return 'outage';
  return 'invalid_response';
}

const CANONICAL_LIFECYCLE = ['QUEUED', 'CLAIMED', 'WORKING', 'EVIDENCE', 'VERIFY', 'DONE', 'BLOCKED'];

function mapWorkItemProjection(payload) {
  const { workItemId, sourceRef, issueRef, kind, state, priority, assignedExecutor, scopeLease, blockers, evidenceRefs, nextAction } = payload;
  let stage = 'QUEUED';
  if (state === 'claimed') stage = 'CLAIMED';
  if (state === 'working') stage = 'WORKING';
  if (state === 'evidence') stage = 'EVIDENCE';
  if (state === 'verify') stage = 'VERIFY';
  if (state === 'done') stage = 'DONE';
  if (state === 'blocked') stage = 'BLOCKED';

  return {
    workItemId: workItemId || randomUUID(),
    sourceRef: sourceRef || issueRef,
    kind,
    assignedExecutor,
    stage,
    priority,
    scopeLease,
    blockers,
    evidenceRefs,
    nextAction
  };
}

export { CANONICAL_LIFECYCLE, mapWorkItemProjection };

async function fetchJson(url, init = {}, timeoutMs = 90000, onResponse = null) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: c.signal });
    if(onResponse)await onResponse(res);
    const text = await res.text();
    let body; try { body = text ? JSON.parse(text) : {}; } catch { body = { text }; }
    if (!res.ok) { const e = new Error(`HTTP_${res.status}`); e.kind = classifyHttp(res.status); e.status=res.status; e.body=body; throw e; }
    return body;
  } catch (e) { if (e.name === 'AbortError') { e.kind = 'timeout'; } throw e; }
  finally { clearTimeout(t); }
}
function quotaHeaderNumber(headers,name){const value=headers?.get?.(name);if(value===null||value===undefined||String(value).trim()==='')return null;const n=Number(value);return Number.isFinite(n)?Math.max(0,n):null;}
function quotaResetDurationMs(value){
  const text=String(value||'').trim();if(!text)return null;
  const parts=[...text.matchAll(/(\d+(?:\.\d+)?)(ms|s|m|h)/gi)];if(!parts.length||parts.map(x=>x[0]).join('').toLowerCase()!==text.toLowerCase())return null;
  const mult={ms:1,s:1000,m:60000,h:3600000};const total=parts.reduce((sum,x)=>sum+Number(x[1])*mult[x[2].toLowerCase()],0);return Number.isFinite(total)?Math.max(0,total):null;
}
function quotaResetAt(headers){
  const retry=headers?.get?.('retry-after');
  if(retry){const seconds=Number(retry);if(Number.isFinite(seconds))return new Date(Date.now()+seconds*1000);}
  const retryat=headers?.get?.('x-ratelimit-reset');
  if(retryat){const s=Number(retryat);if(Number.isFinite(s))return new Date(s*1000);}
  return null;
}
function transientError(e,b){const t='TRANSIENT';const s=String(e?.stack||'').toLowerCase();const m=String(e?.message||'').toLowerCase();const n=e?.name;const c=e?.code;
  const transient=c===t||n===t||m.includes(t.toLowerCase())||s.includes(t.toLowerCase())||m.includes('failed')||m.includes('fail');
  const transient2=m.includes('retry')||m.includes('timeout')||m.includes('connection')||m.includes('reset')||m.includes('closed')||m.includes('refused');
  const transient3=e.status>=500||e.status===408||e.status===429||e.status===425||e.status===413||m.includes('capacity')||m.includes('overloaded');
  return transient||transient2||transient3;
}
async function rateLimitRetry(p,fn,timeoutMs,delayMs=3000,maxRetryCount=5000) {
  const startedAt=Date.now();
  while(true){
    try{ return await fn();} catch(e){
      if(transientError(e,true)&&Date.now()-startedAt<timeoutMs&&maxRetryCount>0){
        if(Date.now()-startedAt<delayMs&&maxRetryCount>0)await sleep(Math.max(100,delayMs/2));
        maxRetryCount--;
      } else throw e;
    }
  }
}
const runGateWithRepair=async({waitFn,repairFn,onWaiting,maxRepairCycles=3,timeoutRetries=1})=>{
  let repairCycle=0;
  while(repairCycle<=maxRepairCycles){
    try{return await waitFn();} catch(e){
      if(e.code==='CI_GATES_TIMEOUT'&&e.detail?.timeoutRetries>0){
        e.detail.timeoutRetries--;
        e=await waitFn();
        if(e?.state==='passed')return e;
      }
      if(repairFn&&e.code==='CI_GATES_FAILED'){await repairFn({repairCycle,evidence:gateFailureIssues(e)});repairCycle++;continue;}
      throw e;
    }
  }
  throw new Error('CI_GATE_REPAIR_EXHAUSTED');
};
const resourceWaitPlan=({retryCount,startedAt,nowMs})=>{
  if(retryCount>6)return{wait:false};
  if(nowMs-Date.parse(startedAt)<30000)return{wait:true,retryCount:retryCount+1,delayMs:30000};
  return{wait:true,retryCount:retryCount+1,delayMs:60000};
};
const gateFailureIssues=({message,detail})=>{
  if(message==='CI_GATES_FAILED'&&detail?.states)return detail.states.map(s=>`${s.name}: ${s.conclusion||s.status} (${s.status})`).join('; ');
  return message;
};
const assertPrOpenState=({number,state,merged})=>{if(state==='closed'||state==='closed')throw{code:'PR_CLOSED_UNMERGED',number};if(!merged)throw{code:'PR_MERGED',number};return true};
const shouldResumeExistingPr=({branch,pr_number})=>branch&&pr_number;
const isResourceTransientError=error=>{
  const m=String(error.message||'').toLowerCase();
  return m.includes('rate')||m.includes('capacity')||m.includes('retry')||m.includes('busy');
};
const isRetryableAiError=error=>{
  const m=String(error.message||'');
  return m.includes('JSON')||m.includes('CODING')||m.includes('HTTP_4')||m.includes('connection')||m.includes('timeout');
};
const classifyAiFailure=error=>{
  const c=error.code||'UNKNOWN';
  if(c==='rate_limit')return c;
  if(c==='JSON_OBJECT_INVALID')return c;
  return 'invalid_response';
};
const invokeJsonWithFailover=async(res,body,{resourcePool,invokeFn,maxResources,exclude})=>{
  const pool=resourcePool.filter(r=>!exclude?.includes(r.id));
  const c=pool.slice(0,maxResources);
  for(const r of c){
    try{return await invokeFn(r);}catch(e){
      const transient=transientError(e,true)&&isResourceTransientError(e);
      if(!transient)throw e;
    }
  }
  throw new Error('AI_RESOURCES_UNAVAILABLE');
};
async function fetchUrl(url){return fetch(url).then(r=>r.json());}
function buildContext(context){return context?.history||'';}
const runBoundedManagerDecision=async({prompt,historyContext,maxTokens})=>{
  const p=buildContext(historyContext)+prompt;
  if(p.length>maxTokens)return p.slice(0,maxTokens);
  return p;
};

const test=globalThis.test;const assert=globalThis.assert;

test('WorkItem projection maps states to canonical lifecycle',async()=>{    const base={kind:'objective',priority:1};
  const queued=mapWorkItemProjection({...base,state:'queued'});
  assert.strictEqual(queued.stage,'QUEUED');
  assert.ok(queued.workItemId);

  const claimed=mapWorkItemProjection({...base,state:'claimed',assignedExecutor:'NV17'});
  assert.strictEqual(claimed.stage,'CLAIMED');
  assert.strictEqual(claimed.assignedExecutor,'NV17');

  const evidence=mapWorkItemProjection({...base,state:'evidence',evidenceRefs:['file:1','file:2']});
  assert.strictEqual(evidence.stage,'EVIDENCE');
  assert.strictEqual(evidence.evidenceRefs.length,2);
});

test('WorkItem projection defaults workItemId if missing',()=>{
  const out=mapWorkItemProjection({kind:'job',state:'queued'});
  assert.ok(out.workItemId);
});

test('SourceRef prioritizes sourceRef over issueRef',()=>{
  const out=mapWorkItemProjection({sourceRef:'github:123',issueRef:'jira:456'});
  assert.strictEqual(out.sourceRef,'github:123');
});

test('WorkItem projection exposes all required view fields',()=>{
  const payload={kind:'objective',state:'working',priority:1,assignedExecutor:'NV17',blockers:['blocked:block1'],nextAction:'fix'};
  const out=mapWorkItemProjection(payload);
  for(const k of['workItemId','sourceRef','kind','assignedExecutor','stage','priority','scopeLease','blockers','evidenceRefs','nextAction']){
    assert.ok(Object.prototype.hasOwnProperty.call(out,k));
  }
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
