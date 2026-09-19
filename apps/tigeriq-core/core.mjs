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
  R('NV15','Cloudflare','cloudflare','@cf/meta/llama-3.1-8b-instruct',[['CLOUDFLARE_ACCOUNT_ID'],['CLOUDFLARE_AUTH_TOKEN']],40),
  R('NV16','HuggingFace','huggingface','openai/gpt-oss-120b:fastest',[['HF_TOKEN']],45),
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

// Core Authority: Work Item Assignment & Priority
const PRIMARY_EMPLOYEE_IDS = ['NV02', 'NV03', 'NV04'];
function isPrimaryEmployee(employeeId) {
  return PRIMARY_EMPLOYEE_IDS.includes(employeeId);
}

function assignWorkItem(issueRef, priority = 'P0') {
  // Core assigns sole authority workItemId
  const workItemId = `CORE-${randomUUID()}`;
  return { workItemId, issueRef, priority };
}

function rankCoreCandidates(workers, jobs) {
  // P0 > P1 then FIFO among PRIMARY_EMPLOYEES
  const filtered = workers.filter(w => isPrimaryEmployee(w.employeeId));
  const sorted = filtered.sort((a, b) => {
    const pA = a.priority ?? 'P1';
    const pB = b.priority ?? 'P1';
    if (pA === 'P0' && pB !== 'P0') return -1;
    if (pB === 'P0' && pA !== 'P0') return 1;
    // FIFO based on created order; already ordered
    return 0;
  });
  return sorted;
}

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
  const mult={ms:1,s:1000,m:60000,h:3600000};const v=parts.reduce((a,x)=>a+mult[x[2]]*Number(x[1]),0);return v||null;
}

const config = {
  employees: ['NV02', 'NV03', 'NV04'],
  autoContinueTrigger: 'AUTO_CONTINUE',
  browserAction: 'DISPATCH',
  maxConcurrency: 1,
  snapshotMaxAgeMs: 600000,
};

const coreState = {
  lastDispatchedJobId: '',
  lastDispatchedAt: '',
  pendingJobId: '',
  uncertainJobId: '',
  assignedWorkItems: {},
};

async function setAssignment(issueRef, priority = 'P0') {
  const { workItemId, issueRef: ref, priority: p } = assignWorkItem(issueRef, priority);
  coreState.pendingJobId = workItemId;
  coreState.assignedWorkItems[workItemId] = { issueRef: ref, priority: p };
  return workItemId;
}

async function handleCoreDispatch(workerId, workItemId) {
  if (coreState.lastDispatchedJobId === workItemId) {
    return null; // Duplicate dispatch prevention
  }
  const { issueRef, priority } = coreState.assignedWorkItems[workItemId] || { issueRef: '', priority: 'P0' };
  coreState.lastDispatchedJobId = workItemId;
  coreState.lastDispatchedAt = nowIso();
  coreState.pendingJobId = '';
  return { workerId, workItemId, issueRef, priority };
}

// HTTP Server for Core Status & API
const app = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, timestamp: nowIso() }));
  }
  if (req.method === 'POST' && url.pathname === '/api/core/assignment') {
    if (TOKEN && req.headers.authorization !== `Bearer ${TOKEN}`) {
      res.writeHead(403); return res.end('Forbidden');
    }
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { issueRef, priority } = JSON.parse(body);
        const workItemId = await setAssignment(issueRef, priority);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ workItemId }));
      } catch {
        res.writeHead(400); res.end('Bad Request');
      }
    });
    return;
  }
  res.writeHead(404); res.end('Not Found');
});

app.listen(PORT, HOST, () => {
  console.log(`Core running on ${HOST}:${PORT}`);
});

export { nowIso, sleep, classifyHttp, fetchJson, quotaHeaderNumber, quotaResetDurationMs, config, coreState, setAssignment, handleCoreDispatch, rankCoreCandidates, isPrimaryEmployee, resources, credentialPresent, reqReady };
export default app;
