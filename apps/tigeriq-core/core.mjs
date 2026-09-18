import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import { createGeminiRateController } from '../shared/gemini-rate-control.mjs';
import { generateChildKey } from './work-handoff.mjs';
import { runBoundedManagerDecision } from './manager-json.mjs';
import { normalizeCampaignPhases, currentCampaignGoal, campaignTransition, makePhaseCheckpoint, campaignNeedsEvidence, campaignEvidenceJobId } from './campaign-runner.mjs';
import { ROUTING_PROFILE_LABELS, createResourceId, deriveRoutingProfile, failurePolicy, normalizeQuota, rankCandidates, rateLimitFailureState } from './smart-router.mjs';

const DATABASE_URL = process.env.DATABASE_URL?.trim();
if (!DATABASE_URL) throw new Error('DATABASE_URL_MISSING');
const HOST = process.env.TIGERIQ_CORE_HOST?.trim() || '127.0.0.1';
const PORT = Number(process.env.TIGERIQ_CORE_PORT || 8795);
const TOKEN = process.env.TIGERIQ_CORE_TOKEN?.trim() || '';
const POLL_MS = Number(process.env.TIGERIQ_CORE_POLL_MS || 1000);
const MANAGER_IDLE_MS = Number(process.env.TIGERIQ_MANAGER_IDLE_MS || 5000);
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
  R('NV17','Vercel','vercel','openai/gpt-5.4-mini',[['AI_GATEWAY_API_KEY'],['TIGERIQ_VERCEL_FREE_CREDIT_CONFIRMED','true']],50),
  R('NV18','Watsonx','watsonx',process.env.WATSONX_MODEL_ID || 'configured-model',[['WATSONX_API_KEY'],['WATSONX_PROJECT_ID'],['WATSONX_MODEL_ID'],['TIGERIQ_WATSONX_LITE_CONFIRMED','true']],55),
  R('NV19','Cohere','cohere','command-a-plus-05-2026',[['COHERE_API_KEY'],['TIGERIQ_COHERE_TRIAL_CONFIRMED','true']],60),
  R('NV20','NVIDIA','nvidia','nvidia/nemotron-3-super-120b-a12b',[['NVIDIA_API_KEY'],['TIGERIQ_NVIDIA_FREE_DEV_CONFIRMED','true']],65),
];
const nowIso = () => new Date().toISOString();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const credentialEnvByProvider = { groq:['GROQ_API_KEY'], gemini:['GEMINI_API_KEY'], openrouter:['OPENROUTER_API_KEY'], mistral:['MISTRAL_API_KEY'], cloudflare:['CLOUDFLARE_AUTH_TOKEN'], huggingface:['HF_TOKEN'], vercel:['AI_GATEWAY_API_KEY'], watsonx:['WATSONX_API_KEY'], cohere:['COHERE_API_KEY'], nvidia:['NVIDIA_API_KEY'] };
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
  if(retry){
    const seconds=Number(retry);
    if(Number.isFinite(seconds)) return new Date(Date.now()+Math.max(0,seconds)*1000).toISOString();
    const parsed=Date.parse(retry);
    if(Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  for(const key of ['x-ratelimit-reset-requests','x-ratelimit-reset-tokens','x-ratelimit-reset']){
    const value=headers?.get?.(key);
    if(!value) continue;
    const durationMs=quotaResetDurationMs(value);
    if(durationMs!==null) return new Date(Date.now()+durationMs).toISOString();
    const numeric=Number(value);
    if(Number.isFinite(numeric)){
      const when=numeric>1e12?numeric:(numeric>1e9?numeric*1000:Date.now()+Math.max(0,numeric));
      return new Date(when).toISOString();
    }
  }
  return null;
}
...[MODEL_CONTEXT_REDUCED]...
ion({prompt,maxProviders:3,acquire:async excluded=>{const excludedResources=excluded.map(id=>resources.find(x=>x.id===id)?.resourceId||id),row=await claimResource('reasoning',jobId,excludedResources,{profile:'AUTO',taskKind:'manager'});if(!row)return null;return resources.find(x=>x.resourceId===row.resource_id)||null;},invoke:async(r,nextPrompt)=>{starts.set(r.id,Date.now());return invokeProvider(r,nextPrompt);},onRetry:async(r,error)=>event('MANAGER_OUTPUT_RETRY',{objectiveId,jobId,employeeId:r.id,resourceId:r.resourceId,provider:r.provider,taskKind:'manager',kind:error?.code||error?.message||'invalid_response'}),onSuccess:async r=>markResourceSuccess(r,jobId,Math.max(0,Date.now()-(starts.get(r.id)||Date.now())),'RESOURCE_SUCCESS',true,{taskKind:'manager',profile:'AUTO'}),onFailure:async(r,error)=>markResourceFailure(r,jobId,error,'RESOURCE_FAILURE',true,{taskKind:'manager',profile:'AUTO'})});
}
async function managerTick() {
  const q=await pool.query(`select o.* from tigeriq_objectives o where o.status='active' and o.next_check_at<=now()
    and not exists(select 1 from tigeriq_jobs j where j.objective_id=o.id and j.status in ('queued','running'))
    order by case o.priority when 'P0' then 0 when 'P1' then 1 else 2 end,o.created_at limit 1`);
  const o=q.rows[0]; if(!o) return;
  const campaign=o.metadata?.campaign||null;
  const phases=Array.isArray(campaign?.phases)?campaign.phases:[];
  const currentPhase=Math.min(Math.max(Number(campaign?.currentPhase)||0,0),Math.max(0,phases.length-1));
  if(o.manager_cycles>=30){await pool.query("update tigeriq_objectives set status='blocked',summary='manager cycle safety limit reached',updated_at=now() where id=$1",[o.id]);await event('OBJECTIVE_BLOCKED',{objectiveId:o.id,phaseIndex:currentPhase,reason:'manager_cycle_limit'});return;}
  const history=(await pool.query("select title,status,provider,result,failure from tigeriq_jobs where objective_id=$1 and phase_index=$2 order by created_at desc limit 8",[o.id,currentPhase])).rows;
  const goal=currentCampaignGoal(o.objective,phases,currentPhase);
  const prompt=`You are TigerIQ AI Manager. Goal: ${goal}\nRecent work for this phase: ${JSON.stringify(history).slice(0,10000)}\nDecide the next useful work. Return ONLY JSON: {"status":"continue|complete|blocked","summary":"short","jobs":[{"title":"short","prompt":"standalone task instruction","capability":"general|reasoning|review"}]}. Maximum 3 jobs. Prefer independent useful work. Repository implementation/coding is GitHub-only; never create coding jobs for PC01 Core. Never request paid services, Production/Main release, credential/security changes, destructive actions or reboot. For a campaign, status=complete means the CURRENT PHASE acceptance is achieved; Core will automatically advance to the next phase. Do not wait for Owner/chat between phases.`;
  try {
    const routed=await callManagerDecision(prompt,o.id); const decision=routed.decision;
    await pool.query("update tigeriq_objectives set manager_cycles=manager_cycles+1,summary=$2,updated_at=now(),next_check_at=now()+interval '5 seconds' where id=$1",[o.id,String(decision.summary||'').slice(0,2000)]);
      // Durable child objective creation on phase completion (final terminal)
      if(decision.status==='complete'){
        try{
          const childKey=generateChildKey(o.id, decision.summary||'');
          await pool.query(
            "insert into tigeriq_objectives(id,metadata,status,created_at) values($1,$2,$3,now()) on conflict do nothing",
            [childKey, JSON.stringify({parentId:o.id,origin:'manager'}), 'active']
          );
        }catch(e){
          // swallow to avoid breaking manager loop; log could be added later
        }
      }
    const doneJobs=history.filter(x=>x.status==='done').length;
    if(campaignNeedsEvidence({status:decision.status,phases,doneJobs})){
      const phase=phases[currentPhase]; const id=campaignEvidenceJobId(o.id,currentPhase);
      const evidencePrompt=[
        `Execute campaign phase ${currentPhase+1}/${phases.length}: ${phase.title}.`,
        `Task: ${phase.prompt}`,
        phase.acceptance?`Acceptance: ${phase.acceptance}`:'',
        'Return concise concrete evidence/results for this phase. Do not claim repository mutation; coding/source changes are GitHub-only.'
      ].filter(Boolean).join('\n');
      const inserted=await pool.query('insert into tigeriq_jobs(id,objective_id,title,prompt,capability,phase_index) values($1,$2,$3,$4,$5,$6) on conflict(id) do nothing',[id,o.id,`Phase ${currentPhase+1} evidence: ${phase.title}`.slice(0,200),evidencePrompt.slice(0,12000),'reasoning',currentPhase]);
      if(inserted.rowCount===0){
        const existing=(a