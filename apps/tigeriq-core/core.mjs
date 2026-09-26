import { createServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import { createGeminiRateController } from '../shared/gemini-rate-control.mjs';
import { isManagerPrompt, managerLocalRequestBody, managerResponseFormatForHost, managerShouldUseLocalFallback, runBoundedManagerDecision } from './manager-json.mjs';
import { NV09_EMPLOYEE_ID, NV09_MODEL, nv09ModelAvailability, registerNv09, runBoundedInferenceNv09 } from './registry.mjs';
import { appendSkillContextToPrompt, matchAndLoadSkills } from './skill-loader.mjs';
import { buildManagerHistoryContext } from './context-gateway.mjs';
import { buildFailureLearningCandidates, failureLearningEventTypes } from './failure-learning.mjs';
import { normalizeCampaignPhases, currentCampaignGoal, campaignTransition, makePhaseCheckpoint, campaignNeedsEvidence, campaignEvidenceJobId } from './campaign-runner.mjs';
import { normalizeTerminalWorkItems, handoffGenerationKey, evaluateChildObjectiveStates, isCodingHandoff } from './work-handoff.mjs';
import { ROUTING_PROFILE_LABELS, createResourceId, deriveRoutingProfile, failurePolicy, normalizeQuota, rankCandidates, rateLimitFailureState } from './smart-router.mjs';
import { runExecutionPreflight } from './execution-preflight.mjs';
import { detectIdleWithBacklog, routingFault } from './github-backlog-policy.mjs';
import { staleLeaseRecoveryPlan } from './job-recovery-policy.mjs';
import { API_DOCTOR_CAPABILITY, apiDoctorAction, apiDoctorExistingHandoffAction, apiDoctorRepairSignature, buildApiDoctorPrompt, classifyApiDoctorFailure, parseApiDoctorDecision } from './api-doctor.mjs';
import { buildCoreUiAssignmentSnapshot } from './core-ui-assignment.mjs';
import { appendPublicEvidenceToSummary } from './public-evidence.mjs';
import { refreshRegistryWorkforce, normalizeRuntimeResources } from './workforce-registry.mjs';
import { OPENCLAW_EMPLOYEE_ID, OPENCLAW_MODEL, OPENCLAW_PROVIDER, OPENCLAW_RESOURCE_ID, normalizeOpenClawDispatchEnvelope, waitOpenClawDispatch } from '../openclaw-tigeriq-runtime/dispatch.mjs';

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
const NV09_TIMEOUT_MS = Math.max(30000, Number(process.env.TIGERIQ_NV09_TIMEOUT_MS || 120000));
const OPENCLAW_GATEWAY_HEALTH_URL = process.env.TIGERIQ_OPENCLAW_GATEWAY_HEALTH_URL?.trim() || 'http://127.0.0.1:18789/health';
const OPENCLAW_ACTIVATION_FILE = process.env.TIGERIQ_OPENCLAW_ACTIVATION_FILE?.trim() || 'D:\\TigerIQ\\State\\openclaw-core-resource-enabled.json';
const API_DOCTOR_INTERVAL_MS = Math.max(60000, Number(process.env.TIGERIQ_API_DOCTOR_INTERVAL_MS || 120000));
const API_DOCTOR_ANALYSIS_DEDUPE_MS = Math.max(60000, Number(process.env.TIGERIQ_API_DOCTOR_ANALYSIS_DEDUPE_MS || 600000));
const API_DOCTOR_VALIDATION_POLICY_VERSION = 'nonempty-v2';
const CODING_LANE_HOST = process.env.TIGERIQ_CODING_HOST?.trim() || HOST;
const CODING_LANE_PORT = Number(process.env.TIGERIQ_CODING_PORT || 8797);
const CODING_LANE_URL = process.env.TIGERIQ_CODING_URL?.trim() || `http://${CODING_LANE_HOST}:${CODING_LANE_PORT}`;
const GITHUB_TOKEN = process.env.TIGERIQ_GITHUB_TOKEN?.trim() || process.env.GITHUB_TOKEN?.trim() || '';
const GITHUB_OWNER = process.env.TIGERIQ_GITHUB_OWNER?.trim() || 'newsdayads';
const GITHUB_REPO = process.env.TIGERIQ_GITHUB_REPO?.trim() || 'tigeriq-ai-lab';
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
const nv09Registration = registerNv09();
const nv09Resource = R(NV09_EMPLOYEE_ID,'Qwen3-Coder Local','ollama',NV09_MODEL,[],98);
nv09Resource.capabilities = ['coding_local'];
nv09Resource.runtimeBinding = 'ollama_on_demand';
const nv10Resource = R(OLLAMA_EMPLOYEE_ID,'Ollama','ollama',process.env.TIGERIQ_OLLAMA_MODEL || 'qwen3:4b',[],90);
nv10Resource.capabilities = ['general','reasoning','review',API_DOCTOR_CAPABILITY];
const openclawResource={
  id:OPENCLAW_EMPLOYEE_ID,employeeId:OPENCLAW_EMPLOYEE_ID,resourceId:OPENCLAW_RESOURCE_ID,name:'OpenClaw Operator',provider:OPENCLAW_PROVIDER,model:OPENCLAW_MODEL,req:[],rank:5,
  accountBinding:'default',runtimeBinding:'pc01',costTier:'LOCAL',zeroOutOfPocket:true,capabilities:['pc_operator'],
};
const resources = [
  nv09Resource,
  nv10Resource,
  openclawResource,
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
function openClawResourceActivated(){
  try{
    const parsed=JSON.parse(readFileSync(OPENCLAW_ACTIVATION_FILE,'utf8'));
    return parsed?.enabled===true&&Number(parsed?.acceptanceIssue)===1528&&String(parsed?.runtimeState||'').toUpperCase()==='PASS';
  }catch{return false;}
}
async function probeOpenClawGateway(){
  const started=Date.now();
  try{
    const body=await fetchJson(OPENCLAW_GATEWAY_HEALTH_URL,{},3000);
    return {ok:body?.ok===true||String(body?.status||'').toLowerCase()==='live',latencyMs:Date.now()-started,body};
  }catch(error){
    return {ok:false,latencyMs:Date.now()-started,error:String(error?.message||error)};
  }
}
function quotaHeaderNumber(headers,name){const value=headers?.get?.(name);if(value===null||value===undefined||String(value).trim()==='')return null;const n=Number(value);return Number.isFinite(n)?Math.max(0,n):null;}
function quotaResetDurationMs(value){
  const text=String(value||'').trim();if(!text)return null;
  const parts=[...text.matchAll(/(\d+(?:\.\d+)?)(ms|s|m|h)/gi)];if(!parts.length||parts.map(x=>x[0]).join('').toLowerCase()!==text.toLowerCase())return null;
  const mult={ms:1,s:1000,m:60000,h:3600000};const total=parts.reduce((sum,x)=>sum+Number(x[1])*mult[x[2].toLowerCase()],0);return Number.isFinite(total)?Math.max(0,total):null;
}
function quotaResetAt(headers){
  const retry=headers?.get?.('retry-after');
  if(retry){const seconds=Number(retry);if(Number.isFinite(seconds))return new Date(Date.now()+Math.max(0,seconds)*1000).toISOString();const parsed=Date.parse(retry);if(Number.isFinite(parsed))return new Date(parsed).toISOString();}
  for(const key of ['x-ratelimit-reset-requests','x-ratelimit-reset-tokens','x-ratelimit-reset']){const value=headers?.get?.(key);if(!value)continue;const durationMs=quotaResetDurationMs(value);if(durationMs!==null)return new Date(Date.now()+durationMs).toISOString();const numeric=Number(value);if(Number.isFinite(numeric)){const when=numeric>1e12?numeric:(numeric>1e9?numeric*1000:Date.now()+Math.max(0,numeric)*1000);return new Date(when).toISOString();}const parsed=Date.parse(value);if(Number.isFinite(parsed))return new Date(parsed).toISOString();}
  return null;
}
async function syncQuotaFromHeaders(r,res){
  const requestLimit=quotaHeaderNumber(res.headers,'x-ratelimit-limit-requests'),requestRemaining=quotaHeaderNumber(res.headers,'x-ratelimit-remaining-requests'),tokenLimit=quotaHeaderNumber(res.headers,'x-ratelimit-limit-tokens'),tokenRemaining=quotaHeaderNumber(res.headers,'x-ratelimit-remaining-tokens'),resetAt=quotaResetAt(res.headers);
  const known=[requestLimit,requestRemaining,tokenLimit,tokenRemaining].some(v=>v!==null);
  if(!known&&!resetAt&&res.status!==429)return;
  const ratios=[];if(requestLimit>0&&requestRemaining!==null)ratios.push(requestRemaining/requestLimit);if(tokenLimit>0&&tokenRemaining!==null)ratios.push(tokenRemaining/tokenLimit);
  const remainingRatio=ratios.length?Math.max(0,Math.min(1,Math.min(...ratios))):null;
  const quota=normalizeQuota({known,usable:res.status!==429&&(remainingRatio===null||remainingRatio>0),remainingRatio,requestLimit,requestRemaining,tokenLimit,tokenRemaining,resetAt,cooldownUntil:res.status===429?resetAt:null,last429At:res.status===429?nowIso():null,sourceConfidence:known?'high':'medium'});
  await pool.query("update tigeriq_ai_resources set quota_state=$2::jsonb,last_429_at=case when $3 then now() else last_429_at end,updated_at=now() where resource_id=$1",[r.resourceId,JSON.stringify(quota),res.status===429]);
}
async function surfSenseHealth() {
  const started=Date.now();
  try { const r=await fetch(SURFSENSE_APP_URL,{signal:AbortSignal.timeout(2500)}); return {ok:r.ok,status:r.status,latencyMs:Date.now()-started,url:SURFSENSE_APP_URL}; }
  catch(e){ return {ok:false,error:String(e?.message||e),latencyMs:Date.now()-started,url:SURFSENSE_APP_URL}; }
}
async function surfSenseSearch(query, limit=6) {
  const u=new URL(SURFSENSE_SEARCH_URL); u.searchParams.set('q',query); u.searchParams.set('format','json');
  const body=await fetchJson(u.toString(),{},30000); const rows=Array.isArray(body?.results)?body.results:[];
  const sources=rows.filter(x=>x?.url&&x?.title).slice(0,Math.max(1,Math.min(10,limit))).map((x,i)=>({index:i+1,title:String(x.title),url:String(x.url),snippet:String(x.content||'').slice(0,1200),engine:String(x.engine||'surfsense')}));
  if(!sources.length){const e=new Error('SURFSENSE_NO_RESULTS');e.kind='invalid_response';throw e;} return sources;
}
async function summarizeSurfSense(evidence, query) {
  const started=Date.now();
  const body=await fetchJson('http://127.0.0.1:11434/api/generate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model:SURFSENSE_SUMMARY_MODEL,prompt:`Answer using ONLY the supplied sources. Cite claims as [1], [2], etc. Be concise. If evidence is insufficient, say so.\nQuestion: ${query}\n\nSources:\n${evidence}`,stream:false,options:{temperature:0,num_predict:180}})},90000);
  const text=String(body?.response||'').trim(); if(!text){const e=new Error('OLLAMA_RESEARCH_EMPTY');e.kind='invalid_response';throw e;} return {text,latencyMs:Date.now()-started};
}
async function runSurfSenseResearch(query, limit=6) {
  const id=`JOB-${randomUUID()}`; await pool.query("insert into tigeriq_jobs(id,title,prompt,capability,kind,status,started_at) values($1,$2,$3,'reasoning','research','running',now())",[id,`Research: ${query}`.slice(0,200),query]);
  try { const sources=await surfSenseSearch(query,limit); const evidence=sources.map(x=>`[${x.index}] ${x.title}\nURL: ${x.url}\n${x.snippet}`).join('\n\n'); const local=await summarizeSurfSense(evidence,query);
    const ollama=resources.find(x=>x.provider==='ollama'); const result={text:local.text,sources,researchProvider:'surfsense',aiProvider:'ollama',employeeId:OLLAMA_EMPLOYEE_ID,resourceId:ollama?.resourceId||null,model:SURFSENSE_SUMMARY_MODEL,latencyMs:local.latencyMs}; await pool.query("update tigeriq_jobs set status='done',employee_id=$2,resource_id=$3,provider='ollama',result=$4,lease_until=null,completed_at=now() where id=$1",[id,OLLAMA_EMPLOYEE_ID,ollama?.resourceId||null,JSON.stringify(result)]); await event('SURFSENSE_RESEARCH_DONE',{jobId:id,employeeId:OLLAMA_EMPLOYEE_ID,resourceId:ollama?.resourceId||null,provider:'ollama'}); return {ok:true,jobId:id,...result};
  } catch(error){ await pool.query("update tigeriq_jobs set status='failed',failure=$2,lease_until=null,completed_at=now() where id=$1",[id,JSON.stringify({message:String(error?.message||error)})]); await event('SURFSENSE_RESEARCH_FAILED',{jobId:id}); throw error; }
}

async function invokeLocalManager(prompt) {
  const body=await fetchJson('http://127.0.0.1:11434/api/generate',{
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify(managerLocalRequestBody(nv10Resource.model,prompt)),
  },OLLAMA_TIMEOUT_MS);
  const text=String(body?.response||'').trim();
  if(!text){const e=new Error('OLLAMA_MANAGER_EMPTY');e.kind='invalid_response';throw e;}
  return text;
}

async function openAiCompat(endpoint, key, model, prompt, extraHeaders = {}, timeoutMs = 90000, resource = null) {
  const requestBody={ model, messages:[{role:'user',content:prompt}], temperature:0, max_tokens:isManagerPrompt(prompt)?800:1200, stream:false };
  const responseFormat=managerResponseFormatForHost(new URL(endpoint).hostname,prompt);
  if(responseFormat)requestBody.response_format=responseFormat;
  const body = await fetchJson(endpoint, {
    method: 'POST', headers: { 'content-type':'application/json', authorization:`Bearer ${key}`, ...extraHeaders },
    body: JSON.stringify(requestBody),
  }, timeoutMs, resource?res=>syncQuotaFromHeaders(resource,res):null);
  const text = body?.choices?.[0]?.message?.content;
  if (!String(text || '').trim()) { const e = new Error('EMPTY_RESPONSE'); e.kind='invalid_response'; throw e; }
  return String(text);
}
export function watsonxTextFromBody(body){
  const firstResult=Array.isArray(body?.results)&&body.results.length?body.results[0]:null;
  const firstChoice=Array.isArray(body?.choices)&&body.choices.length?body.choices[0]:null;
  const chatContent=firstChoice?.message?.content;
  const chatText=typeof chatContent==='string'
    ?chatContent
    :Array.isArray(chatContent)
      ?chatContent.map(part=>typeof part==='string'?part:(typeof part?.text==='string'?part.text:'')).join('')
      :null;
  const candidates=[chatText,firstChoice?.text,firstResult?.generated_text,firstResult?.text,firstResult?.output,body?.generated_text,body?.output];
  const found=candidates.find(value=>typeof value==='string');
  return found===undefined?null:found;
}
export function hasWatsonxTextShape(body){
  const firstResult=Array.isArray(body?.results)&&body.results.length?body.results[0]:null;
  const firstChoice=Array.isArray(body?.choices)&&body.choices.length?body.choices[0]:null;
  const chatContent=firstChoice?.message?.content;
  return Boolean(
    (firstChoice&&(
      Object.prototype.hasOwnProperty.call(firstChoice,'text')||
      (firstChoice.message&&Object.prototype.hasOwnProperty.call(firstChoice.message,'content'))
    ))||
    (firstResult&&['generated_text','text','output'].some(key=>Object.prototype.hasOwnProperty.call(firstResult,key)))||
    (body&&typeof body==='object'&&['generated_text','output'].some(key=>Object.prototype.hasOwnProperty.call(body,key)))||
    Array.isArray(chatContent)
  );
}
export function watsonxRetryDecision(body,attempt,maxRetries=2){
  if(!hasWatsonxTextShape(body))return{action:'fail',code:'WATSONX_SHAPE_MISMATCH'};
  const text=watsonxTextFromBody(body);
  if(String(text??'').trim())return{action:'success',text:String(text)};
  if(Number(attempt)<Number(maxRetries))return{action:'retry',code:'WATSONX_TRANSIENT_EMPTY'};
  return{action:'fail',code:'EMPTY_RESPONSE'};
}

async function invokeProvider(r, prompt) {
  switch (r.provider) {
    case 'ollama': {
      if(r.id===NV09_EMPLOYEE_ID){const out=await runBoundedInferenceNv09(prompt,{timeoutMs:NV09_TIMEOUT_MS,numCtx:1024,numPredict:96,keepAlive:'30s'});return out.text;}
      return openAiCompat('http://127.0.0.1:11434/v1/chat/completions','',r.model,prompt,{authorization:undefined},OLLAMA_TIMEOUT_MS,r);
    }
    case 'groq': return openAiCompat('https://api.groq.com/openai/v1/chat/completions',process.env.GROQ_API_KEY,r.model,prompt,{},90000,r);
    case 'openrouter': return openAiCompat('https://openrouter.ai/api/v1/chat/completions',process.env.OPENROUTER_API_KEY,r.model,prompt,{},90000,r);
    case 'mistral': return openAiCompat('https://api.mistral.ai/v1/chat/completions',process.env.MISTRAL_API_KEY,r.model,prompt,{},90000,r);
    case 'huggingface': return openAiCompat('https://router.huggingface.co/v1/chat/completions',process.env.HF_TOKEN,r.model,prompt,{},90000,r);
    case 'inception': return openAiCompat('https://api.inceptionlabs.ai/v1/chat/completions',process.env.INCEPTION_API_KEY,r.model,prompt,{},90000,r);
    case 'nvidia': return openAiCompat('https://integrate.api.nvidia.com/v1/chat/completions',process.env.NVIDIA_API_KEY,r.model,prompt,{},90000,r);
    case 'gemini': return geminiRateController.run(async()=>{
      const b = await fetchJson(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(r.model)}:generateContent`, {
        method:'POST', headers:{'content-type':'application/json','x-goog-api-key':process.env.GEMINI_API_KEY},
        body:JSON.stringify({contents:[{role:'user',parts:[{text:prompt}]}],...(isManagerPrompt(prompt)?{generationConfig:{responseMimeType:'application/json'}}:{})}) });
      const text = b?.candidates?.[0]?.content?.parts?.map(x=>x.text||'').join('\n');
      if (!String(text||'').trim()) { const e=new Error('EMPTY_RESPONSE'); e.kind='invalid_response'; throw e; }
      return String(text);
    });    case 'cloudflare': {
      const account = process.env.CLOUDFLARE_ACCOUNT_ID;
      const b = await fetchJson(`https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${r.model}`, {
        method:'POST', headers:{'content-type':'application/json',authorization:`Bearer ${process.env.CLOUDFLARE_AUTH_TOKEN}`},
        body:JSON.stringify({prompt}) });
      const text = b?.result?.response;
      if (!String(text||'').trim()) { const e=new Error('EMPTY_RESPONSE'); e.kind='invalid_response'; throw e; }
      return String(text);
    }
    case 'cohere': {
      const b = await fetchJson('https://api.cohere.com/v2/chat', {
        method:'POST', headers:{'content-type':'application/json',authorization:`Bearer ${process.env.COHERE_API_KEY}`},
        body:JSON.stringify({model:r.model,messages:[{role:'user',content:prompt}],temperature:0,max_tokens:isManagerPrompt(prompt)?800:1200,...(managerResponseFormatForHost('api.cohere.com',prompt)?{response_format:{type:'json_object'}}:{})}) });
      const text = b?.message?.content?.map(x=>x.text||'').join('');
      if (!String(text||'').trim()) { const e=new Error('EMPTY_RESPONSE'); e.kind='invalid_response'; throw e; }
      return String(text);
    }
    case 'watsonx': {
      const form=new URLSearchParams({grant_type:'urn:ibm:params:oauth:grant-type:apikey',apikey:process.env.WATSONX_API_KEY});
      const iam=await fetchJson('https://iam.cloud.ibm.com/identity/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:form.toString()});
      const maxRetries=2;
      for(let attempt=0;attempt<=maxRetries;attempt++){
        const b=await fetchJson('https://us-south.ml.cloud.ibm.com/ml/v1/text/chat?version=2025-10-25',{
          method:'POST',headers:{accept:'application/json','content-type':'application/json',authorization:`Bearer ${iam.access_token}`},
          body:JSON.stringify({
            model_id:process.env.WATSONX_MODEL_ID,
            project_id:process.env.WATSONX_PROJECT_ID,
            messages:[{role:'user',content:prompt}],
            max_completion_tokens:1200,
            temperature:0
          })
        });
        const decision=watsonxRetryDecision(b,attempt,maxRetries);
        if(decision.action==='success')return decision.text;
        if(decision.action==='retry'){await sleep(400*(attempt+1));continue;}
        const e=new Error(decision.code);e.kind='invalid_response';throw e;
      }
      const e=new Error('EMPTY_RESPONSE');e.kind='invalid_response';throw e;
    }
    default: { const e=new Error('PROVIDER_UNSUPPORTED'); e.kind='configuration'; throw e; }
  }
 }async function initDb() {
  await pool.query(`
    create table if not exists tigeriq_objectives(
      id text primary key, objective text not null, priority text not null default 'P1', status text not null default 'active',
      summary text, manager_cycles int not null default 0, next_check_at timestamptz not null default now(),
      created_at timestamptz not null default now(), updated_at timestamptz not null default now(), metadata jsonb not null default '{}'::jsonb);
    create table if not exists tigeriq_jobs(
      id text primary key, objective_id text references tigeriq_objectives(id), title text not null, prompt text not null,
      capability text not null default 'general', kind text not null default 'ai', status text not null default 'queued',
      employee_id text, provider text, result jsonb, failure jsonb, attempts int not null default 0, max_attempts int not null default 3,
      lease_until timestamptz, created_at timestamptz not null default now(), started_at timestamptz, completed_at timestamptz);
    create table if not exists tigeriq_resources(
      employee_id text primary key, name text not null, provider text not null, model text not null, enabled boolean not null default true,
      credential_state text not null, health_state text not null, work_state text not null, current_job_id text,
      last_seen_at timestamptz, cooldown_until timestamptz, last_latency_ms int, success_count int not null default 0,
      failure_count int not null default 0, capabilities text[] not null default '{}', rank int not null default 50, updated_at timestamptz not null default now());
    create table if not exists tigeriq_ai_resources(
      resource_id text primary key, employee_id text, name text not null, provider text not null, model text not null,
      account_binding text not null default 'default', runtime_binding text not null default 'core', cost_tier text not null default 'FREE',
      enabled boolean not null default true, credential_state text not null, health_state text not null, work_state text not null,
      current_job_id text, last_seen_at timestamptz, cooldown_until timestamptz, last_latency_ms int,
      success_count int not null default 0, failure_count int not null default 0, capabilities text[] not null default '{}',
      rank int not null default 50, quota_state jsonb not null default '{"known":false,"usable":true,"sourceConfidence":"low"}'::jsonb,
      last_429_at timestamptz, updated_at timestamptz not null default now());
    create table if not exists tigeriq_events(
      seq bigserial primary key, ts timestamptz not null default now(), type text not null, objective_id text, job_id text, employee_id text, data jsonb not null default '{}'::jsonb);
    alter table tigeriq_jobs add column if not exists resource_id text;
    alter table tigeriq_jobs add column if not exists routing_profile text not null default 'AUTO';
    alter table tigeriq_jobs add column if not exists routing_decision jsonb;
    alter table tigeriq_jobs add column if not exists phase_index int not null default 0;
    alter table tigeriq_jobs add column if not exists next_attempt_at timestamptz;
    alter table tigeriq_jobs add column if not exists resource_wait_count int not null default 0;
    alter table tigeriq_jobs add column if not exists resource_wait_started_at timestamptz;
    alter table tigeriq_events add column if not exists resource_id text;
    alter table tigeriq_events add column if not exists task_kind text;
    create index if not exists tigeriq_jobs_status_idx on tigeriq_jobs(status,created_at);
    create index if not exists tigeriq_ai_resources_employee_idx on tigeriq_ai_resources(employee_id);
    create index if not exists tigeriq_events_resource_task_idx on tigeriq_events(resource_id,task_kind,ts desc);
  `);
}
async function event(type, data = {}) {
  await pool.query('insert into tigeriq_events(type,objective_id,job_id,employee_id,resource_id,task_kind,data) values($1,$2,$3,$4,$5,$6,$7)',[type,data.objectiveId||null,data.jobId||null,data.employeeId||null,data.resourceId||null,data.taskKind||null,JSON.stringify(data)]);
}
function hotPathTiming(j, stage, extra = {}) {
  const now = Date.now();
  const createdAtMs = j?.created_at ? new Date(j.created_at).getTime() : now;
  const startedAtMs = j?.started_at ? new Date(j.started_at).getTime() : null;
  return { stage, at: new Date(now).toISOString(), endToEndMs: Math.max(0, now-createdAtMs), queueMs: startedAtMs ? Math.max(0, startedAtMs-createdAtMs) : null, ...extra };
}
async function hotPathStage(j, stage, extra = {}) {
  const timing=hotPathTiming(j,stage,extra);
  await event('HOTPATH_STAGE',{objectiveId:j?.objective_id||null,jobId:j?.id||null,taskKind:j?.kind||'ai',...timing});
  return timing;
}
function median(values){const xs=values.filter(Number.isFinite).sort((a,b)=>a-b);if(!xs.length)return null;const m=Math.floor(xs.length/2);return xs.length%2?xs[m]:Math.round((xs[m-1]+xs[m])/2);}
function failureCooldownMs(kind){return failurePolicy(kind).cooldownMs;}
function failureHealth(kind){return kind==='rate_limit'?'RATE_LIMITED':(['auth','configuration','security','credential','paid','production','irreversible'].includes(kind)?'OFFLINE':'ERROR');}
async function maybeQuarantineResource(r){
  if(r.id!=='NV16')return null;
  const q=await pool.query(`select type from tigeriq_events where resource_id=$1 and type in ('RESOURCE_SUCCESS','RESOURCE_PROBE_OK','RESOURCE_FAILURE','RESOURCE_PROBE_FAIL') order by seq desc limit $2`,[r.resourceId,NV16_FAILURE_WINDOW]);
  if(q.rows.length<10)return null;
  const failures=q.rows.filter(x=>x.type==='RESOURCE_FAILURE'||x.type==='RESOURCE_PROBE_FAIL').length;
  const ratio=failures/q.rows.length;if(ratio<=NV16_FAILURE_THRESHOLD)return null;
  const until=new Date(Date.now()+30*60*1000).toISOString();
  await pool.query("update tigeriq_ai_resources set health_state='ERROR',work_state=case when current_job_id is null then 'ERROR' else work_state end,cooldown_until=$2,updated_at=now() where resource_id=$1",[r.resourceId,until]);
  await event('RESOURCE_QUARANTINED',{employeeId:r.id,resourceId:r.resourceId,provider:r.provider,failureRatio:ratio,window:q.rows.length,cooldownUntil:until});
  return {failureRatio:ratio,window:q.rows.length,cooldownUntil:until};
}
async function markResourceSuccess(r,jobId,latency,eventType='RESOURCE_SUCCESS',releaseJob=true,context={}){
  if(releaseJob)await pool.query("update tigeriq_ai_resources set current_job_id=null,work_state='IDLE',health_state='ONLINE',last_seen_at=now(),last_latency_ms=$2,cooldown_until=null,success_count=success_count+1,quota_state=coalesce(quota_state,'{}'::jsonb)||'{\"usable\":true}'::jsonb,updated_at=now() where resource_id=$1",[r.resourceId,latency]);
  else await pool.query("update tigeriq_ai_resources set health_state='ONLINE',work_state=case when current_job_id is null then 'IDLE' else 'BUSY' end,last_seen_at=now(),last_latency_ms=$2,cooldown_until=null,success_count=success_count+1,quota_state=coalesce(quota_state,'{}'::jsonb)||'{\"usable\":true}'::jsonb,updated_at=now() where resource_id=$1",[r.resourceId,latency]);
  await pool.query("update tigeriq_resources set current_job_id=case when $3 then null else current_job_id end,work_state=case when $3 then 'IDLE' else case when current_job_id is null then 'IDLE' else 'BUSY' end end,health_state='ONLINE',last_seen_at=now(),last_latency_ms=$2,cooldown_until=null,success_count=success_count+1,updated_at=now() where employee_id=$1",[r.id,latency,releaseJob]);
  await event(eventType,{jobId,employeeId:r.id,resourceId:r.resourceId,provider:r.provider,latencyMs:latency,taskKind:context.taskKind||null,routingProfile:context.profile||null});
}
async function markResourceFailure(r,jobId,error,eventType='RESOURCE_FAILURE',releaseJob=true,context={}){
  const kind=error?.kind||'outage',policy=failurePolicy(kind),health=failureHealth(kind);
  const rateLimited=kind==='rate_limit';
  let cooldownUntil=new Date(Date.now()+policy.cooldownMs).toISOString(),quotaPatch=null;
  if(rateLimited){const currentQuota=(await pool.query('select quota_state from tigeriq_ai_resources where resource_id=$1',[r.resourceId])).rows[0]?.quota_state||{};const state=rateLimitFailureState(currentQuota,policy.cooldownMs);cooldownUntil=state.cooldownUntil;quotaPatch=state.quotaPatch;}
  await pool.query("update tigeriq_ai_resources set current_job_id=case when $5 then null else current_job_id end,work_state=case when $5 then $2 else case when current_job_id is null then $2 else 'BUSY' end end,health_state=$3,cooldown_until=$4,last_seen_at=now(),failure_count=failure_count+1,quota_state=case when $6::jsonb is null then quota_state else coalesce(quota_state,'{}'::jsonb)||$6::jsonb end,last_429_at=case when $7 then now() else last_429_at end,updated_at=now() where resource_id=$1",[r.resourceId,health,health,cooldownUntil,releaseJob,quotaPatch?JSON.stringify(quotaPatch):null,rateLimited]);
  await pool.query("update tigeriq_resources set current_job_id=case when $5 then null else current_job_id end,work_state=case when $5 then $2 else case when current_job_id is null then $2 else 'BUSY' end end,health_state=$3,cooldown_until=$4,last_seen_at=now(),failure_count=failure_count+1,updated_at=now() where employee_id=$1",[r.id,health,health,cooldownUntil,releaseJob]);
  await event(eventType,{jobId,employeeId:r.id,resourceId:r.resourceId,provider:r.provider,kind,message:String(error?.code||error?.message||error).slice(0,300),cooldownUntil,taskKind:context.taskKind||null,routingProfile:context.profile||null,quota:quotaPatch});
  const quarantine=await maybeQuarantineResource(r);return {kind,health,cooldownUntil,quarantine,policy};
}
async function refreshResources() {
  const staleOllama=(await pool.query("select employee_id,current_job_id from tigeriq_resources where provider='ollama' and employee_id not in ($1,$2)",[NV09_EMPLOYEE_ID,OLLAMA_EMPLOYEE_ID])).rows;
  if(staleOllama.some(x=>x.current_job_id))throw new Error('STALE_OLLAMA_IDENTITY_BUSY');
  for(const stale of staleOllama){await pool.query("delete from tigeriq_resources where employee_id=$1 and provider='ollama'",[stale.employee_id]);await event('RESOURCE_IDENTITY_MIGRATED',{fromEmployeeId:stale.employee_id,allowedEmployeeIds:[NV09_EMPLOYEE_ID,OLLAMA_EMPLOYEE_ID],provider:'ollama'});}
  for (const r of resources) {
    const staleSameEmployee=(await pool.query("select resource_id,current_job_id from tigeriq_ai_resources where employee_id=$1 and resource_id<>$2 and enabled=true",[r.id,r.resourceId])).rows;
    if(staleSameEmployee.some(x=>x.current_job_id))throw new Error(`STALE_RESOURCE_IDENTITY_BUSY:${r.id}`);
    for(const stale of staleSameEmployee){
      await pool.query("update tigeriq_ai_resources set enabled=false,credential_state='BLOCKED',health_state='OFFLINE',work_state='OFFLINE',current_job_id=null,cooldown_until=null,updated_at=now() where resource_id=$1",[stale.resource_id]);
      await event('RESOURCE_IDENTITY_SUPERSEDED',{employeeId:r.id,resourceId:r.resourceId,legacyResourceId:stale.resource_id,provider:r.provider});
    }
    const legacyResourceId=createResourceId(r.provider,r.accountBinding);
    if(legacyResourceId!==r.resourceId){const legacy=(await pool.query('select enabled,current_job_id from tigeriq_ai_resources where resource_id=$1',[legacyResourceId])).rows[0];if(legacy?.current_job_id)throw new Error(`LEGACY_RESOURCE_ID_BUSY:${legacyResourceId}`);if(legacy?.enabled!==false&&legacy){await pool.query('update tigeriq_ai_resources set enabled=false,updated_at=now() where resource_id=$1',[legacyResourceId]);await event('RESOURCE_IDENTITY_SUPERSEDED',{employeeId:r.id,resourceId:r.resourceId,legacyResourceId,provider:r.provider});}}
    let credential = r.provider === 'ollama' ? 'LOCAL' : (!credentialPresent(r) ? 'WAIT_KEY' : (reqReady(r) ? 'READY' : 'BLOCKED'));
    let health = credential === 'WAIT_KEY' || credential === 'BLOCKED' ? 'OFFLINE' : 'READY';
    const old = (await pool.query('select health_state,work_state,last_seen_at,cooldown_until,current_job_id from tigeriq_ai_resources where resource_id=$1',[r.resourceId])).rows[0];
    if (r.provider === 'openclaw') { const gateway=await probeOpenClawGateway(); credential='LOCAL'; health=gateway.ok?'ONLINE':'OFFLINE'; }
    else if (r.id === NV09_EMPLOYEE_ID) {
      credential='LOCAL';
      const availability=await nv09ModelAvailability();
      const cooldownActive=old?.cooldown_until && new Date(old.cooldown_until)>new Date();
      const recentlyVerified=old?.health_state==='ONLINE' && old?.last_seen_at && (Date.now()-new Date(old.last_seen_at).getTime())<900000;
      if(!availability.ok)health='OFFLINE';
      else if(cooldownActive&&['ERROR','RATE_LIMITED'].includes(old?.health_state))health=old.health_state;
      else health=recentlyVerified?'ONLINE':'READY';
    }
    else if (r.provider === 'ollama') { try { await fetchJson('http://127.0.0.1:11434/api/tags',{},3000); health='ONLINE'; } catch { health='OFFLINE'; } }
    else if (old?.health_state === 'ONLINE' && old?.last_seen_at && (Date.now()-new Date(old.last_seen_at).getTime()) < 900000) health='ONLINE';
    else if (old?.health_state === 'RATE_LIMITED' || old?.health_state === 'ERROR' || old?.health_state === 'OFFLINE') health=old.health_state;
    if (r.provider !== 'ollama' && old?.health_state === 'RATE_LIMITED' && old?.cooldown_until && new Date(old.cooldown_until) > new Date()) health='RATE_LIMITED';
    const work = old?.current_job_id ? 'BUSY' : (r.id===NV09_EMPLOYEE_ID && ['READY','ONLINE'].includes(health) ? 'ON_DEMAND' : (health === 'ONLINE' ? 'IDLE' : (health === 'READY' ? 'READY' : health)));
    await pool.query(`insert into tigeriq_ai_resources(resource_id,employee_id,name,provider,model,account_binding,runtime_binding,cost_tier,credential_state,health_state,work_state,current_job_id,capabilities,rank,updated_at)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,now())
      on conflict(resource_id) do update set employee_id=excluded.employee_id,name=excluded.name,provider=excluded.provider,model=excluded.model,account_binding=excluded.account_binding,runtime_binding=excluded.runtime_binding,cost_tier=excluded.cost_tier,credential_state=excluded.credential_state,health_state=case when tigeriq_ai_resources.current_job_id is null then excluded.health_state else tigeriq_ai_resources.health_state end,work_state=case when tigeriq_ai_resources.current_job_id is null then excluded.work_state else 'BUSY' end,capabilities=excluded.capabilities,rank=excluded.rank,updated_at=now()`,[r.resourceId,r.id,r.name,r.provider,r.model,r.accountBinding,r.runtimeBinding,r.costTier,credential,health,work,old?.current_job_id||null,r.capabilities,r.rank]);
    await pool.query(`insert into tigeriq_resources(employee_id,name,provider,model,credential_state,health_state,work_state,current_job_id,capabilities,rank,updated_at)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now())
      on conflict(employee_id) do update set name=excluded.name,provider=excluded.provider,model=excluded.model,credential_state=excluded.credential_state,health_state=excluded.health_state,work_state=excluded.work_state,current_job_id=excluded.current_job_id,capabilities=excluded.capabilities,rank=excluded.rank,updated_at=now()`,[r.id,r.name,r.provider,r.model,credential,health,work,old?.current_job_id||null,r.capabilities,r.rank]);
    if(r.provider==='openclaw')await pool.query("update tigeriq_ai_resources set enabled=$2,credential_state='LOCAL',health_state=$3,work_state=case when current_job_id is null then $4 else 'BUSY' end,updated_at=now() where resource_id=$1",[r.resourceId,openClawResourceActivated(),health,health==='ONLINE'?'IDLE':'OFFLINE']);
  }
}
async function recoverAfterCoreRestart() {
  try {
    await pool.query("UPDATE tigeriq_jobs SET status='failed', failure=jsonb_build_object('message','RESTART_RECONCILIATION_FAIL_CLOSED'), lease_until=null, completed_at=coalesce(completed_at,now()) WHERE status IN ('dispatching', 'running') AND capability<>'pc_operator'");
    await pool.query("update tigeriq_ai_resources r set current_job_id=null,work_state=case when health_state='ONLINE' then 'IDLE' else health_state end,updated_at=now() where current_job_id is not null and not exists(select 1 from tigeriq_jobs j where j.id=r.current_job_id and j.status in ('dispatching','running'))");
    await pool.query("update tigeriq_resources r set current_job_id=null,work_state=case when health_state='ONLINE' then 'IDLE' else health_state end,updated_at=now() where current_job_id is not null and not exists(select 1 from tigeriq_jobs j where j.id=r.current_job_id and j.status in ('dispatching','running'))");
    await pool.query("update tigeriq_jobs j set status='done',result=coalesce(result,'{}'::jsonb)||jsonb_build_object('skipped','legacy_nv10_unavailable_reclassified'),failure=null,lease_until=null,completed_at=coalesce(completed_at,now()) where j.kind='api_doctor' and j.status='failed' and j.employee_id is null and j.resource_id is null and j.provider is null and exists(select 1 from tigeriq_events e where e.job_id=j.id and e.type='API_DOCTOR_ANALYSIS_SKIPPED' and e.data->>'reason'='nv10_unavailable')");
    const openclawJobs=(await pool.query("select id,employee_id,resource_id from tigeriq_jobs where status in ('dispatching','running') and capability='pc_operator'")).rows;
    for(const j of openclawJobs){
      await pool.query("update tigeriq_jobs set status='queued',employee_id=null,resource_id=null,provider=null,lease_until=null,completed_at=null where id=$1",[j.id]);
      if(j.resource_id)await pool.query("update tigeriq_ai_resources set current_job_id=null,work_state=case when health_state='ONLINE' then 'IDLE' else health_state end,updated_at=now() where resource_id=$1",[j.resource_id]);
      if(j.employee_id)await pool.query("update tigeriq_resources set current_job_id=null,work_state=case when health_state='ONLINE' then 'IDLE' else health_state end,updated_at=now() where employee_id=$1",[j.employee_id]);
      await event('OPENCLAW_JOB_RECOVERED_AFTER_CORE_RESTART',{jobId:j.id,employeeId:j.employee_id,resourceId:j.resource_id});
    }
  } catch (e) {
    console.error(JSON.stringify({ event: 'RECOVERY_RECONCILIATION_ERROR', error: String(e?.message || e) }));
  }
  const q=await pool.query("select id,employee_id,resource_id from tigeriq_jobs where status='running' and kind='ai'");
  for(const j of q.rows){await pool.query("update tigeriq_jobs set status='queued',employee_id=null,resource_id=null,provider=null,lease_until=null where id=$1",[j.id]);if(j.resource_id)await pool.query("update tigeriq_ai_resources set current_job_id=null,work_state='IDLE',health_state=case when credential_state in ('WAIT_KEY','BLOCKED') then 'OFFLINE' else 'READY' end,updated_at=now() where resource_id=$1",[j.resource_id]);if(j.employee_id)await pool.query("update tigeriq_resources set current_job_id=null,work_state='IDLE',health_state=case when credential_state in ('WAIT_KEY','BLOCKED') then 'OFFLINE' else 'READY' end,updated_at=now() where employee_id=$1",[j.employee_id]);await event('JOB_RECOVERED_AFTER_CORE_RESTART',{jobId:j.id,employeeId:j.employee_id,resourceId:j.resource_id});}
}
async function reconcileExhaustedQueuedJobs(){
  const reason={kind:'RETRY_BUDGET_EXHAUSTED',message:'Queued job exhausted retry budget and is not claimable.'};
  const q=await pool.query(`update tigeriq_jobs j
    set status='failed',lease_until=null,next_attempt_at=null,completed_at=coalesce(completed_at,now()),failure=coalesce(failure,'{}'::jsonb)||$1::jsonb
    where j.status in ('queued','waiting_resource') and j.attempts>=j.max_attempts
      and exists(select 1 from tigeriq_objectives o where o.id=j.objective_id and o.status='active')
    returning j.id,j.objective_id,j.employee_id,j.resource_id,j.attempts,j.max_attempts`,[JSON.stringify(reason)]);
  for(const j of q.rows){
    await pool.query("update tigeriq_ai_resources set current_job_id=null,work_state=case when health_state='ONLINE' then 'IDLE' else health_state end,updated_at=now() where current_job_id=$1",[j.id]);
    await pool.query("update tigeriq_resources set current_job_id=null,work_state=case when health_state='ONLINE' then 'IDLE' else health_state end,updated_at=now() where current_job_id=$1",[j.id]);
    await event('JOB_EXHAUSTED_QUEUE_RECONCILED',{jobId:j.id,objectiveId:j.objective_id,employeeId:j.employee_id,resourceId:j.resource_id,attempts:Number(j.attempts)||0,maxAttempts:Number(j.max_attempts)||0});
  }
  return q.rowCount||0;
}
async function recoverStale() {
  await reconcileExhaustedQueuedJobs();
  const staleDoctor=await pool.query("select id,employee_id,resource_id from tigeriq_jobs where status='running' and kind='api_doctor' and started_at < now()-interval '2 minutes' and (lease_until is null or lease_until < now())");
  for(const j of staleDoctor.rows){
    await pool.query("update tigeriq_jobs set status='done',result=jsonb_build_object('skipped','stale_recovered'),lease_until=null,completed_at=now() where id=$1",[j.id]);
    await pool.query("update tigeriq_ai_resources set current_job_id=null,work_state=case when health_state='ONLINE' then 'IDLE' else health_state end,updated_at=now() where current_job_id=$1",[j.id]);
    await pool.query("update tigeriq_resources set current_job_id=null,work_state=case when health_state='ONLINE' then 'IDLE' else health_state end,updated_at=now() where current_job_id=$1",[j.id]);
    await event('API_DOCTOR_STALE_JOB_RECOVERED',{jobId:j.id,employeeId:j.employee_id,resourceId:j.resource_id});
  }
  const stale=await pool.query("select id,objective_id,employee_id,resource_id,attempts,max_attempts from tigeriq_jobs where status='running' and kind<>'api_doctor' and lease_until < now()");
  for(const j of stale.rows){
    const plan=staleLeaseRecoveryPlan({attempts:j.attempts,maxAttempts:j.max_attempts});
    if(plan.exhausted){
      const failure={kind:'RETRY_BUDGET_EXHAUSTED_AFTER_LEASE_RECOVERY',message:'Stale lease recovery reached the retry budget.',attempts:plan.nextAttempts,maxAttempts:plan.maxAttempts};
      await pool.query("update tigeriq_jobs set status='failed',employee_id=null,resource_id=null,provider=null,lease_until=null,next_attempt_at=null,attempts=$2,failure=$3,completed_at=now() where id=$1",[j.id,plan.nextAttempts,JSON.stringify(failure)]);
      if(j.resource_id)await pool.query("update tigeriq_ai_resources set current_job_id=null,work_state='IDLE',health_state='READY',updated_at=now() where resource_id=$1",[j.resource_id]);
      if(j.employee_id)await pool.query("update tigeriq_resources set current_job_id=null,work_state='IDLE',health_state='READY',updated_at=now() where employee_id=$1",[j.employee_id]);
      await event('JOB_LEASE_RECOVERY_EXHAUSTED',{jobId:j.id,objectiveId:j.objective_id,employeeId:j.employee_id,resourceId:j.resource_id,attempts:plan.nextAttempts,maxAttempts:plan.maxAttempts});
      continue;
    }
    await pool.query("update tigeriq_jobs set status='queued',employee_id=null,resource_id=null,provider=null,lease_until=null,attempts=$2 where id=$1",[j.id,plan.nextAttempts]);
    if(j.resource_id)await pool.query("update tigeriq_ai_resources set current_job_id=null,work_state='IDLE',health_state='READY',updated_at=now() where resource_id=$1",[j.resource_id]);
    if(j.employee_id)await pool.query("update tigeriq_resources set current_job_id=null,work_state='IDLE',health_state='READY',updated_at=now() where employee_id=$1",[j.employee_id]);
    await event('JOB_LEASE_RECOVERED',{jobId:j.id,objectiveId:j.objective_id,employeeId:j.employee_id,resourceId:j.resource_id,attempts:plan.nextAttempts,maxAttempts:plan.maxAttempts});
  }
}
async function taskPerformance(taskKind='general'){
  const q=await pool.query(`select resource_id,count(*) filter(where type in ('RESOURCE_SUCCESS','RESOURCE_PROBE_OK'))::int as success,count(*) filter(where type in ('RESOURCE_FAILURE','RESOURCE_PROBE_FAIL'))::int as failure,count(*) filter(where type='ROUTING_RETRY')::int as retry,count(*) filter(where type='ROUTING_FAILOVER')::int as failover,round(avg((data->>'latencyMs')::numeric) filter(where data ? 'latencyMs'))::int as avg_latency_ms from tigeriq_events where resource_id is not null and ts>=now()-interval '7 days' and (task_kind=$1 or task_kind is null or $1='general') group by resource_id`,[taskKind]);
  return new Map(q.rows.map(x=>[x.resource_id,{success:Number(x.success||0),failure:Number(x.failure||0),retry:Number(x.retry||0),failover:Number(x.failover||0),avgLatencyMs:Number(x.avg_latency_ms||0)}]));
}
async function candidates(capability='general',options={}){
  const q=await pool.query(`select * from tigeriq_ai_resources where enabled=true and credential_state in ('LOCAL','READY') and health_state in ('READY','ONLINE') and current_job_id is null`);const taskKind=String(options.taskKind||'general');const stats=await taskPerformance(taskKind);const rows=q.rows.map(x=>({...x,taskStats:{[taskKind]:stats.get(x.resource_id)||{}}}));return rankCandidates(rows,{profile:deriveRoutingProfile({requested:options.profile,taskKind,capability}),capability,taskKind,reviewerResourceId:options.reviewerResourceId||null,reviewerResourceIds:options.reviewerResourceIds||[]});
}
async function claimResource(capability,jobId,excluded=[],options={}){
  const taskKind=String(options.taskKind||'general'),profile=deriveRoutingProfile({requested:options.profile,taskKind,capability});
  const q=await pool.query(`select * from tigeriq_ai_resources where enabled=true and credential_state in ('LOCAL','READY') and health_state in ('READY','ONLINE') and current_job_id is null`);
  const stats=await taskPerformance(taskKind);
  const preferredEmployeeId=String(options.preferredEmployeeId||'').trim().toUpperCase();
  let candidates=q.rows.filter(x=>!excluded.includes(x.resource_id));
  if(preferredEmployeeId)candidates=candidates.filter(x=>String(x.employee_id||'').toUpperCase()===preferredEmployeeId);
  const rows=candidates.map(x=>({...x,taskStats:{[taskKind]:stats.get(x.resource_id)||{}}}));
  const decision=rankCandidates(rows,{profile,capability,taskKind,reviewerResourceId:options.reviewerResourceId||null,reviewerResourceIds:options.reviewerResourceIds||[]});
  if(!decision.chosen)return null;
  const client=await pool.connect();
  try{
    await client.query('begin');
    const locked=await client.query(`select * from tigeriq_ai_resources where resource_id=$1 and enabled=true and credential_state in ('LOCAL','READY') and health_state in ('READY','ONLINE') and current_job_id is null and (cooldown_until is null or cooldown_until<=now()) for update skip locked`,[decision.chosen.resourceId]);
    const r=locked.rows[0];if(!r){await client.query('commit');return null;}
    await client.query("update tigeriq_ai_resources set current_job_id=$2,work_state='BUSY',updated_at=now() where resource_id=$1",[r.resource_id,jobId]);
    await client.query('commit');
    const evidence={profile,taskKind,capability,preferredEmployeeId:preferredEmployeeId||null,candidates:decision.candidates,chosen:decision.chosen};
    await pool.query("update tigeriq_jobs set routing_profile=$2,routing_decision=$3 where id=$1",[jobId,profile,JSON.stringify(evidence)]).catch(()=>{});
    await event('ROUTING_DECISION',{jobId,employeeId:r.employee_id,resourceId:r.resource_id,provider:r.provider,taskKind,profile,decision:evidence});
    return {...r,routingProfile:profile,routingDecision:evidence};
  }catch(e){await client.query('rollback');throw e;}finally{client.release();}
}

async function invokeRouted(prompt,capability,jobId,maxAttempts=3,options={}){
  if(capability==='coding'){const e=new Error('LOCAL_CODING_DISABLED_GITHUB_ONLY');e.kind='configuration';throw e;}const taskKind=String(options.taskKind||'general'),profile=deriveRoutingProfile({requested:options.profile,taskKind,capability});const failures=[],excluded=[];for(let i=0;i<maxAttempts;i++){const row=await claimResource(capability,jobId,excluded,{...options,profile,taskKind});if(!row)break;excluded.push(row.resource_id);const r=resources.find(x=>x.resourceId===row.resource_id);if(!r)continue;await pool.query("update tigeriq_jobs set employee_id=$2,resource_id=$3,provider=$4,routing_profile=$5,routing_decision=$6,attempts=attempts+1,lease_until=now()+interval '5 minutes' where id=$1",[jobId,r.id,r.resourceId,r.provider,profile,JSON.stringify(row.routingDecision)]);const started=Date.now();try{const text=await invokeProvider(r,prompt),latency=Date.now()-started;await markResourceSuccess(r,jobId,latency,'RESOURCE_SUCCESS',true,{taskKind,profile});return{text,resource:r,latencyMs:latency,failures,routingProfile:profile,routingDecision:row.routingDecision};}catch(error){let finalError=error,policy=failurePolicy(error?.kind||'outage');if(policy.retrySameResource){await event('ROUTING_RETRY',{jobId,employeeId:r.id,resourceId:r.resourceId,provider:r.provider,taskKind,profile,kind:policy.kind});try{const retryStarted=Date.now(),text=await invokeProvider(r,prompt),latency=Date.now()-retryStarted;await markResourceSuccess(r,jobId,latency,'RESOURCE_SUCCESS',true,{taskKind,profile});return{text,resource:r,latencyMs:latency,failures,routingProfile:profile,routingDecision:row.routingDecision};}catch(retryError){finalError=retryError;policy=failurePolicy(retryError?.kind||policy.kind);}}const kind=finalError?.kind||'outage';failures.push({employeeId:r.id,resourceId:r.resourceId,provider:r.provider,kind,message:String(finalError?.message||finalError)});await markResourceFailure(r,jobId,finalError,'RESOURCE_FAILURE',true,{taskKind,profile});if(policy.failover)await event('ROUTING_FAILOVER',{jobId,employeeId:r.id,resourceId:r.resourceId,provider:r.provider,taskKind,profile,kind});if(policy.stop)break;}}const e=new Error('NO_AI_RESOURCE_AVAILABLE');e.failures=failures;throw e;
}
async function runNv09Canary(inputPrompt=''){
  const r=nv09Resource;
  const id=`NV09-CANARY-${randomUUID()}`;
  const marker='NV09_CORE_CANARY_OK';
  const prompt=String(inputPrompt||`Evaluate this JavaScript expression: (2 + 3) === 5. If it is true, return exactly ${marker} and nothing else.`).trim().slice(0,1000);
  const availability=await nv09ModelAvailability();
  if(!availability.ok)return {ok:false,employeeId:r.id,resourceId:r.resourceId,model:r.model,error:availability.reason,availability};
  const claimed=await pool.query("update tigeriq_ai_resources set current_job_id=$2,work_state='BUSY',updated_at=now() where resource_id=$1 and enabled=true and current_job_id is null returning resource_id",[r.resourceId,id]);
  if(!claimed.rowCount)return {ok:false,employeeId:r.id,resourceId:r.resourceId,model:r.model,error:'NV09_RESOURCE_BUSY'};
  await pool.query("update tigeriq_resources set current_job_id=$2,work_state='BUSY',updated_at=now() where employee_id=$1",[r.id,id]);
  await pool.query("insert into tigeriq_jobs(id,objective_id,title,prompt,capability,kind,status,employee_id,resource_id,provider,routing_profile,routing_decision,started_at,attempts,max_attempts) values($1,null,$2,$3,'coding_local','nv09_canary','running',$4,$5,'ollama','NV09_ON_DEMAND',$6,now(),1,1)",[id,'NV09 Core coding-safe live canary',prompt,r.id,r.resourceId,JSON.stringify({authority:'CORE',chosen:{employeeId:r.id,resourceId:r.resourceId,provider:r.provider,model:r.model},reason:'EXPLICIT_NV09_CANARY'})]);
  await event('ROUTING_DECISION',{jobId:id,employeeId:r.id,resourceId:r.resourceId,provider:r.provider,taskKind:'coding_canary',profile:'NV09_ON_DEMAND',decision:{chosen:{employeeId:r.id,resourceId:r.resourceId,model:r.model},explicit:true}});
  const started=Date.now();
  try{
    const inference=await runBoundedInferenceNv09(prompt,{timeoutMs:NV09_TIMEOUT_MS,numCtx:1024,numPredict:96,keepAlive:'30s'});
    const latency=Date.now()-started;
    if(!String(inference.text||'').includes(marker)){const e=new Error('NV09_CANARY_MARKER_MISSING');e.kind='invalid_response';throw e;}
    await markResourceSuccess(r,id,latency,'RESOURCE_SUCCESS',true,{taskKind:'coding_canary',profile:'NV09_ON_DEMAND'});
    const result={ok:true,employeeId:r.id,resourceId:r.resourceId,provider:r.provider,model:r.model,digest:availability.digest||null,size:availability.size||null,latencyMs:latency,text:String(inference.text).slice(0,300),evalCount:inference.evalCount,loadDurationNs:inference.loadDurationNs,evalDurationNs:inference.evalDurationNs};
    await pool.query("update tigeriq_jobs set status='done',result=$2,lease_until=null,completed_at=now() where id=$1",[id,JSON.stringify(result)]);
    await event('NV09_CANARY_PASS',{jobId:id,employeeId:r.id,resourceId:r.resourceId,provider:r.provider,taskKind:'coding_canary',latencyMs:latency,model:r.model,digest:availability.digest||null});
    return {jobId:id,...result};
  }catch(error){
    const latency=Date.now()-started;
    await markResourceFailure(r,id,error,'RESOURCE_FAILURE',true,{taskKind:'coding_canary',profile:'NV09_ON_DEMAND'});
    const failure={message:String(error?.message||error).slice(0,700),kind:String(error?.kind||'outage'),latencyMs:latency};
    await pool.query("update tigeriq_jobs set status='failed',failure=$2,lease_until=null,completed_at=now() where id=$1",[id,JSON.stringify(failure)]);
    await event('NV09_CANARY_FAIL',{jobId:id,employeeId:r.id,resourceId:r.resourceId,provider:r.provider,taskKind:'coding_canary',latencyMs:latency,model:r.model,message:failure.message,kind:failure.kind});
    return {ok:false,jobId:id,employeeId:r.id,resourceId:r.resourceId,provider:r.provider,model:r.model,digest:availability.digest||null,latencyMs:latency,error:failure.message,kind:failure.kind};
  }
}
async function probeResource(resourceOrEmployeeId){const r=resources.find(x=>x.resourceId===resourceOrEmployeeId||x.id===resourceOrEmployeeId);if(!r)throw new Error('RESOURCE_NOT_FOUND');if(!reqReady(r)&&!['ollama','openclaw'].includes(r.provider))throw new Error('RESOURCE_CREDENTIAL_NOT_READY');const started=Date.now();try{if(r.provider==='openclaw'){if(!openClawResourceActivated())throw Object.assign(new Error('OPENCLAW_RESOURCE_NOT_ACTIVATED'),{kind:'configuration'});const gateway=await probeOpenClawGateway();if(!gateway.ok)throw Object.assign(new Error('OPENCLAW_GATEWAY_UNAVAILABLE'),{kind:'outage'});const latency=Date.now()-started;await markResourceSuccess(r,null,latency,'RESOURCE_PROBE_OK',false,{taskKind:'probe',profile:'PC_OPERATOR'});return{ok:true,employeeId:r.id,resourceId:r.resourceId,provider:r.provider,latencyMs:latency};}const marker='TIGERIQ_RESOURCE_PROBE_'+r.id,text=await invokeProvider(r,'Return exactly '+marker);if(!String(text).includes(marker))throw Object.assign(new Error('PROBE_UNEXPECTED_RESPONSE'),{kind:'invalid_response'});const latency=Date.now()-started;await markResourceSuccess(r,null,latency,'RESOURCE_PROBE_OK',false,{taskKind:'probe',profile:'FAST'});return{ok:true,employeeId:r.id,resourceId:r.resourceId,provider:r.provider,latencyMs:latency};}catch(error){const result=await markResourceFailure(r,null,error,'RESOURCE_PROBE_FAIL',false,{taskKind:'probe',profile:'FAST'});const e=new Error('RESOURCE_PROBE_FAILED');e.kind=result.kind;throw e;}}
async function probeReadyResources(){const rows=(await pool.query("select resource_id,runtime_binding,credential_state,health_state,current_job_id,last_seen_at,cooldown_until from tigeriq_ai_resources where enabled=true and credential_state in ('LOCAL','READY') and current_job_id is null order by rank")).rows;const now=Date.now();for(const row of rows){if(row.runtime_binding==='ollama_on_demand')continue;const neverSeen=!row.last_seen_at,staleOnline=row.health_state==='ONLINE'&&row.last_seen_at&&(now-new Date(row.last_seen_at).getTime())>=900000;if(!neverSeen&&!staleOnline)continue;try{await probeResource(row.resource_id);}catch{}}}
async function apiDoctorRecentResourceEvents(resourceId){
  return (await pool.query(`select seq,ts,type,task_kind,data from tigeriq_events where resource_id=$1 and type in ('RESOURCE_SUCCESS','RESOURCE_PROBE_OK','RESOURCE_FAILURE','RESOURCE_PROBE_FAIL') and ts>=now()-interval '12 hours' order by seq desc limit 30`,[resourceId])).rows;
}
function consecutiveWorkFailureEvidence(events=[]){
  const work=(Array.isArray(events)?events:[]).filter(x=>String(x.task_kind||'')!=='probe'&&(x.type==='RESOURCE_SUCCESS'||x.type==='RESOURCE_FAILURE'));
  const failures=[];
  for(const row of work){
    if(row.type==='RESOURCE_SUCCESS')break;
    if(row.type==='RESOURCE_FAILURE')failures.push(row);
  }
  return failures;
}
async function apiDoctorEventBySignature(type,signature){
  return (await pool.query("select ts,data from tigeriq_events where type=$1 and data->>'signature'=$2 order by seq desc limit 1",[type,signature])).rows[0]||null;
}
async function apiDoctorLatestResourceHandoff(resourceId){
  return (await pool.query("select ts,data from tigeriq_events where type='API_DOCTOR_REPAIR_HANDOFF' and resource_id=$1 order by seq desc limit 1",[resourceId])).rows[0]||null;
}
async function apiDoctorLatestUnresolvedResourceHandoff(resourceId){
  const handoff=await apiDoctorLatestResourceHandoff(resourceId);
  if(!handoff)return null;
  const signature=String(handoff.data?.signature||'');
  const recovered=(await pool.query("select 1 from tigeriq_events where type='API_DOCTOR_RECOVERED' and resource_id=$1 and ts>$2 and ($3='' or data->>'signature'=$3) order by seq desc limit 1",[resourceId,handoff.ts,signature])).rows[0];
  return recovered?null:handoff;
}
async function apiDoctorLatestUnresolvedSignatureHandoff(resourceId,signature){
  if(!signature)return null;
  const handoff=(await pool.query("select ts,data from tigeriq_events where type='API_DOCTOR_REPAIR_HANDOFF' and resource_id=$1 and data->>'signature'=$2 order by seq desc limit 1",[resourceId,signature])).rows[0]||null;
  if(!handoff)return null;
  const recovered=(await pool.query("select 1 from tigeriq_events where type='API_DOCTOR_RECOVERED' and resource_id=$1 and ts>$2 and data->>'signature'=$3 order by seq desc limit 1",[resourceId,handoff.ts,signature])).rows[0];
  return recovered?null:handoff;
}
async function apiDoctorPostRepairValidationAttempts(resourceId,handoffAt){
  const row=(await pool.query("select count(*)::int as count from tigeriq_events where type='API_DOCTOR_POST_REPAIR_VALIDATION' and resource_id=$1 and ts>$2 and data->>'policyVersion'=$3",[resourceId,handoffAt,API_DOCTOR_VALIDATION_POLICY_VERSION])).rows[0];
  return Number(row?.count||0);
}
async function runApiDoctorPostRepairValidation(resource,existingHandoff){
  const r=resources.find(x=>x.resourceId===resource.resource_id);
  if(!r)return {ok:false,reason:'resource_definition_missing'};
  const signature=String(existingHandoff?.data?.signature||'');
  const id=`API-VAL-${randomUUID()}`;
  const prompt='Provide one short useful sentence confirming this provider can complete a normal TigerIQ Core reasoning request.';
  await pool.query("insert into tigeriq_jobs(id,objective_id,title,prompt,capability,kind,status,employee_id,resource_id,provider,routing_profile,started_at,attempts,max_attempts) values($1,null,$2,$3,'general','api_doctor_validation','running',$4,$5,$6,'VALIDATION',now(),1,1)",[id,`${r.id} post-repair live validation`,prompt,r.id,r.resourceId,r.provider]);
  const started=Date.now();
  try{
    const text=await invokeProvider(r,prompt);
    if(!String(text||'').trim()){const e=new Error('API_DOCTOR_VALIDATION_EMPTY_RESPONSE');e.kind='invalid_response';throw e;}
    const latency=Date.now()-started;
    await markResourceSuccess(r,id,latency,'RESOURCE_SUCCESS',true,{taskKind:'api_doctor_validation',profile:'VALIDATION'});
    await pool.query("update tigeriq_jobs set status='done',result=$2,lease_until=null,completed_at=now() where id=$1",[id,JSON.stringify({text:String(text).slice(0,300),latencyMs:latency,validation:true})]);
    await event('API_DOCTOR_POST_REPAIR_VALIDATION',{jobId:id,employeeId:r.id,resourceId:r.resourceId,provider:r.provider,taskKind:'api_doctor_validation',signature,policyVersion:API_DOCTOR_VALIDATION_POLICY_VERSION,ok:true,latencyMs:latency});
    return {ok:true,jobId:id,latencyMs:latency};
  }catch(error){
    await markResourceFailure(r,id,error,'RESOURCE_FAILURE',true,{taskKind:'api_doctor_validation',profile:'VALIDATION'});
    await pool.query("update tigeriq_jobs set status='failed',failure=$2,lease_until=null,completed_at=now() where id=$1",[id,JSON.stringify({message:String(error?.message||error).slice(0,300)})]);
    await event('API_DOCTOR_POST_REPAIR_VALIDATION',{jobId:id,employeeId:r.id,resourceId:r.resourceId,provider:r.provider,taskKind:'api_doctor_validation',signature,policyVersion:API_DOCTOR_VALIDATION_POLICY_VERSION,ok:false,message:String(error?.message||error).slice(0,200)});
    return {ok:false,jobId:id,reason:String(error?.kind||error?.message||error).slice(0,120)};
  }
}
async function createApiDoctorRepairHandoff(resource,failureClass,latestFailure){
  const message=String(latestFailure?.data?.message||latestFailure?.data?.kind||failureClass||'source_contract');
  const signature=apiDoctorRepairSignature({employeeId:resource.employee_id,provider:resource.provider,failureClass,message});
  const prior=await apiDoctorLatestUnresolvedSignatureHandoff(resource.resource_id,signature);
  if(prior)return {created:false,signature,codingObjectiveId:prior.data?.codingObjectiveId||null,priorAt:prior.ts};
  const objective=[
    `API Doctor source-contract repair for ${resource.employee_id} / ${resource.provider}.`,
    `Failure class: ${failureClass}. Evidence: ${message.slice(0,300)}.`,
    '',
    'CANONICAL ALLOWED PATHS (MUST NOT EXPAND):',
    'apps/tigeriq-core/core.mjs',
    'tests/api-doctor-provider-contract.test.mjs',
    '',
    'Goal: fix only the provider response/adapter behavior that causes healthy credentials/probes to fail real Core work. Preserve zero-cost/free-only behavior. Add focused regression coverage. Branch -> PR -> exact-head checks -> independent review. No direct main, credentials, billing, Production, browser auth, paid action, or destructive action.'
  ].join('\n');
  const response=await fetchJson(`${CODING_LANE_URL}/api/objectives`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({objective,priority:'P0'})},10000);
  await event('API_DOCTOR_REPAIR_HANDOFF',{employeeId:resource.employee_id,resourceId:resource.resource_id,provider:resource.provider,taskKind:'api_doctor',signature,failureClass,message:message.slice(0,300),codingObjectiveId:response?.id||null});
  return {created:true,signature,codingObjectiveId:response?.id||null};
}
async function invokeApiDoctorLocal(prompt){
  const body=await fetchJson('http://127.0.0.1:11434/api/generate',{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({model:process.env.TIGERIQ_OLLAMA_MODEL||'qwen3:4b',prompt,stream:false,think:false,format:'json',options:{temperature:0,num_predict:160}})
  },60000);
  return parseApiDoctorDecision(body?.response||'');
}
async function runApiDoctorAnalysisJob(items,scanSignature){
  const recent=(await pool.query("select 1 from tigeriq_events where type='API_DOCTOR_ANALYSIS_DONE' and data->>'signature'=$1 and ts>now()-($2::text||' milliseconds')::interval limit 1",[scanSignature,String(API_DOCTOR_ANALYSIS_DEDUPE_MS)])).rows[0];
  if(recent)return {skipped:'deduped'};
  const recentUnavailable=(await pool.query("select 1 from tigeriq_events where type='API_DOCTOR_ANALYSIS_SKIPPED' and data->>'signature'=$1 and data->>'reason'='nv10_unavailable' and ts>now()-($2::text||' milliseconds')::interval limit 1",[scanSignature,String(API_DOCTOR_ANALYSIS_DEDUPE_MS)])).rows[0];
  if(recentUnavailable)return {skipped:'deduped_nv10_unavailable'};
  const id=`API-DOC-${randomUUID()}`;
  const prompt=buildApiDoctorPrompt(items);
  await pool.query("insert into tigeriq_jobs(id,objective_id,title,prompt,capability,kind,status,started_at,lease_until,attempts,max_attempts) values($1,null,$2,$3,$4,'api_doctor','running',now(),now()+interval '2 minutes',0,1)",[id,'NV10 API Doctor analysis',prompt,API_DOCTOR_CAPABILITY]);
  const row=await claimResource(API_DOCTOR_CAPABILITY,id,[],{profile:'LOCAL',taskKind:'api_doctor'});
  if(!row){
    await pool.query("update tigeriq_jobs set status='done',result=$2,lease_until=null,completed_at=now() where id=$1",[id,JSON.stringify({skipped:'nv10_unavailable'})]);
    await event('API_DOCTOR_ANALYSIS_SKIPPED',{jobId:id,taskKind:'api_doctor',signature:scanSignature,reason:'nv10_unavailable'});
    return {skipped:'nv10_unavailable'};
  }
  const r=resources.find(x=>x.resourceId===row.resource_id);
  await pool.query("update tigeriq_jobs set employee_id=$2,resource_id=$3,provider=$4,routing_profile='LOCAL',lease_until=now()+interval '2 minutes' where id=$1",[id,r.id,r.resourceId,r.provider]);
  const started=Date.now();
  try{
    const decision=await invokeApiDoctorLocal(prompt);
    const latency=Date.now()-started;
    await markResourceSuccess(r,id,latency,'RESOURCE_SUCCESS',true,{taskKind:'api_doctor',profile:'LOCAL'});
    await pool.query("update tigeriq_jobs set status='done',employee_id=$2,resource_id=$3,provider=$4,routing_profile='LOCAL',result=$5,lease_until=null,completed_at=now() where id=$1",[id,r.id,r.resourceId,r.provider,JSON.stringify({decision,latencyMs:latency})]);
    await event('API_DOCTOR_ANALYSIS_DONE',{jobId:id,employeeId:r.id,resourceId:r.resourceId,provider:r.provider,taskKind:'api_doctor',signature:scanSignature,decision});
    return {ok:true,jobId:id,decision};
  }catch(error){
    await markResourceFailure(r,id,error,'RESOURCE_FAILURE',true,{taskKind:'api_doctor',profile:'LOCAL'});
    await pool.query("update tigeriq_jobs set status='failed',failure=$2,lease_until=null,completed_at=now() where id=$1",[id,JSON.stringify({message:String(error?.message||error)})]);
    await event('API_DOCTOR_ANALYSIS_FAILED',{jobId:id,employeeId:r.id,resourceId:r.resourceId,provider:r.provider,taskKind:'api_doctor',signature:scanSignature,message:String(error?.message||error).slice(0,200)});
    return {ok:false,jobId:id};
  }
}
async function runApiDoctorScan(){
  const rows=(await pool.query("select * from tigeriq_ai_resources where enabled=true and employee_id<>$1 order by employee_id",[OLLAMA_EMPLOYEE_ID])).rows;
  const actions=[];
  for(const resource of rows){
    const events=await apiDoctorRecentResourceEvents(resource.resource_id);
    const latestFailure=events.find(x=>x.type==='RESOURCE_FAILURE'||x.type==='RESOURCE_PROBE_FAIL')||null;
    const workFailures=consecutiveWorkFailureEvidence(events);
    const repeatedSourceFailures=workFailures.filter(x=>classifyApiDoctorFailure({kind:x.data?.kind,message:x.data?.message})==='source_contract').length;
    const plan=apiDoctorAction({healthState:resource.health_state,credentialState:resource.credential_state,cooldownUntil:resource.cooldown_until,latestFailure:latestFailure?{kind:latestFailure.data?.kind,message:latestFailure.data?.message}:null,repeatedWorkFailures:repeatedSourceFailures});
    const row={employeeId:resource.employee_id,resourceId:resource.resource_id,provider:resource.provider,health:resource.health_state,failureClass:plan.failureClass,action:plan.action,reason:plan.reason};
    if(resource.current_job_id){row.action='busy_skip';row.reason='resource_busy';actions.push(row);continue;}
    if(plan.action==='external_blocked'){
      const signature=apiDoctorRepairSignature({employeeId:resource.employee_id,provider:resource.provider,failureClass:plan.failureClass,message:latestFailure?.data?.message||plan.reason});
      if(!await apiDoctorEventBySignature('API_DOCTOR_EXTERNAL_BLOCKED',signature))await event('API_DOCTOR_EXTERNAL_BLOCKED',{employeeId:resource.employee_id,resourceId:resource.resource_id,provider:resource.provider,taskKind:'api_doctor',signature,failureClass:plan.failureClass,reason:plan.reason});
      actions.push(row);continue;
    }
    const existingHandoff=await apiDoctorLatestUnresolvedResourceHandoff(resource.resource_id);
    if(existingHandoff){
      const successAfter=(await pool.query("select 1 from tigeriq_events where resource_id=$1 and type='RESOURCE_SUCCESS' and coalesce(task_kind,'')<>'probe' and coalesce(task_kind,'')<>'api_doctor' and ts>$2 order by seq desc limit 1",[resource.resource_id,existingHandoff.ts])).rows[0];
      const validationAttempts=await apiDoctorPostRepairValidationAttempts(resource.resource_id,existingHandoff.ts);
      const handoffPlan=apiDoctorExistingHandoffAction({
        existingHandoff:true,
        successAfterHandoff:Boolean(successAfter),
        cooldownUntil:resource.cooldown_until,
        validationAttempts,
        maxValidationAttempts:2,
      });
      if(handoffPlan.action==='recovered'){
        const signature=existingHandoff.data?.signature;
        if(signature&&!await apiDoctorEventBySignature('API_DOCTOR_RECOVERED',signature))await event('API_DOCTOR_RECOVERED',{employeeId:resource.employee_id,resourceId:resource.resource_id,provider:resource.provider,taskKind:'api_doctor',signature,evidence:'live_work_success_after_handoff'});
        row.action='recovered';row.reason=handoffPlan.reason;row.recovered=true;actions.push(row);continue;
      }
      if(handoffPlan.action==='validate_repair'){
        row.action='validate_repair';row.reason=handoffPlan.reason;row.handoff='deduped';row.validationAttempts=validationAttempts;row.codingObjectiveId=existingHandoff.data?.codingObjectiveId||null;
        try{
          const probe=await probeResource(resource.resource_id);
          row.postRepairProbe=probe?.ok?'ok':'failed';
        }catch(error){
          row.postRepairProbe='failed';row.validationError=String(error?.kind||error?.message||error).slice(0,120);
          await event('API_DOCTOR_POST_REPAIR_VALIDATION',{employeeId:resource.employee_id,resourceId:resource.resource_id,provider:resource.provider,taskKind:'api_doctor_validation',signature:existingHandoff.data?.signature||'',policyVersion:API_DOCTOR_VALIDATION_POLICY_VERSION,ok:false,phase:'probe',message:row.validationError});
          actions.push(row);continue;
        }
        const validation=await runApiDoctorPostRepairValidation(resource,existingHandoff);
        row.validationJobId=validation.jobId||null;row.validation=validation.ok?'ok':'failed';
        if(validation.ok){
          const signature=existingHandoff.data?.signature;
          if(signature&&!await apiDoctorEventBySignature('API_DOCTOR_RECOVERED',signature))await event('API_DOCTOR_RECOVERED',{employeeId:resource.employee_id,resourceId:resource.resource_id,provider:resource.provider,taskKind:'api_doctor',signature,evidence:'post_repair_live_validation_job'});
          row.action='recovered';row.reason='post_repair_live_validation_job';row.recovered=true;
        }
        actions.push(row);continue;
      }
      row.action='wait_repair';row.reason=handoffPlan.reason;row.handoff='deduped';row.validationAttempts=validationAttempts;row.codingObjectiveId=existingHandoff.data?.codingObjectiveId||null;actions.push(row);continue;
    }
    if(plan.action==='wait'||plan.action==='idle'){actions.push(row);continue;}
    let probeOk=false;
    try{
      const probe=await probeResource(resource.resource_id);
      probeOk=Boolean(probe?.ok);
      row.probe='ok';
    }catch(error){row.probe='failed';row.probeError=String(error?.kind||error?.message||error).slice(0,120);}
    if(plan.action==='probe_then_handoff'&&probeOk&&repeatedSourceFailures>=2){
      const handoff=await createApiDoctorRepairHandoff(resource,plan.failureClass,latestFailure);
      row.handoff=handoff.created?'created':'deduped';
      row.codingObjectiveId=handoff.codingObjectiveId||null;
    }
    actions.push(row);
  }
  const degraded=actions.filter(x=>!['idle'].includes(x.action));
  const scanSignature=apiDoctorRepairSignature({employeeId:'SCAN',provider:'core',failureClass:'state',message:degraded.map(x=>`${x.employeeId}:${x.action}:${x.failureClass}`).join(',')});
  const analysis=degraded.length?await runApiDoctorAnalysisJob(degraded,scanSignature):{skipped:'no_degraded'};
  await event('API_DOCTOR_SCAN',{employeeId:OLLAMA_EMPLOYEE_ID,resourceId:nv10Resource.resourceId,provider:'ollama',taskKind:'api_doctor',signature:scanSignature,degradedCount:degraded.length,actions,analysis:analysis?.ok===true?'done':analysis?.skipped||'failed'});
  return {degradedCount:degraded.length,actions,analysis};
}
async function apiDoctorTelemetry(){
  const last=(await pool.query("select ts,data from tigeriq_events where type='API_DOCTOR_SCAN' order by seq desc limit 1")).rows[0]||null;
  const counts=(await pool.query(`select type,count(*)::int as count from tigeriq_events where type in ('API_DOCTOR_REPAIR_HANDOFF','API_DOCTOR_RECOVERED','API_DOCTOR_EXTERNAL_BLOCKED','API_DOCTOR_ANALYSIS_DONE','API_DOCTOR_POST_REPAIR_VALIDATION') and ts>=now()-interval '24 hours' group by type`)).rows;
  const map=Object.fromEntries(counts.map(x=>[x.type,Number(x.count||0)]));
  return {
    lastScanAt:last?.ts||null,
    degradedProviders:last?.data?.actions?.filter?.(x=>!['idle'].includes(x.action))||[],
    actions:last?.data?.actions||[],
    handoffs24h:map.API_DOCTOR_REPAIR_HANDOFF||0,
    recovered24h:map.API_DOCTOR_RECOVERED||0,
    externalBlockers24h:map.API_DOCTOR_EXTERNAL_BLOCKED||0,
    analyses24h:map.API_DOCTOR_ANALYSIS_DONE||0,
    postRepairValidations24h:map.API_DOCTOR_POST_REPAIR_VALIDATION||0,
  };
}

const RESOURCE_WAIT_MAX_RETRIES=6;
const RESOURCE_WAIT_MAX_WINDOW_MS=60*60*1000;
const RESOURCE_WAIT_BASE_MS=30*1000;
const RESOURCE_WAIT_MAX_DELAY_MS=10*60*1000;

export function resourceWaitPlan({waitCount=0,startedAt=null,nowMs=Date.now(),maxRetries=RESOURCE_WAIT_MAX_RETRIES,maxWindowMs=RESOURCE_WAIT_MAX_WINDOW_MS}={}){
  const count=Math.max(0,Number(waitCount)||0);
  const startedMs=startedAt?new Date(startedAt).getTime():nowMs;
  const ageMs=Math.max(0,nowMs-(Number.isFinite(startedMs)?startedMs:nowMs));
  if(count>=maxRetries||ageMs>=maxWindowMs)return {wait:false,count,ageMs,delayMs:0,nextAttemptAt:null};
  const delayMs=Math.min(RESOURCE_WAIT_MAX_DELAY_MS,RESOURCE_WAIT_BASE_MS*Math.pow(2,count));
  return {wait:true,count:count+1,ageMs,delayMs,nextAttemptAt:new Date(nowMs+delayMs).toISOString()};
}

export function shouldWaitForBusyResource({message='',failures=[],busyCapableCount=0}={}){
  return String(message)==='NO_AI_RESOURCE_AVAILABLE'&&Array.isArray(failures)&&failures.length===0&&Number(busyCapableCount)>0;
}

async function busyCapableResourceCount(capability){
  const q=await pool.query(`select count(*)::int as count from tigeriq_ai_resources
    where enabled=true and credential_state in ('LOCAL','READY')
      and health_state in ('READY','ONLINE') and current_job_id is not null
      and capabilities @> ARRAY[$1]::text[]`,[String(capability||'general')]);
  return Number(q.rows[0]?.count||0);
}

async function claimOpenClawLease(jobId){
  let row=(await pool.query('select * from tigeriq_ai_resources where resource_id=$1',[OPENCLAW_RESOURCE_ID])).rows[0]||null;
  if(!row){await refreshResources();row=(await pool.query('select * from tigeriq_ai_resources where resource_id=$1',[OPENCLAW_RESOURCE_ID])).rows[0]||null;}
  if(!row)throw Object.assign(new Error('OPENCLAW_RESOURCE_ROW_MISSING'),{kind:'configuration'});
  const client=await pool.connect();
  try{
    await client.query('begin');
    const locked=(await client.query('select * from tigeriq_ai_resources where resource_id=$1 and current_job_id is null for update skip locked',[OPENCLAW_RESOURCE_ID])).rows[0];
    if(!locked){await client.query('commit');throw Object.assign(new Error('OPENCLAW_RESOURCE_BUSY'),{kind:'busy'});}
    await client.query("update tigeriq_ai_resources set current_job_id=$2,work_state='BUSY',health_state=case when health_state='OFFLINE' then health_state else 'ONLINE' end,updated_at=now() where resource_id=$1",[OPENCLAW_RESOURCE_ID,jobId]);
    await client.query("update tigeriq_resources set current_job_id=$2,work_state='BUSY',updated_at=now() where employee_id=$1",[OPENCLAW_EMPLOYEE_ID,jobId]);
    await client.query('commit');
    return locked;
  }catch(error){await client.query('rollback').catch(()=>{});throw error;}finally{client.release();}
}
async function releaseOpenClawLease(jobId){
  const gateway=await probeOpenClawGateway();
  const state=gateway.ok?'ONLINE':'OFFLINE';
  const work=gateway.ok?'IDLE':'OFFLINE';
  await pool.query("update tigeriq_ai_resources set current_job_id=case when current_job_id=$2 then null else current_job_id end,health_state=$3,work_state=case when current_job_id=$2 then $4 else work_state end,last_seen_at=now(),updated_at=now() where resource_id=$1",[OPENCLAW_RESOURCE_ID,jobId,state,work]).catch(()=>{});
  await pool.query("update tigeriq_resources set current_job_id=case when current_job_id=$2 then null else current_job_id end,health_state=$3,work_state=case when current_job_id=$2 then $4 else work_state end,last_seen_at=now(),updated_at=now() where employee_id=$1",[OPENCLAW_EMPLOYEE_ID,jobId,state,work]).catch(()=>{});
}
function pcOperatorJobId(objectiveId,phaseIndex,ordinal){
  const key=`${String(objectiveId)}:${Number(phaseIndex)||0}:${Number(ordinal)||0}`;
  return `JOB-OC-${createHash('sha256').update(key).digest('hex').slice(0,24)}`;
}
const OPENCLAW_RETRYABLE_JOB_KINDS=new Set(['outage','timeout','openclaw_failure','worker_timeout','spawn_error','agent_terminal_invalid','busy','rate_limit']);
function openClawEnvelopeForJob(j){
  const objectiveId=String(j.objective_id||j.id);
  return normalizeOpenClawDispatchEnvelope({
    jobId:String(j.id),
    workOrderId:objectiveId,
    resourceScope:`core/objective/${objectiveId}`,
    idempotencyKey:`core:${objectiveId}:${j.id}`,
    instruction:String(j.prompt||''),
    acceptance:'Perform only the assigned bounded PC01 runtime action, verify the resulting state with TigerIQ tools, and return evidence. Do not choose other work.',
    authority:{production:false,paid:false,credentialSecurity:false,destructiveIrreversible:false,sourceMutation:false,arbitraryShell:false},
  });
}
async function runOpenClawOperatorJob(j){
  const envelope=openClawEnvelopeForJob(j);
  const gateway=await probeOpenClawGateway();
  if(!gateway.ok){
    await pool.query("update tigeriq_jobs set attempts=attempts+1 where id=$1",[j.id]);
    throw Object.assign(new Error('OPENCLAW_GATEWAY_UNAVAILABLE'),{kind:'outage'});
  }
  await claimOpenClawLease(j.id);
  const started=Date.now();
  try{
    await pool.query("update tigeriq_jobs set employee_id=$2,resource_id=$3,provider=$4,routing_profile='PC_OPERATOR',routing_decision=$5,attempts=attempts+1,lease_until=now()+interval '5 minutes' where id=$1",[j.id,OPENCLAW_EMPLOYEE_ID,OPENCLAW_RESOURCE_ID,OPENCLAW_PROVIDER,JSON.stringify({profile:'PC_OPERATOR',capability:'pc_operator',chosen:{employeeId:OPENCLAW_EMPLOYEE_ID,resourceId:OPENCLAW_RESOURCE_ID,provider:OPENCLAW_PROVIDER},idempotencyKey:envelope.idempotencyKey,envelopeHash:envelope.envelopeHash})]);
    await event('OPENCLAW_DISPATCH_ADMITTED',{jobId:j.id,objectiveId:j.objective_id,employeeId:OPENCLAW_EMPLOYEE_ID,resourceId:OPENCLAW_RESOURCE_ID,provider:OPENCLAW_PROVIDER,taskKind:'pc_operator',idempotencyKey:envelope.idempotencyKey,envelopeHash:envelope.envelopeHash});
    const dispatch=await waitOpenClawDispatch(envelope,{timeoutMs:190000,retryFailed:true});
    if(!dispatch.terminal)throw Object.assign(new Error('OPENCLAW_DISPATCH_TIMEOUT'),{kind:'timeout'});
    if(dispatch.record?.state!=='completed'){
      const failure=dispatch.record?.failure||{};
      throw Object.assign(new Error(String(failure.message||'OPENCLAW_DISPATCH_FAILED')),{kind:String(failure.kind||'outage')});
    }
    const latencyMs=Date.now()-started;
    const result={ok:true,employeeId:OPENCLAW_EMPLOYEE_ID,resourceId:OPENCLAW_RESOURCE_ID,provider:OPENCLAW_PROVIDER,latencyMs,idempotencyKey:envelope.idempotencyKey,envelopeHash:envelope.envelopeHash,dispatchState:dispatch.record.state,evidence:dispatch.record.result||null};
    await hotPathStage(j,'EVIDENCE',{employeeId:OPENCLAW_EMPLOYEE_ID,resourceId:OPENCLAW_RESOURCE_ID,provider:OPENCLAW_PROVIDER,latencyMs,idempotencyKey:envelope.idempotencyKey});
    await pool.query("update tigeriq_jobs set status='done',employee_id=$2,resource_id=$3,provider=$4,routing_profile='PC_OPERATOR',result=$5,lease_until=null,completed_at=now(),next_attempt_at=null,resource_wait_count=0,resource_wait_started_at=null where id=$1",[j.id,OPENCLAW_EMPLOYEE_ID,OPENCLAW_RESOURCE_ID,OPENCLAW_PROVIDER,JSON.stringify(result)]);
    await event('OPENCLAW_DISPATCH_COMPLETED',{jobId:j.id,objectiveId:j.objective_id,employeeId:OPENCLAW_EMPLOYEE_ID,resourceId:OPENCLAW_RESOURCE_ID,provider:OPENCLAW_PROVIDER,taskKind:'pc_operator',latencyMs,idempotencyKey:envelope.idempotencyKey});
    await hotPathStage(j,'DONE');
  }finally{
    await releaseOpenClawLease(j.id);
  }
}

async function reviewerResourceIdsForJob(j){
  if(j?.capability!=='review'||!j?.objective_id)return [];
  const q=await pool.query(`select distinct resource_id from tigeriq_jobs where objective_id=$1 and id<>$2 and status='done' and capability<>'review' and resource_id is not null`,[j.objective_id,j.id]);
  return q.rows.map(x=>String(x.resource_id||'')).filter(Boolean);
}
async function claimJob() {
  const c=await pool.connect();
  try { await c.query('begin');
    const q=await c.query(`select j.*,o.metadata as objective_metadata from tigeriq_jobs j join tigeriq_objectives o on o.id=j.objective_id
      where (j.status='queued' or (j.status='waiting_resource' and coalesce(j.next_attempt_at,now())<=now()))
        and j.attempts<j.max_attempts and o.status='active'
      order by case when j.status='waiting_resource' then 0 else 1 end,
        case o.priority when 'P0' then 0 when 'P1' then 1 when 'P2' then 2 when 'P3' then 3 when 'P4' then 4 when 'P5' then 5 else 6 end,j.created_at
      for update skip locked limit 1`);
    if(!q.rows[0]){await c.query('commit');return null;} const j=q.rows[0];
    await c.query("update tigeriq_jobs set status='running',started_at=coalesce(started_at,now()),lease_until=now()+interval '5 minutes' where id=$1",[j.id]);
    await c.query('commit');
    const claimed={...j,started_at:j.started_at||new Date()};
    await hotPathStage(claimed,'CLAIMED');
    return claimed;
  } catch(e){await c.query('rollback');throw e;} finally{c.release();}
}async function runJob(j) {
  try {
    await hotPathStage(j,'WORKING');
    if(j.capability==='pc_operator'){await runOpenClawOperatorJob(j);return;}
    if(j.kind==='readonly'){
      const readStarted=Date.now();
      const read=(await pool.query('select now() as db_time')).rows[0];
      const evidence=await hotPathStage(j,'EVIDENCE',{readLatencyMs:Math.max(0,Date.now()-readStarted),dbTime:read?.db_time||null});
      const result={ok:true,kind:'readonly',hotpath:evidence};
      await pool.query("update tigeriq_jobs set status='done',result=$2,lease_until=null,completed_at=now() where id=$1",[j.id,JSON.stringify(result)]);
      await event('JOB_DONE',{jobId:j.id,objectiveId:j.objective_id,taskKind:'readonly'});
      await hotPathStage(j,'DONE');
      return;
    }
    const reviewerResourceIds=await reviewerResourceIdsForJob(j);
    const routed=await invokeRouted(j.prompt,j.capability,j.id,j.max_attempts-j.attempts,{taskKind:j.kind||'ai',profile:j.routing_profile||'AUTO',reviewerResourceIds,preferredEmployeeId:j.objective_metadata?.targetWorker||null});
    const reviewEvidence=j.kind==='github_review'?parseGithubCoreReviewEvidence(routed.text,j.prompt):null;
    await hotPathStage(j,'EVIDENCE',{providerLatencyMs:routed.latencyMs,employeeId:routed.resource.id,resourceId:routed.resource.resourceId});
    const hadResourceWait=Number(j.resource_wait_count||0)>0;
    await pool.query("update tigeriq_jobs set status='done',employee_id=$2,resource_id=$3,provider=$4,routing_profile=$5,routing_decision=$6,result=$7,lease_until=null,completed_at=now(),next_attempt_at=null,resource_wait_count=0,resource_wait_started_at=null where id=$1",[j.id,routed.resource.id,routed.resource.resourceId,routed.resource.provider,routed.routingProfile,JSON.stringify(routed.routingDecision),JSON.stringify({text:routed.text,reviewEvidence,latencyMs:routed.latencyMs,failures:routed.failures,resourceId:routed.resource.resourceId,routingProfile:routed.routingProfile,routingDecision:routed.routingDecision})]);
    if(hadResourceWait)await event('RESOURCE_WAIT_RELEASED',{jobId:j.id,objectiveId:j.objective_id,employeeId:routed.resource.id,resourceId:routed.resource.resourceId,provider:routed.resource.provider,taskKind:j.kind||'ai'});
    await event('JOB_DONE',{jobId:j.id,objectiveId:j.objective_id,employeeId:routed.resource.id,resourceId:routed.resource.resourceId,provider:routed.resource.provider,taskKind:j.kind||'ai',profile:routed.routingProfile});
    await hotPathStage(j,'DONE');
  } catch(error) {
    const message=String(error?.message||error);
    const failures=Array.isArray(error?.failures)?error.failures:[];
    if(j.capability==='pc_operator'){
      const current=(await pool.query('select attempts,max_attempts from tigeriq_jobs where id=$1',[j.id])).rows[0]||{};
      const attempts=Math.max(0,Number(current.attempts)||0);
      const maxAttempts=Math.max(1,Number(current.max_attempts)||2);
      const kind=String(error?.kind||'');
      if(OPENCLAW_RETRYABLE_JOB_KINDS.has(kind)&&attempts<maxAttempts){
        const nextAttemptAt=new Date(Date.now()+5000);
        await pool.query("update tigeriq_jobs set status='waiting_resource',failure=$2,lease_until=null,completed_at=null,next_attempt_at=$3 where id=$1",[j.id,JSON.stringify({message,kind,failures,retry:{attempts,maxAttempts,nextAttemptAt}}),nextAttemptAt]);
        await event('OPENCLAW_JOB_RETRY_QUEUED',{jobId:j.id,objectiveId:j.objective_id,employeeId:OPENCLAW_EMPLOYEE_ID,resourceId:OPENCLAW_RESOURCE_ID,provider:OPENCLAW_PROVIDER,taskKind:'pc_operator',kind,attempts,maxAttempts,nextAttemptAt});
        await hotPathStage(j,'WAITING_RESOURCE',{reason:kind||message.slice(0,120),attempts,maxAttempts,nextAttemptAt});
        return;
      }
    }
    const busyCount=message==='NO_AI_RESOURCE_AVAILABLE'&&failures.length===0?await busyCapableResourceCount(j.capability):0;
    if(shouldWaitForBusyResource({message,failures,busyCapableCount:busyCount})){
      const current=(await pool.query('select resource_wait_count,resource_wait_started_at from tigeriq_jobs where id=$1',[j.id])).rows[0]||{};
      const plan=resourceWaitPlan({waitCount:current.resource_wait_count,startedAt:current.resource_wait_started_at});
      if(plan.wait){
        const failure={code:'TEMPORARY_RESOURCE_BUSY',message,failures,resourceWait:{count:plan.count,delayMs:plan.delayMs,nextAttemptAt:plan.nextAttemptAt}};
        await pool.query("update tigeriq_jobs set status='waiting_resource',failure=$2,lease_until=null,completed_at=null,next_attempt_at=$3,resource_wait_count=$4,resource_wait_started_at=coalesce(resource_wait_started_at,now()) where id=$1",[j.id,JSON.stringify(failure),plan.nextAttemptAt,plan.count]);
        await event('RESOURCE_WAIT_QUEUED',{jobId:j.id,objectiveId:j.objective_id,taskKind:j.kind||'ai',busyCapableCount:busyCount,retryCount:plan.count,delayMs:plan.delayMs,nextAttemptAt:plan.nextAttemptAt});
        await hotPathStage(j,'WAITING_RESOURCE',{reason:'TEMPORARY_RESOURCE_BUSY',retryCount:plan.count,nextAttemptAt:plan.nextAttemptAt});
        return;
      }
    }
    await pool.query("update tigeriq_jobs set status='failed',failure=$2,lease_until=null,completed_at=now(),next_attempt_at=null where id=$1",[j.id,JSON.stringify({message,failures})]);
    await event('JOB_FAILED',{jobId:j.id,objectiveId:j.objective_id,taskKind:j.kind||'ai'});
    await hotPathStage(j,'FAILED',{reason:message.slice(0,180)});
  }
}
async function callManagerDecision(prompt,objectiveId){
  const jobId=`MGR-${objectiveId}`,starts=new Map();
  const localResource=resources.find(x=>x.id===OLLAMA_EMPLOYEE_ID&&x.provider==='ollama')||resources.find(x=>x.provider==='ollama')||null;
  const localResourceId=localResource?.resourceId||null;
  return runBoundedManagerDecision({
    prompt,
    maxProviders:3,
    acquire:async excluded=>{
      const excludedResources=excluded.map(id=>resources.find(x=>x.id===id)?.resourceId||id);
      let row=null;
      if(!managerShouldUseLocalFallback(excluded.length,2)){
        const cloudExcludes=localResourceId?[...new Set([...excludedResources,localResourceId])]:excludedResources;
        row=await claimResource('reasoning',jobId,cloudExcludes,{profile:'AUTO',taskKind:'manager'});
      }
      if(!row&&localResourceId&&!excludedResources.includes(localResourceId)){
        const nonLocalIds=resources.filter(x=>x.provider!=='ollama').map(x=>x.resourceId);
        row=await claimResource('reasoning',jobId,[...new Set([...excludedResources,...nonLocalIds])],{profile:'LOCAL',taskKind:'manager'});
      }
      if(!row)return null;
      return resources.find(x=>x.resourceId===row.resource_id)||null;
    },
    invoke:async(r,nextPrompt)=>{
      starts.set(r.id,Date.now());
      return r.provider==='ollama'?invokeLocalManager(nextPrompt):invokeProvider(r,nextPrompt);
    },
    onRetry:async(r,error)=>event('MANAGER_OUTPUT_RETRY',{objectiveId,jobId,employeeId:r.id,resourceId:r.resourceId,provider:r.provider,taskKind:'manager',kind:error?.code||error?.message||'invalid_response'}),
    onSuccess:async r=>markResourceSuccess(r,jobId,Math.max(0,Date.now()-(starts.get(r.id)||Date.now())),'RESOURCE_SUCCESS',true,{taskKind:'manager',profile:r.provider==='ollama'?'LOCAL':'AUTO'}),
    onFailure:async(r,error)=>markResourceFailure(r,jobId,error,'RESOURCE_FAILURE',true,{taskKind:'manager',profile:r.provider==='ollama'?'LOCAL':'AUTO'}),
  });
}
async function reconcileAutonomousHandoff(o){
  const handoff=o?.metadata?.handoff;
  if(handoff?.state!=='waiting_children')return false;
  const childIds=Array.isArray(handoff.childIds)?handoff.childIds.map(String).filter(Boolean):[];
  const rows=childIds.length?(await pool.query('select id,status,summary from tigeriq_objectives where id=any($1::text[])',[childIds])).rows:[];
  const state=evaluateChildObjectiveStates(childIds,rows);
  if(state.state==='waiting'){
    await pool.query("update tigeriq_objectives set summary=$2,next_check_at=now()+interval '5 seconds',updated_at=now() where id=$1",[o.id,`waiting for autonomous child work: ${state.completed.length}/${childIds.length} complete`]);
    return true;
  }
  if(state.state==='blocked'){
    await pool.query("update tigeriq_objectives set status='blocked',summary=$2,updated_at=now() where id=$1",[o.id,`autonomous child work blocked: ${state.blocked.join(', ')}`]);
    await event('AUTONOMOUS_HANDOFF_BLOCKED',{objectiveId:o.id,childIds,blockedChildIds:state.blocked,generationKey:handoff.generationKey||null});
    return true;
  }
  const completedGenerationKeys=[...new Set([...(Array.isArray(handoff.completedGenerationKeys)?handoff.completedGenerationKeys:[]),handoff.generationKey].filter(Boolean))];
  const codingItems=Array.isArray(handoff.codingItems)?handoff.codingItems:[];
  const next={...handoff,state:codingItems.length?'coding_handoff_ready':'children_completed',completedGenerationKeys,childResults:state.results,completedAt:nowIso()};
  if(codingItems.length){
    await pool.query("update tigeriq_objectives set status='blocked',metadata=jsonb_set(metadata,'{handoff}',$2::jsonb,true),summary=$3,updated_at=now() where id=$1",[o.id,JSON.stringify(next),'API child work complete; durable coding handoff requires the coding executor lane']);
    await event('AUTONOMOUS_CODING_HANDOFF_READY',{objectiveId:o.id,generationKey:handoff.generationKey||null,codingItems});
    return true;
  }
  await pool.query("update tigeriq_objectives set metadata=jsonb_set(metadata,'{handoff}',$2::jsonb,true),manager_cycles=0,summary=$3,next_check_at=now(),updated_at=now() where id=$1",[o.id,JSON.stringify(next),'autonomous child work complete; re-evaluating parent acceptance']);
  await event('AUTONOMOUS_HANDOFF_CHILDREN_COMPLETED',{objectiveId:o.id,childIds,generationKey:handoff.generationKey||null});
  return true;
}

async function persistTerminalHandoff(o,decision,currentPhase){
  const items=normalizeTerminalWorkItems(o.id,decision?.jobs||[]);
  if(!items.length)return {action:'none',items:[]};
  const generationKey=handoffGenerationKey(items);
  const previous=o?.metadata?.handoff||{};
  const completedGenerationKeys=Array.isArray(previous.completedGenerationKeys)?previous.completedGenerationKeys:[];
  if(completedGenerationKeys.includes(generationKey))return {action:'repeated_completed',items,generationKey};
  const apiItems=items.filter(item=>!isCodingHandoff(item));
  const codingItems=items.filter(isCodingHandoff);
  const childIds=apiItems.map(item=>item.childObjectiveId);
  const client=await pool.connect();
  try{
    await client.query('begin');
    for(const item of apiItems){
      const metadata={source:'autonomous_work_handoff',handoff:{parentObjectiveId:o.id,kind:item.kind,title:item.title,acceptance:item.acceptance,capability:item.capability,scopeResourceKey:item.scopeResourceKey,idempotencyKey:item.idempotencyKey,authorityClass:item.authorityClass}};
      await client.query("insert into tigeriq_objectives(id,objective,priority,status,summary,metadata) values($1,$2,$3,'active',$4,$5) on conflict(id) do nothing",[item.childObjectiveId,item.prompt,o.priority,`autonomous child of ${o.id}`,JSON.stringify(metadata)]);
    }
    const state=childIds.length?'waiting_children':'coding_handoff_ready';
    const handoff={state,generationKey,phaseIndex:currentPhase,childIds,codingItems,items,completedGenerationKeys,createdAt:nowIso()};
    if(childIds.length){
      await client.query("update tigeriq_objectives set metadata=jsonb_set(metadata,'{handoff}',$2::jsonb,true),summary=$3,next_check_at=now()+interval '5 seconds',updated_at=now() where id=$1",[o.id,JSON.stringify(handoff),`autonomous handoff created: ${childIds.length} API child work item(s)`]);
    }else{
      await client.query("update tigeriq_objectives set status='blocked',metadata=jsonb_set(metadata,'{handoff}',$2::jsonb,true),summary=$3,updated_at=now() where id=$1",[o.id,JSON.stringify(handoff),'durable coding handoff ready; awaiting coding executor lane']);
    }
    await client.query('commit');
    for(const item of apiItems)await event('AUTONOMOUS_CHILD_CREATED',{objectiveId:o.id,childObjectiveId:item.childObjectiveId,idempotencyKey:item.idempotencyKey,scopeResourceKey:item.scopeResourceKey,kind:item.kind});
    for(const item of codingItems)await event('AUTONOMOUS_CODING_HANDOFF_CREATED',{objectiveId:o.id,idempotencyKey:item.idempotencyKey,scopeResourceKey:item.scopeResourceKey,kind:item.kind,title:item.title,prompt:item.prompt,acceptance:item.acceptance,authorityClass:item.authorityClass});
    return {action:childIds.length?'waiting_children':'coding_handoff_ready',items,generationKey,childIds};
  }catch(error){await client.query('rollback');throw error;}finally{client.release();}
}

export function githubCoreReviewJobId(objectiveId=''){
  const normalized=String(objectiveId||'').trim().replace(/[^A-Za-z0-9._-]+/g,'-').slice(0,160);
  if(!normalized)throw new Error('CORE_REVIEW_OBJECTIVE_ID_REQUIRED');
  return `JOB-${normalized}-REVIEW`;
}

export function githubCoreReviewDisposition(job){
  if(!job)return {action:'queue',status:null};
  const status=String(job.status||'').toLowerCase();
  if(status==='done')return {action:'complete',status};
  if(status==='failed')return {action:'block',status};
  if(['queued','running','waiting_resource'].includes(status))return {action:'wait',status};
  return {action:'block',status:status||'unknown'};
}

export function parseGithubCoreReviewEvidence(text,prompt=''){
  const raw=String(text||'').trim();
  const expected=String(prompt||'').match(/^TARGET_HEAD=([a-f0-9]{7,64})$/mi)?.[1]?.toLowerCase()||'';
  const decision=raw.match(/^REVIEW=(PASS|CHANGES_REQUIRED)$/mi)?.[1]?.toUpperCase()||'';
  const targetHead=raw.match(/^TARGET_HEAD=([a-f0-9]{7,64})$/mi)?.[1]?.toLowerCase()||'';
  const summary=raw.match(/^SUMMARY=(.+)$/mi)?.[1]?.trim().slice(0,600)||'';
  const findings=raw.match(/^FINDINGS=(.+)$/mi)?.[1]?.trim().slice(0,1800)||'';
  const valid=raw.includes('[TIGERIQ_INDEPENDENT_REVIEW_V1]')&&Boolean(expected)&&Boolean(decision)&&Boolean(targetHead)&&targetHead===expected&&Boolean(summary)&&Boolean(findings);
  if(!valid){
    const error=new Error('CORE_REVIEW_EVIDENCE_INVALID');
    error.kind='invalid_response';
    error.detail={expectedHead:expected||null,targetHead:targetHead||null,decision:decision||null};
    throw error;
  }
  return {schema:'TIGERIQ_INDEPENDENT_REVIEW_V1',decision,targetHead,summary,findings};
}

async function reconcileGithubCoreReviewObjective(o){
  if(o?.metadata?.source!=='github'||o?.metadata?.dispatchLane!=='CORE_REVIEW')return false;
  const jobId=githubCoreReviewJobId(o.id);
  const job=(await pool.query("select id,status,employee_id,resource_id,provider,result,failure from tigeriq_jobs where id=$1",[jobId])).rows[0]||null;
  const plan=githubCoreReviewDisposition(job);
  if(plan.action==='queue'){
    const prompt=[
      String(o.objective||''),
      '',
      'You are the explicitly assigned independent TigerIQ reviewer. Review ONLY the supplied GitHub evidence; do not invent missing evidence or perform source mutation.',
      'Return concise durable evidence containing exactly these fields on separate lines:',
      '[TIGERIQ_INDEPENDENT_REVIEW_V1]',
      'REVIEW=PASS|CHANGES_REQUIRED',
      'TARGET_HEAD=<exact reviewed head from supplied evidence>',
      'SUMMARY=<short finding>',
      'FINDINGS=<specific findings or NONE>',
      'If exact-head diff/check evidence is missing or inconsistent, REVIEW=CHANGES_REQUIRED and state the missing evidence.',
    ].join('\n');
    await pool.query("insert into tigeriq_jobs(id,objective_id,title,prompt,capability,kind,status,max_attempts) values($1,$2,$3,$4,'review','github_review','queued',2) on conflict(id) do nothing",[jobId,o.id,`GitHub independent review ${o.metadata?.issueNumber||o.id}`,prompt]);
    await pool.query("update tigeriq_objectives set summary=$2,next_check_at=now()+interval '5 seconds',updated_at=now() where id=$1",[o.id,`direct CORE_REVIEW queued: ${jobId}`]);
    await event('GITHUB_CORE_REVIEW_JOB_MATERIALIZED',{objectiveId:o.id,jobId,issueNumber:o.metadata?.issueNumber||null,targetWorker:o.metadata?.targetWorker||null});
    return true;
  }
  if(plan.action==='wait'){
    await pool.query("update tigeriq_objectives set summary=$2,next_check_at=now()+interval '5 seconds',updated_at=now() where id=$1",[o.id,`direct CORE_REVIEW ${plan.status}: ${jobId}`]);
    return true;
  }
  if(plan.action==='complete'){
    const reviewer=String(job.employee_id||'UNKNOWN');
    const resource=String(job.resource_id||'UNKNOWN');
    const provider=String(job.provider||'UNKNOWN');
    const reviewEvidence=job.result?.reviewEvidence||null;
    const evidence=reviewEvidence?JSON.stringify(reviewEvidence):String(job.result?.text||'').trim().slice(0,4200);
    const summary=`CORE_REVIEW completed by ${reviewer}/${provider}; resource=${resource}; job=${jobId}; evidence=${evidence||'EMPTY_REVIEW_EVIDENCE'}`.slice(0,5000);
    await pool.query("update tigeriq_objectives set status='completed',summary=$2,updated_at=now() where id=$1 and status='active'",[o.id,summary]);
    await event('GITHUB_CORE_REVIEW_COMPLETED',{objectiveId:o.id,jobId,employeeId:reviewer,resourceId:resource,provider,evidence:evidence.slice(0,1800)});
    return true;
  }
  const failure=String(job?.failure?.message||job?.failure?.kind||`unexpected_status_${plan.status}`).slice(0,600);
  await pool.query("update tigeriq_objectives set status='blocked',summary=$2,updated_at=now() where id=$1 and status='active'",[o.id,`CORE_REVIEW blocked; job=${jobId}; failure=${failure}`]);
  await event('GITHUB_CORE_REVIEW_BLOCKED',{objectiveId:o.id,jobId,status:plan.status||null,failure});
  return true;
}

async function reconcileCoreOpenClawBoundedObjectives(){
  const rows=(await pool.query(`select o.id as objective_id,o.metadata as objective_metadata,j.id as job_id,j.status,j.employee_id,j.resource_id,j.provider,j.failure,j.result
    from tigeriq_objectives o
    join lateral (
      select id,status,employee_id,resource_id,provider,failure,result
      from tigeriq_jobs
      where objective_id=o.id and capability='pc_operator'
      order by created_at desc
      limit 1
    ) j on true
    where o.status='active' and o.metadata->>'executionSurface'='CORE_OPENCLAW_BOUNDED'
      and j.status in ('done','failed')
    order by o.created_at
    limit 20`)).rows;
  let reconciled=0;
  for(const row of rows){
    const done=row.status==='done';
    const reason=done?'job_done':String(row.failure?.kind||row.failure?.message||'terminal_failure').slice(0,300);
    const summary=done
      ? appendPublicEvidenceToSummary(`bounded pc_operator completed via ${row.employee_id||'NV06'}/${row.provider||'openclaw'}; job=${row.job_id}`,row.result,row.objective_metadata?.publicEvidenceKeys||[])
      : `bounded pc_operator failed; job=${row.job_id}; failure=${reason}`;
    const updated=await pool.query("update tigeriq_objectives set status=$2,summary=$3,updated_at=now() where id=$1 and status='active'",[row.objective_id,done?'completed':'blocked',summary]);
    if(updated.rowCount!==1)continue;
    reconciled++;
    await event(done?'OBJECTIVE_COMPLETE':'OBJECTIVE_BLOCKED',{
      objectiveId:row.objective_id,jobId:row.job_id,executionSurface:'CORE_OPENCLAW_BOUNDED',
      employeeId:row.employee_id||null,resourceId:row.resource_id||null,provider:row.provider||null,reason
    });
    await event('CORE_OPENCLAW_OBJECTIVE_RECONCILED',{
      objectiveId:row.objective_id,jobId:row.job_id,terminalStatus:done?'completed':'blocked',reason
    });
  }
  return reconciled;
}

async function managerTick() {
  const q=await pool.query(`select o.* from tigeriq_objectives o where o.status='active' and o.next_check_at<=now()
    and coalesce(o.metadata->>'executionSurface','') not in ('CORE_OPENCLAW_BOUNDED','CORE_UI')
    and not exists(select 1 from tigeriq_jobs j where j.objective_id=o.id and j.status in ('queued','running','ui_assigned','ui_running'))
    order by case o.priority when 'P0' then 0 when 'P1' then 1 when 'P2' then 2 when 'P3' then 3 when 'P4' then 4 when 'P5' then 5 else 6 end,case when o.metadata#>>'{handoff,state}'='waiting_children' then 1 else 0 end,o.created_at limit 1`);
  const o=q.rows[0]; if(!o) return;
  if(await reconcileAutonomousHandoff(o)) return;
  if(await reconcileGithubCoreReviewObjective(o)) return;
  const campaign=o.metadata?.campaign||null;
  const phases=Array.isArray(campaign?.phases)?campaign.phases:[];
  const currentPhase=Math.min(Math.max(Number(campaign?.currentPhase)||0,0),Math.max(0,phases.length-1));
  if(o.manager_cycles>=30){await pool.query("update tigeriq_objectives set status='blocked',summary='manager cycle safety limit reached',updated_at=now() where id=$1",[o.id]);await event('OBJECTIVE_BLOCKED',{objectiveId:o.id,phaseIndex:currentPhase,reason:'manager_cycle_limit'});return;}
  const history=(await pool.query("select title,status,employee_id,resource_id,provider,result,failure from tigeriq_jobs where objective_id=$1 and phase_index=$2 order by created_at desc limit 8",[o.id,currentPhase])).rows;
  const goal=currentCampaignGoal(o.objective,phases,currentPhase);
  let historyContext={text:'[]',metrics:{itemsIn:0,itemsOut:0,bytesBefore:0,bytesAfter:2,budgetBytes:8000,headroomBytes:2000,effectiveBudgetBytes:6000,droppedCount:0,truncatedCount:0,reductionBytes:0}};
  try{historyContext=buildManagerHistoryContext(history);}catch(error){await event('CONTEXT_GATEWAY_FAIL_SAFE',{objectiveId:o.id,phaseIndex:currentPhase,error:String(error?.message||error).slice(0,180)});}
  await event('CONTEXT_GATEWAY_BUILT',{objectiveId:o.id,phaseIndex:currentPhase,...historyContext.metrics});
  let skillContext={skills:[],totalChars:0,contextBlock:'',evidence:[],skipped:[]};
  try {
    skillContext=matchAndLoadSkills(goal);
    if(skillContext.evidence.length){
      await event('SKILL_CONTEXT_LOADED',{objectiveId:o.id,skillIds:skillContext.evidence.map(x=>x.id),bytes:skillContext.totalChars});
    }
    if(skillContext.skipped.length){
      await event('SKILL_CONTEXT_SKIPPED',{objectiveId:o.id,skipped:skillContext.skipped.map(x=>({id:x.id,reason:x.reason}))});
    }
  } catch(error) {
    await event('SKILL_REGISTRY_REJECTED',{objectiveId:o.id,reason:String(error?.message||error).slice(0,180)});
    skillContext={skills:[],totalChars:0,contextBlock:'',evidence:[],skipped:[]};
  }
  const handoffContext=o.metadata?.handoff?.state==='children_completed'?`Completed autonomous child work: ${JSON.stringify(o.metadata.handoff.childResults||[]).slice(0,6000)}`:'';
  const isFinalCampaignPhase=phases.length>0&&currentPhase===phases.length-1;
  const terminalHandoffInstruction=isFinalCampaignPhase?'FINAL CAMPAIGN PHASE: when status=complete, jobs must contain ONLY additional NEXT work still required to satisfy the overall goal. Use [CODING] prefix in the title only for repository/source mutation; other next work is API/research/review/general. Every next-work prompt must include SCOPE: <resource-or-domain> and ACCEPTANCE: <observable completion>. If no further work is required, return jobs: [].':'';
  const basePrompt=`You are TigerIQ AI Manager. Goal: ${goal}\nRecent work for this phase: ${historyContext.text}\n${handoffContext}\n${terminalHandoffInstruction}\nDecide the next useful work. Return ONLY JSON: {"status":"continue|complete|blocked","summary":"short","jobs":[{"title":"short","prompt":"standalone task instruction","capability":"general|reasoning|review|pc_operator"}]}. Maximum 3 jobs. Prefer independent useful work. Repository implementation/coding is GitHub-only; never create coding jobs for PC01 Core. Never request paid services, Production/Main release, credential/security changes, destructive actions or reboot. For a campaign, status=complete means the CURRENT PHASE acceptance is achieved; Core will automatically advance to the next phase. Do not wait for Owner/chat between phases.`;
  const prompt=appendSkillContextToPrompt(basePrompt,skillContext.contextBlock);
  try {
    const routed=await callManagerDecision(prompt,o.id); const decision=routed.decision;
    await pool.query("update tigeriq_objectives set manager_cycles=manager_cycles+1,summary=$2,updated_at=now(),next_check_at=now()+interval '5 seconds' where id=$1",[o.id,String(decision.summary||'').slice(0,2000)]);
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
        const existing=(await pool.query('select status,attempts,max_attempts from tigeriq_jobs where id=$1 and objective_id=$2 and phase_index=$3',[id,o.id,currentPhase])).rows[0];
        if(existing?.status==='failed'&&Number(existing.attempts)<Number(existing.max_attempts)){await pool.query("update tigeriq_jobs set status='queued',employee_id=null,resource_id=null,provider=null,lease_until=null,started_at=null,completed_at=null where id=$1",[id]);await event('CAMPAIGN_PHASE_EVIDENCE_REQUEUED',{objectiveId:o.id,jobId:id,phaseIndex:currentPhase});return;}
        if(existing?.status==='failed'){await pool.query("update tigeriq_objectives set status='blocked',summary=$2,updated_at=now() where id=$1",[o.id,`phase ${currentPhase+1}/${phases.length} evidence exhausted`]);await event('OBJECTIVE_BLOCKED',{objectiveId:o.id,jobId:id,phaseIndex:currentPhase,reason:'phase_evidence_exhausted'});return;}
        await event('CAMPAIGN_PHASE_EVIDENCE_ALREADY_EXISTS',{objectiveId:o.id,jobId:id,phaseIndex:currentPhase,status:existing?.status||'unknown'});return;
      }
      await pool.query("update tigeriq_objectives set summary=$2,next_check_at=now()+interval '5 seconds',updated_at=now() where id=$1",[o.id,`phase ${currentPhase+1}/${phases.length} completion rejected: no DONE job evidence; evidence job created`]);
      await event('CAMPAIGN_PHASE_COMPLETE_REJECTED_NO_EVIDENCE',{objectiveId:o.id,jobId:id,phaseIndex:currentPhase});
      await event('JOB_CREATED',{objectiveId:o.id,jobId:id,phaseIndex:currentPhase});
      return;
    }
    const transition=campaignTransition({status:decision.status,currentPhase,phases});
    if(transition.action==='blocked'){await pool.query("update tigeriq_objectives set status='blocked',updated_at=now() where id=$1",[o.id]);await event('OBJECTIVE_BLOCKED',{objectiveId:o.id,phaseIndex:currentPhase});return;}
    if(transition.action==='complete'){
      if(phases.length){
        const handoff=await persistTerminalHandoff(o,decision,currentPhase);
        if(handoff.action==='waiting_children'||handoff.action==='coding_handoff_ready')return;
        if(handoff.action==='repeated_completed')await event('AUTONOMOUS_HANDOFF_DEDUPED_COMPLETE',{objectiveId:o.id,generationKey:handoff.generationKey,phaseIndex:currentPhase});
      }
      await pool.query("update tigeriq_objectives set status='completed',updated_at=now() where id=$1",[o.id]);
      await event('OBJECTIVE_COMPLETE',{objectiveId:o.id,phaseIndex:currentPhase,phaseCount:phases.length||1});
      return;
    }
    if(transition.action==='advance'){
      const checkpoint=makePhaseCheckpoint({currentPhase,phases,summary:decision.summary});
      const advanced=await pool.query(`update tigeriq_objectives
        set metadata=jsonb_set(jsonb_set(metadata,'{campaign,currentPhase}',to_jsonb($2::int),true),'{campaign,checkpoints}',coalesce(metadata#>'{campaign,checkpoints}','[]'::jsonb)||$3::jsonb,true),
            manager_cycles=0,summary=$4,next_check_at=now(),updated_at=now()
        where id=$1 and status='active' and coalesce((metadata#>>'{campaign,currentPhase}')::int,0)=$5`,
        [o.id,transition.nextPhase,JSON.stringify([checkpoint]),`phase ${currentPhase+1}/${phases.length} complete; continuing to phase ${transition.nextPhase+1}/${phases.length}`,currentPhase]);
      if(advanced.rowCount===1){await event('CAMPAIGN_PHASE_COMPLETED',{objectiveId:o.id,phaseIndex:currentPhase,nextPhaseIndex:transition.nextPhase,checkpoint});await event('CAMPAIGN_PHASE_ADVANCED',{objectiveId:o.id,phaseIndex:transition.nextPhase,phaseCount:phases.length});}
      return;
    }
    let pcOperatorOrdinal=0;
    for(const spec of decision.jobs){
      if(!spec?.title||!spec?.prompt) continue;
      const capability=['general','reasoning','review','pc_operator'].includes(spec.capability)?spec.capability:'general';
      const id=capability==='pc_operator'?pcOperatorJobId(o.id,currentPhase,pcOperatorOrdinal++):`JOB-${randomUUID()}`;
      if(capability==='pc_operator'){
        const inserted=await pool.query('insert into tigeriq_jobs(id,objective_id,title,prompt,capability,phase_index,max_attempts) values($1,$2,$3,$4,$5,$6,2) on conflict(id) do nothing',[id,o.id,String(spec.title).slice(0,200),String(spec.prompt).slice(0,12000),capability,currentPhase]);
        if(inserted.rowCount===0){
          const existing=(await pool.query('select status,attempts,max_attempts from tigeriq_jobs where id=$1',[id])).rows[0]||{};
          await event('OPENCLAW_JOB_DEDUPED',{objectiveId:o.id,jobId:id,phaseIndex:currentPhase,status:existing.status||'unknown',attempts:Number(existing.attempts)||0,maxAttempts:Number(existing.max_attempts)||2});
          continue;
        }
      }else{
        await pool.query('insert into tigeriq_jobs(id,objective_id,title,prompt,capability,phase_index) values($1,$2,$3,$4,$5,$6)',[id,o.id,String(spec.title).slice(0,200),String(spec.prompt).slice(0,12000),capability,currentPhase]);
      }
      await event('JOB_CREATED',{objectiveId:o.id,jobId:id,phaseIndex:currentPhase});
    }
  } catch(error){await pool.query("update tigeriq_objectives set summary=$2,next_check_at=now()+interval '1 minute',updated_at=now() where id=$1",[o.id,`manager error: ${String(error?.message||error).slice(0,500)}`]);await event('MANAGER_ERROR',{objectiveId:o.id,phaseIndex:currentPhase});}
}function publicStatus(r){
  if(!r.enabled) return 'DISABLED';
  if(r.credential_state==='WAIT_KEY') return 'WAIT_KEY';
  if(r.current_job_id||r.work_state==='BUSY') return 'BUSY';
  if(r.health_state==='RATE_LIMITED') return 'RATE_LIMITED';
  if(r.health_state==='ERROR') return 'ERROR';
  if(r.health_state==='OFFLINE') return 'OFFLINE';
  if(r.work_state==='ON_DEMAND') return 'ON_DEMAND';
  if(r.health_state==='ONLINE') return 'IDLE';
  return 'READY';
}
async function snapshot(){
  const {workforce,workforceMeta}=await refreshRegistryWorkforce();
  const base=(await pool.query('select * from tigeriq_ai_resources where enabled=true order by employee_id nulls last,resource_id')).rows;const failures=(await pool.query(`select distinct on(resource_id) resource_id,ts,type,data from tigeriq_events where resource_id is not null and type in ('RESOURCE_FAILURE','RESOURCE_PROBE_FAIL') order by resource_id,seq desc`)).rows,failureMap=new Map(failures.map(x=>[x.resource_id,x]));const callStats=(await pool.query(`select resource_id,count(*) filter(where type in ('RESOURCE_SUCCESS','RESOURCE_PROBE_OK'))::int as ok,count(*) filter(where type in ('RESOURCE_FAILURE','RESOURCE_PROBE_FAIL'))::int as fail from tigeriq_events where resource_id is not null and ts>=now()-interval '24 hours' and type in ('RESOURCE_SUCCESS','RESOURCE_PROBE_OK','RESOURCE_FAILURE','RESOURCE_PROBE_FAIL') group by resource_id`)).rows,statMap=new Map(callStats.map(x=>[x.resource_id,x]));const rr=normalizeRuntimeResources(base,workforce).map(x=>{const f=failureMap.get(x.resource_id),st=statMap.get(x.resource_id)||{ok:0,fail:0};return{...x,quota_state:normalizeQuota(x.quota_state||{}),status:publicStatus(x),last_error:f?.data?.kind||f?.data?.message||null,last_error_at:f?.ts||null,calls_success_24h:Number(st.ok||0),calls_failure_24h:Number(st.fail||0)}});const objectives=(await pool.query("select id,objective,priority,status,summary,manager_cycles,metadata,updated_at from tigeriq_objectives order by created_at desc limit 20")).rows;const jobs=(await pool.query("select id,objective_id,title,capability,kind,status,employee_id,resource_id,provider,routing_profile,routing_decision,phase_index,attempts,created_at,started_at,completed_at from tigeriq_jobs order by created_at desc limit 40")).rows;const events=(await pool.query("select seq,ts,type,objective_id,job_id,employee_id,resource_id,task_kind,data from tigeriq_events order by seq desc limit 80")).rows;const telemetry=(await pool.query(`select ts,employee_id,resource_id,task_kind,type,(data->>'latencyMs')::int as latency_ms from tigeriq_events where ts>=now()-interval '24 hours' and type in ('RESOURCE_SUCCESS','RESOURCE_PROBE_OK') and data ? 'latencyMs' order by ts asc limit 500`)).rows;const performanceByTask=(await pool.query(`select resource_id,coalesce(task_kind,'general') as task_kind,count(*) filter(where type in ('RESOURCE_SUCCESS','RESOURCE_PROBE_OK'))::int as success,count(*) filter(where type in ('RESOURCE_FAILURE','RESOURCE_PROBE_FAIL'))::int as failure,count(*) filter(where type='ROUTING_RETRY')::int as retries,count(*) filter(where type='ROUTING_FAILOVER')::int as failovers,round(avg((data->>'latencyMs')::numeric) filter(where data ? 'latencyMs'))::int as avg_latency_ms from tigeriq_events where resource_id is not null and ts>=now()-interval '7 days' group by resource_id,coalesce(task_kind,'general') order by resource_id,task_kind`)).rows;const routingDecisions=(await pool.query("select seq,ts,job_id,employee_id,resource_id,task_kind,data from tigeriq_events where type='ROUTING_DECISION' order by seq desc limit 20")).rows;return {ok:true,core:{host:HOST,port:PORT,pid:process.pid,uptimeSec:Math.floor(process.uptime()),time:nowIso()},integrations:{surfsense:await surfSenseHealth(),openclaw:{...(await probeOpenClawGateway()),workerActivated:openClawResourceActivated()}},resources:rr,workforce,workforceMeta,objectives,jobs,events,telemetry,apiDoctor:await apiDoctorTelemetry(),routing:{profiles:ROUTING_PROFILE_LABELS,routingDecisions,performanceByTask}};
}
function auth(req){return TOKEN && req.headers.authorization===`Bearer ${TOKEN}`;}
function localSelf(req){const a=String(req.socket.remoteAddress||'').replace('::ffff:','');return a==='127.0.0.1'||a==='::1'||a===HOST;}
async function readBody(req){let raw='';for await(const c of req){raw+=c;if(raw.length>65536)throw new Error('BODY_TOO_LARGE');}return raw?JSON.parse(raw):{};}
const labels={IDLE:'RẢNH',BUSY:'ĐANG LÀM',READY:'SẴN SÀNG',WAIT_KEY:'CHỜ KEY',RATE_LIMITED:'HẾT HẠN MỨC',OFFLINE:'OFFLINE',ERROR:'LỖI',DISABLED:'TẮT'};
function dashboard(){return readFileSync(new URL('./dashboard.html', import.meta.url),'utf8');}const server=createServer(async(req,res)=>{
  const url=new URL(req.url||'/','http://localhost');
  try{
    if(req.method==='GET'&&url.pathname==='/health'){res.writeHead(200,{'content-type':'application/json'});return res.end(JSON.stringify({ok:true,pid:process.pid,uptimeSec:Math.floor(process.uptime())}));}
    if(req.method==='GET'&&url.pathname==='/api/status'){res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});return res.end(JSON.stringify(await snapshot()));}
    if(req.method==='GET'&&url.pathname==='/api/ui-assignment'){
      if(!auth(req)&&!localSelf(req)){res.writeHead(401);return res.end('unauthorized');}
      const previousJobId=url.searchParams.get('previousJobId')||undefined;
      const projected=await buildCoreUiAssignmentSnapshot({pool,token:GITHUB_TOKEN,owner:GITHUB_OWNER,repo:GITHUB_REPO,previousJobId});
      res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});
      return res.end(JSON.stringify(projected));
    }
    if(req.method==='GET'&&url.pathname==='/'){res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});return res.end(dashboard());}
    if(req.method==='POST'&&url.pathname==='/api/resources/probe'){
      if(!auth(req)&&!localSelf(req)){res.writeHead(401);return res.end('unauthorized');}
      const b=await readBody(req); const result=await probeResource(String(b.resourceId||b.employeeId||''));
      res.writeHead(200,{'content-type':'application/json'});return res.end(JSON.stringify(result));
    }
    if(req.method==='POST'&&url.pathname==='/api/nv09/canary'){
      if(!auth(req)&&!localSelf(req)){res.writeHead(401);return res.end('unauthorized');}
      const b=await readBody(req);const result=await runNv09Canary(String(b.prompt||''));
      res.writeHead(result.ok?200:503,{'content-type':'application/json','cache-control':'no-store'});return res.end(JSON.stringify(result));
    }
    if(req.method==='POST'&&url.pathname==='/api/research'){
      if(!auth(req)&&!localSelf(req)){res.writeHead(401);return res.end('unauthorized');}
      const b=await readBody(req); const query=String(b.query||'').trim(); if(!query){res.writeHead(400);return res.end('query_required');}
      const result=await runSurfSenseResearch(query,Number(b.limit||6)); res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});return res.end(JSON.stringify(result));
    }
    if(req.method==='POST'&&url.pathname==='/api/hotpath/sample'){
      if(!auth(req)&&!localSelf(req)){res.writeHead(401);return res.end('unauthorized');}
      const b=await readBody(req);const count=Math.max(1,Math.min(HOTPATH_SAMPLE_LIMIT,Number(b.count||HOTPATH_SAMPLE_LIMIT)));const objectiveId=`PERF-${randomUUID()}`;
      await pool.query("insert into tigeriq_objectives(id,objective,priority,status,summary,metadata) values($1,$2,'P2','active',$3,$4)",[objectiveId,'TigerIQ hot-path trivial read-only live sample','hot-path live sample running',JSON.stringify({source:'hotpath_sample'})]);
      const jobIds=[];
      for(let i=0;i<count;i++){const id=`PERFJOB-${randomUUID()}`;jobIds.push(id);const row=(await pool.query("insert into tigeriq_jobs(id,objective_id,title,prompt,capability,kind,status) values($1,$2,$3,$4,'general','readonly','queued') returning *",[id,objectiveId,`Hot-path read-only ${i+1}`,'Read-only routing latency sample'])).rows[0];await hotPathStage(row,'QUEUED');}
      const deadline=Date.now()+15000;let rows=[];
      while(Date.now()<deadline){rows=(await pool.query("select id,status,created_at,started_at,completed_at,result,failure from tigeriq_jobs where id=any($1::text[]) order by created_at",[jobIds])).rows;if(rows.length===count&&rows.every(x=>x.status==='done'||x.status==='failed'))break;await sleep(25);}
      const runs=rows.map(x=>({id:x.id,status:x.status,queuedAt:x.created_at,claimedAt:x.started_at,doneAt:x.completed_at,queueMs:x.started_at?Math.max(0,new Date(x.started_at)-new Date(x.created_at)):null,endToEndMs:x.completed_at?Math.max(0,new Date(x.completed_at)-new Date(x.created_at)):null}));
      const endToEnd=runs.map(x=>x.endToEndMs).filter(Number.isFinite);const queueTimes=runs.map(x=>x.queueMs).filter(Number.isFinite);const complete=runs.length===count&&runs.every(x=>x.status==='done');
      const summary={count,complete,medianMs:median(endToEnd),maxMs:endToEnd.length?Math.max(...endToEnd):null,medianQueueMs:median(queueTimes),normalPathShellSpawn:false,runs};
      await pool.query("update tigeriq_objectives set status=$2,summary=$3,updated_at=now() where id=$1",[objectiveId,complete?'complete':'blocked',JSON.stringify(summary).slice(0,2000)]);
      await event(complete?'HOTPATH_SAMPLE_COMPLETED':'HOTPATH_SAMPLE_BLOCKED',{objectiveId,...summary});
      res.writeHead(complete?200:504,{'content-type':'application/json','cache-control':'no-store'});return res.end(JSON.stringify({ok:complete,objectiveId,...summary}));
    }
    if(req.method==='POST'&&url.pathname==='/api/objectives'){
      if(!auth(req)&&!localSelf(req)){res.writeHead(401);return res.end('unauthorized');}
      const b=await readBody(req); if(!String(b.objective||'').trim()){res.writeHead(400);return res.end('objective_required');}
      const phases=normalizeCampaignPhases(b.phases); const id=`OBJ-${randomUUID()}`; const priority=['P0','P1','P2'].includes(b.priority)?b.priority:'P1';
      const metadata={source:b.source||'api',...(phases.length?{campaign:{phases,currentPhase:0,checkpoints:[]}}:{})};
      await pool.query('insert into tigeriq_objectives(id,objective,priority,metadata) values($1,$2,$3,$4)',[id,String(b.objective).slice(0,12000),priority,JSON.stringify(metadata)]);
      await event(phases.length?'CAMPAIGN_CREATED':'OBJECTIVE_CREATED',{objectiveId:id,phaseIndex:0,phaseCount:phases.length||1});
      res.writeHead(201,{'content-type':'application/json'});return res.end(JSON.stringify({ok:true,id,campaign:phases.length>0,phaseCount:phases.length||1,currentPhase:0}));
    }
    res.writeHead(404);res.end('not_found');
  }catch(e){res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({ok:false,error:String(e?.message||e)}));}
});

async function runFailureLearningScan(){
  const rows=(await pool.query(
    "select seq,ts,type,objective_id,job_id,employee_id,resource_id,task_kind,data from tigeriq_events where type=any($1::text[]) order by seq desc limit 200",
    [failureLearningEventTypes]
  )).rows;
  const knownRows=(await pool.query(
    "select data->>'signature' as signature from tigeriq_events where type='FAILURE_LEARNING_CANDIDATE' and data ? 'signature' order by seq desc limit 500"
  )).rows;
  const existingSignatures=new Set(knownRows.map(x=>String(x.signature||'')).filter(Boolean));
  const candidates=buildFailureLearningCandidates(rows,{minOccurrences:2,existingSignatures});
  for(const candidate of candidates)await event('FAILURE_LEARNING_CANDIDATE',candidate);
  await event('FAILURE_LEARNING_SCAN',{eventsIn:rows.length,candidatesCreated:candidates.length,knownSignatures:existingSignatures.size});
  return {eventsIn:rows.length,candidatesCreated:candidates.length};
}

let stop=false, lastRefresh=0, lastRecover=0, lastOpenClawObjectiveReconcile=0, lastManager=0, lastProbe=0, lastFailureLearning=0, lastApiDoctor=0, apiDoctorScanRunning=false, managerTickRunning=false; const active=new Set();
function getDynamicMaxParallel() {
  const resList = typeof resources !== 'undefined' ? resources : [];
  const healthyCount = Array.isArray(resList) ? resList.filter(r => r && (r.status === 'ready' || r.status === 'healthy' || r.healthy || r.health_state === 'READY' || r.health_state === 'ONLINE' || r.credential_state === 'LOCAL')).length : 0;
  return Math.max(3, Math.min(20, healthyCount));
}
let lastLightAudit = 0, lastDeepAudit = 0, activeDeepAudit = false;
export async function startSelfCheck(runtime) {
  const now = runtime?.now ? runtime.now() : Date.now();
  const lightInterval = runtime?.lightIntervalMs ?? 10 * 60 * 1000;
  const deepInterval = runtime?.deepIntervalMs ?? 30 * 60 * 1000;
  const store = runtime?.store || pool;

  if (!lastLightAudit) {
    lastLightAudit = now;
    try {
      const healthMetrics = {
        ok: true,
        uptimeSec: Math.floor(process.uptime()),
        timestamp: new Date(now).toISOString(),
      };
      if (typeof store.persist === 'function') {
        await store.persist('SELF_CHECK_LIGHT', healthMetrics);
      } else if (typeof store.query === 'function') {
        await store.query(
          "insert into tigeriq_events(type, data) values($1, $2)",
          ['SELF_CHECK_LIGHT', JSON.stringify(healthMetrics)]
        );
      }
    } catch (err) {
      console.error(JSON.stringify({ event: 'SELF_CHECK_LIGHT_ERROR', error: String(err?.message || err) }));
    }
  } else if (now - lastLightAudit >= lightInterval) {
    lastLightAudit = now;
    try {
      const healthMetrics = {
        ok: true,
        uptimeSec: Math.floor(process.uptime()),
        timestamp: new Date(now).toISOString(),
      };
      if (typeof store.query === 'function') {
        await store.query(
          "insert into tigeriq_events(type, data) values($1, $2)",
          ['SELF_CHECK_LIGHT', JSON.stringify(healthMetrics)]
        );
      } else if (typeof store.persist === 'function') {
        await store.persist('SELF_CHECK_LIGHT', healthMetrics);
      }
    } catch (err) {
      console.error(JSON.stringify({ event: 'SELF_CHECK_LIGHT_ERROR', error: String(err?.message || err) }));
    }
  }

  if (!activeDeepAudit && (!lastDeepAudit || (now - lastDeepAudit >= deepInterval))) {
    activeDeepAudit = true;
    lastDeepAudit = now;
    try {
      const resList = typeof resources !== 'undefined' ? resources : [];
      const auditResult = {
        ok: true,
        auditType: 'deep',
        resourcesCount: resList.length,
        timestamp: new Date(now).toISOString(),
      };
      if (typeof store.persist === 'function') {
        await store.persist('SELF_CHECK_DEEP', auditResult);
      } else if (typeof store.query === 'function') {
        await store.query(
          "insert into tigeriq_events(type, data) values($1, $2)",
          ['SELF_CHECK_DEEP', JSON.stringify(auditResult)]
        );
      }
    } catch (err) {
      console.error(JSON.stringify({ event: 'SELF_CHECK_DEEP_ERROR', error: String(err?.message || err) }));
    } finally {
      activeDeepAudit = false;
    }
  }
}

async function loop(){
  while(!stop){const t=Date.now();
    try{
      const preflightCheck = runExecutionPreflight({ state: { status: 'running', runtimeIsolation: true } });
      if (!preflightCheck.ok) {
        console.error(JSON.stringify({ event: 'PREFLIGHT_CHECK_FAILED', errors: preflightCheck.errors }));
      }
      if(t-lastRefresh>15000){await refreshResources();lastRefresh=t;}
      if(t-lastRecover>10000){await recoverStale();lastRecover=t;}
      if(t-lastOpenClawObjectiveReconcile>3000){await reconcileCoreOpenClawBoundedObjectives();lastOpenClawObjectiveReconcile=t;}
      if(!managerTickRunning&&t-lastManager>MANAGER_IDLE_MS){lastManager=t;managerTickRunning=true;void managerTick().catch(error=>console.error(JSON.stringify({event:'MANAGER_TICK_ERROR',error:String(error?.message||error)}))).finally(()=>{managerTickRunning=false;});}
      if(t-lastProbe>60000){await probeReadyResources();lastProbe=t;}
      if(!apiDoctorScanRunning&&t-lastApiDoctor>API_DOCTOR_INTERVAL_MS){lastApiDoctor=t;apiDoctorScanRunning=true;void runApiDoctorScan().catch(error=>console.error(JSON.stringify({event:'API_DOCTOR_SCAN_ERROR',error:String(error?.message||error)}))).finally(()=>{apiDoctorScanRunning=false;});}
      if(t-lastFailureLearning>FAILURE_LEARNING_INTERVAL_MS){lastFailureLearning=t;await runFailureLearningScan();}
      await startSelfCheck({ now: () => Date.now(), store: pool });
      let dispatchedCount = 0;
      const currentMaxParallel = getDynamicMaxParallel();
      while(active.size < currentMaxParallel){
        const j = await claimJob();
        if(!j) {
          const eligiblePendingCount=(await pool.query(`select count(*)::int as count
            from tigeriq_jobs j
            join tigeriq_objectives o on o.id=j.objective_id
            where (j.status='queued' or (j.status='waiting_resource' and coalesce(j.next_attempt_at,now())<=now()))
              and j.attempts<j.max_attempts
              and o.status='active'`)).rows[0]?.count||0;
          const eligibleIdleWorkers=(await pool.query(`select count(*)::int as count
            from tigeriq_ai_resources
            where enabled=true
              and credential_state in ('LOCAL','READY')
              and health_state in ('READY','ONLINE')
              and current_job_id is null
              and (cooldown_until is null or cooldown_until<=now())`)).rows[0]?.count||0;
          const fault=routingFault({
            eligibleBacklogCount:eligiblePendingCount,
            activeWorkCount:active.size,
            eligibleIdleWorkers,
          });
          if(detectIdleWithBacklog(active.size,eligiblePendingCount)){
            console.log(JSON.stringify({
              event:fault.fault?'ROUTING_FAULT':'IDLE_WITH_ELIGIBLE_BACKLOG',
              timestamp:new Date().toISOString(),
              eligiblePendingCount,
              eligibleIdleWorkers,
              activeWorkCount:active.size,
            }));
          }
          if(fault.fault){
            await event('ROUTING_FAULT',{
              eligibleBacklogCount:eligiblePendingCount,
              eligibleIdleWorkers,
              activeWorkCount:active.size,
              recovery:'BOUNDED_RECLAIM',
            });
            await sleep(100);
            const recovered=await claimJob();
            if(recovered){
              await event('ROUTING_FAULT_RECOVERED',{jobId:recovered.id,objectiveId:recovered.objective_id});
              active.add(recovered.id);
              void runJob(recovered).finally(()=>active.delete(recovered.id));
              continue;
            }
          }
          break;
        }
        dispatchedCount++;
        active.add(j.id);
        void runJob(j).finally(()=>active.delete(j.id));
      }
    }catch(e){console.error(JSON.stringify({event:'CORE_LOOP_ERROR',error:String(e?.message||e)}));}
    await sleep(POLL_MS);
  }
}
await initDb();
await recoverAfterCoreRestart();
await refreshResources();
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(PORT,HOST,resolve);});
void probeReadyResources();
console.log(JSON.stringify({event:'TIGERIQ_CORE_STARTED',host:HOST,port:PORT,pid:process.pid,resources:resources.length}));
process.on('SIGINT',()=>{stop=true;server.close();});process.on('SIGTERM',()=>{stop=true;server.close();});
await loop(); await pool.end();