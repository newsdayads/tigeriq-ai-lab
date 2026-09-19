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
const HOTPATH_SAMPLE_LIMIT = 5;
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
  if(retry){const seconds=Number(retry);if(
...[MODEL_CONTEXT_REDUCED]...
eTransientError(e)){
    const plan=resourceWaitPlan({retryCount:current.resource_retry_count,startedAt:current.resource_retry_started_at});
    if(plan.wait){
      await pool.query("update tigeriq_coding_jobs set status='waiting_resource',failure=$2,next_attempt_at=$3,resource_retry_count=$4,resource_retry_started_at=coalesce(resource_retry_started_at,now()),completed_at=null where id=$1",[j.id,JSON.stringify({...failure,resourceWait:{retryCount:plan.retryCount,delayMs:plan.delayMs,nextAttemptAt:plan.nextAttemptAt}}),plan.nextAttemptAt,plan.retryCount]);
      await pool.query("update tigeriq_coding_objectives set status='active',summary=$2,updated_at=now() where id=$1",[j.objective_id,`WAITING_RESOURCE retry ${plan.retryCount}/${RESOURCE_WAIT_MAX_RETRIES}: ${failure.message}`.slice(0,1000)]);
      return;
    }
  }
  await pool.query("update tigeriq_coding_jobs set status='failed',failure=$2,completed_at=now(),next_attempt_at=null where id=$1",[j.id,JSON.stringify(failure)]);
  await pool.query("update tigeriq_coding_objectives set status='blocked',summary=$2,updated_at=now() where id=$1",[j.objective_id,String(e?.message||e).slice(0,1000)]);
}

function normalizeWorkItemLifecycle(obj, jobsForObj) {
  const activeJob = jobsForObj.find(j => ['queued', 'claimed', 'working', 'evidence', 'verify', 'waiting_ci', 'waiting_resource', 'review'].includes(j.status)) || jobsForObj[0];
  let lifecycle = 'QUEUED';
  const rawStatus = String(activeJob?.status || obj.status || '').toLowerCase();
  if (rawStatus === 'queued' || rawStatus === 'active') lifecycle = 'QUEUED';
  else if (rawStatus === 'claimed') lifecycle = 'CLAIMED';
  else if (rawStatus === 'working') lifecycle = 'WORKING';
  else if (rawStatus === 'evidence' || rawStatus === 'waiting_resource') lifecycle = 'EVIDENCE';
  else if (rawStatus === 'verify' || rawStatus === 'review' || rawStatus === 'waiting_ci') lifecycle = 'VERIFY';
  else if (rawStatus === 'done' || rawStatus === 'completed' || obj.status === 'completed') lifecycle = 'DONE';
  else if (rawStatus === 'blocked' || rawStatus === 'failed' || obj.status === 'blocked') lifecycle = 'BLOCKED';
  return {
    id: obj.id,
    title: obj.objective || obj.title || '',
    priority: obj.priority || 'P1',
    lifecycle,
    rawStatus,
    activeJobId: activeJob?.id || null,
    createdAt: obj.created_at,
    updatedAt: obj.updated_at || obj.created_at
  };
}

async function snapshot(){
  const objectives=(await pool.query('select * from tigeriq_coding_objectives order by created_at desc limit 20')).rows;
  const jobs=(await pool.query('select * from tigeriq_coding_jobs order by created_at desc limit 30')).rows;
  const workItems = objectives.map(obj => normalizeWorkItemLifecycle(obj, jobs.filter(j => j.objective_id === obj.id)));
  return {
    ok:true,
    service:'tigeriq-coding-lane',
    host:HOST,
    port:PORT,
    pid:process.pid,
    resources:resources.map(x=>({id:x.id,provider:x.provider,model:x.model})),
    objectives,
    jobs,
    workItems
  };
}
async function body(req){let s='';for await(const c of req){s+=c;if(s.length>65536)throw new Error('BODY_TOO_LARGE')}return s?JSON.parse(s):{}}
const server=createServer(async(req,res)=>{const u=new URL(req.url||'/','http://localhost');try{if(req.method==='GET'&&u.pathname==='/health'){res.writeHead(200,{'content-type':'application/json'});return res.end(JSON.stringify({ok:true,service:'tigeriq-coding-lane',pid:process.pid,resources:resources.length}))}if(req.method==='GET'&&u.pathname==='/api/status'){res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});return res.end(JSON.stringify(await snapshot()))}if(req.method==='POST'&&u.pathname==='/api/objectives'){const b=await body(req);if(!String(b.objective||'').trim()){res.writeHead(400);return res.end('objective_required')}const id=`CODEOBJ-${randomUUID()}`;const priority=['P0','P1','P2'].includes(b.priority)?b.priority:'P1';await pool.query('insert into tigeriq_coding_objectives(id,objective,priority) values($1,$2,$3)',[id,String(b.objective).slice(0,12000),priority]);res.writeHead(201,{'content-type':'application/json'});return res.end(JSON.stringify({ok:true,id}))}res.writeHead(404);res.end('not_found')}catch(e){res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({ok:false,error:String(e?.message||e)}))}});

if(process.env.NODE_ENV!=='test'){
  await initDb();
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(PORT,HOST,resolve)});
  console.log(JSON.stringify({event:'TIGERIQ_CODING_LANE_STARTED',host:HOST,port:PORT,pid:process.pid,resources:resources.map(x=>x.id),autoMerge:AUTO_MERGE}));
  let stop=false;
  const active=new Set();
  process.on('SIGINT',()=>{stop=true;server.close()});
  process.on('SIGTERM',()=>{stop=true;server.close()});
  while(!stop){
    try{
      await managerTick();
      while(active.size<MAX_PARALLEL){
        const j=await claimJob();
        if(!j)break;
        active.add(j.id);
        void runJob(j).catch(e=>failJob(j,e)).finally(()=>active.delete(j.id));
      }
    }catch(e){console.error(JSON.stringify({event:'CODING_LANE_LOOP_ERROR',error:String(e?.message||e)}))}
    await sleep(1500);
  }
  if(pool)await pool.end();
}
