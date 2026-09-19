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

const workItemStateMap = {
  QUEUED:'queued', CLAIMED:'claimed', WORKING:'working', EVIDENCE:'evidence', VERIFY:'verify', DONE:'done', BLOCKED:'blocked'
};

const hotPathStage = (job, stage) => ({
  id: job?.job_id || job?.id || randomUUID(),
  status: workItemStateMap[stage] || 'unknown',
  timestamp: job?.ts || new Date().toISOString(),
  employeeId: job?.employee_id,
  kind: job?.kind || 'readonly',
  lane: job?.lane || 'default'
});

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
  if(retry){const n=Number(retry);if(Number.isFinite(n))return n*1000;if(retry.toLowerCase().endsWith('Z'))return new Date(retry).getTime();}return null;
}
const db = { pool, async fetchOne(q, p){return await pool.query(q,p).then(r=>r.rows[0]);}, async fetchAll(q,p){return await pool.query(q,p).then(r=>r.rows);} };
const safeJson = (d) => d !== undefined && d !== null ? JSON.stringify(d) : '';
const nowIso = () => new Date().toISOString();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function managerTick() { return await sleep(MANAGER_IDLE_MS); }
async function invokeProvider(res, prompt, ctx, kind){
  const req = { model: res.model, prompt, ctx, kind };
  await sleep(Math.floor(Math.random()*500));
  if(kind==='readonly')return { content: prompt.slice(0,50)+'...' };
  if(kind==='worker')return { content: 'Work complete' };
  return { content: 'Response' };
}
const reqReady = (r) => r.req.every(([k,v]) => process.env[k] && (v === undefined || process.env[k] === v));

createServer(async(req, res) => {
  res.setHeader('Content-Type','application/json');
  if(req.url==='/health'||req.url==='/status')return res.end(JSON.stringify({status:'ok',ts:nowIso()}));
  if(req.url==='/api/hotpath/sample'){
    res.setHeader('Cache-Control','no-store');
    const data=[];
    for(let i=0;i<HOTPATH_SAMPLE_LIMIT;i++){
      const stages=['QUEUED','CLAIMED','WORKING','EVIDENCE','VERIFY','DONE','BLOCKED'];
      const st=stages[Math.floor(Math.random()*stages.length)];
      data.push(hotPathStage({job_id:`sample-${i}`},st));
    }
    return res.end(JSON.stringify({items:data}));
  }
  if(req.method==='GET'&&req.pathname==='/api/workitems'){
    const items=[{
      id:'W-100', lane:'coding', status:'working', owner:'NV10'
    }];
    return res.end(JSON.stringify({items}));
  }
  res.end(JSON.stringify({error:'not found'}));
}).listen(PORT,HOST,()=>console.log(`Core on http://${HOST}:${PORT}`));
