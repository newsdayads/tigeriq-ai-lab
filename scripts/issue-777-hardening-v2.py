from pathlib import Path


def replace_once(path, old, new, label):
    p = Path(path)
    source = p.read_text(encoding='utf-8')
    count = source.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 anchor, got {count}')
    p.write_text(source.replace(old, new, 1), encoding='utf-8')


router = 'apps/tigeriq-core/smart-router.mjs'
core = 'apps/tigeriq-core/core.mjs'

replace_once(router, """export function createResourceId(provider, account='default') {
  const p=String(provider||'unknown').trim().toLowerCase().replace(/[^a-z0-9._-]+/g,'-');
  const a=String(account||'default').trim().toLowerCase().replace(/[^a-z0-9._-]+/g,'-');
  return `res:${p}:${a}`;
}""", """function resourcePart(value, fallback) {
  return String(value||fallback).trim().toLowerCase().replace(/[^a-z0-9._-]+/g,'-').replace(/^-+|-+$/g,'')||fallback;
}
export function createResourceId(provider, modelOrAccount='unknown', account, runtime='core') {
  const p=resourcePart(provider,'unknown');
  if(account===undefined)return `res:${p}:${resourcePart(modelOrAccount,'default')}`;
  return `res:${p}:${resourcePart(modelOrAccount,'unknown')}:${resourcePart(account,'default')}:${resourcePart(runtime,'core')}`;
}""", 'resource identity')

replace_once(router, """  if(k==='auth'||k==='configuration')return {kind:k,retrySameResource:false,failover:false,cooldownMs:6*60*60*1000,stop:true};""", """  if(['auth','configuration','security','credential','paid','production','irreversible'].includes(k))return {kind:k,retrySameResource:false,failover:false,cooldownMs:6*60*60*1000,stop:true};""", 'sensitive failure stop')

replace_once(router, """export function normalizeQuota(raw={}) {
  const q=raw&&typeof raw==='object'?raw:{};
  const known=q.known===true;
  const usable=q.usable!==false;
  const remainingRatio=Number.isFinite(Number(q.remainingRatio))?Math.max(0,Math.min(1,Number(q.remainingRatio))):null;
  const resetAt=q.resetAt?String(q.resetAt):null;
  const last429At=q.last429At?String(q.last429At):null;
  const sourceConfidence=['high','medium','low'].includes(String(q.sourceConfidence))?String(q.sourceConfidence):'low';
  return {known,usable,remainingRatio,resetAt,last429At,sourceConfidence};
}""", """export function normalizeQuota(raw={}) {
  const q=raw&&typeof raw==='object'?raw:{};
  const finite=(value)=>value===null||value===undefined||value===''?null:(Number.isFinite(Number(value))?Math.max(0,Number(value)):null);
  const requestLimit=finite(q.requestLimit??q.requestsLimit);
  const requestRemaining=finite(q.requestRemaining??q.requestsRemaining);
  const tokenLimit=finite(q.tokenLimit??q.tokensLimit);
  const tokenRemaining=finite(q.tokenRemaining??q.tokensRemaining);
  let remainingRatio=finite(q.remainingRatio);
  if(remainingRatio!==null)remainingRatio=Math.min(1,remainingRatio);
  const ratios=[];
  if(requestLimit>0&&requestRemaining!==null)ratios.push(Math.max(0,Math.min(1,requestRemaining/requestLimit)));
  if(tokenLimit>0&&tokenRemaining!==null)ratios.push(Math.max(0,Math.min(1,tokenRemaining/tokenLimit)));
  if(remainingRatio===null&&ratios.length)remainingRatio=Math.min(...ratios);
  const known=q.known===true||[requestLimit,requestRemaining,tokenLimit,tokenRemaining].some(v=>v!==null);
  const usable=q.usable!==false;
  const resetAt=q.resetAt?String(q.resetAt):null;
  const cooldownUntil=q.cooldownUntil?String(q.cooldownUntil):null;
  const last429At=q.last429At?String(q.last429At):null;
  const sourceConfidence=['high','medium','low'].includes(String(q.sourceConfidence))?String(q.sourceConfidence):'low';
  return {known,usable,remainingRatio,requestLimit,requestRemaining,tokenLimit,tokenRemaining,resetAt,cooldownUntil,last429At,sourceConfidence};
}""", 'normalized quota ledger')

replace_once(router, """  if(!q.resetAt)return false;
  const reset=Date.parse(q.resetAt);""", """  const recoveryAt=q.resetAt||q.cooldownUntil;
  if(!recoveryAt)return false;
  const reset=Date.parse(recoveryAt);""", 'quota cooldown recovery')

replace_once(router, """  const resourceId=String(resource.resource_id??resource.resourceId??createResourceId(resource.provider,resource.account_binding??resource.accountBinding??'default'));""", """  const resourceId=String(resource.resource_id??resource.resourceId??createResourceId(resource.provider,resource.model,resource.account_binding??resource.accountBinding??'default',resource.runtime_binding??resource.runtimeBinding??'core'));""", 'resource fallback identity')

replace_once(router, """  const taskFailure=taskTotal?taskFail/taskTotal:globalFailure;
  const retries=Math.max(0,Number(stats.retry??stats.retries??0));""", """  const taskFailure=taskTotal?taskFail/taskTotal:globalFailure;
  const taskLatency=Math.max(0,Number(stats.avgLatencyMs??stats.avg_latency_ms??latency));
  const retries=Math.max(0,Number(stats.retry??stats.retries??0));""", 'task latency')
replace_once(router, """  let score=baseRank + globalFailure*25 + taskFailure*30 + retries*2 + failovers*3 + latency/1500;
  if(normalizedProfile==='FAST')score+=latency/350;""", """  let score=baseRank + globalFailure*25 + taskFailure*30 + retries*2 + failovers*3 + taskLatency/1500;
  if(normalizedProfile==='FAST')score+=taskLatency/350;""", 'task latency scoring')
replace_once(router, """  reasons.push(`base:${baseRank}`,`latency:${latency}`,`success:${successRate(resource).toFixed(2)}`,`taskFailure:${taskFailure.toFixed(2)}`);""", """  reasons.push(`base:${baseRank}`,`latency:${taskLatency}`,`success:${successRate(resource).toFixed(2)}`,`taskFailure:${taskFailure.toFixed(2)}`);""", 'task latency evidence')

replace_once(core, "const SURFSENSE_SUMMARY_MODEL = process.env.TIGERIQ_SURFSENSE_SUMMARY_MODEL?.trim() || 'gemma3:4b';", "const SURFSENSE_SUMMARY_MODEL = process.env.TIGERIQ_SURFSENSE_SUMMARY_MODEL?.trim() || 'gemma3:4b';\nconst OLLAMA_EMPLOYEE_ID = 'NV10';", 'NV10 constant')
replace_once(core, "  id, employeeId:id, resourceId:createResourceId(provider,'default'), name, provider, model, req, rank,", "  id, employeeId:id, resourceId:createResourceId(provider,model,'default','core'), name, provider, model, req, rank,", 'resource descriptor')
replace_once(core, "  R('NV02','Ollama','ollama',process.env.TIGERIQ_OLLAMA_MODEL || 'qwen3:4b',[],90),", "  R(OLLAMA_EMPLOYEE_ID,'Ollama','ollama',process.env.TIGERIQ_OLLAMA_MODEL || 'qwen3:4b',[],90),", 'Ollama NV10')
replace_once(core, """    const result={text:local.text,sources,researchProvider:'surfsense',aiProvider:'ollama',employeeId:'NV02',model:SURFSENSE_SUMMARY_MODEL,latencyMs:local.latencyMs}; await pool.query(\"update tigeriq_jobs set status='done',employee_id='NV02',provider='ollama',result=$2,lease_until=null,completed_at=now() where id=$1\",[id,JSON.stringify(result)]); await event('SURFSENSE_RESEARCH_DONE',{jobId:id,employeeId:'NV02',provider:'ollama'}); return {ok:true,jobId:id,...result};""", """    const ollama=resources.find(x=>x.provider==='ollama'); const result={text:local.text,sources,researchProvider:'surfsense',aiProvider:'ollama',employeeId:OLLAMA_EMPLOYEE_ID,resourceId:ollama?.resourceId||null,model:SURFSENSE_SUMMARY_MODEL,latencyMs:local.latencyMs}; await pool.query(\"update tigeriq_jobs set status='done',employee_id=$2,resource_id=$3,provider='ollama',result=$4,lease_until=null,completed_at=now() where id=$1\",[id,OLLAMA_EMPLOYEE_ID,ollama?.resourceId||null,JSON.stringify(result)]); await event('SURFSENSE_RESEARCH_DONE',{jobId:id,employeeId:OLLAMA_EMPLOYEE_ID,resourceId:ollama?.resourceId||null,provider:'ollama'}); return {ok:true,jobId:id,...result};""", 'SurfSense NV10 + resource id')

replace_once(core, """async function fetchJson(url, init = {}, timeoutMs = 90000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: c.signal });
    const text = await res.text();""", """async function fetchJson(url, init = {}, timeoutMs = 90000, onResponse = null) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: c.signal });
    if(onResponse)await onResponse(res);
    const text = await res.text();""", 'response telemetry hook')

replace_once(core, """  finally { clearTimeout(t); }
}
async function surfSenseHealth() {""", """  finally { clearTimeout(t); }
}
function quotaHeaderNumber(headers,name){const value=headers?.get?.(name);if(value===null||value===undefined||String(value).trim()==='')return null;const n=Number(value);return Number.isFinite(n)?Math.max(0,n):null;}
function quotaResetAt(headers){
  const retry=headers?.get?.('retry-after');
  if(retry){const seconds=Number(retry);if(Number.isFinite(seconds))return new Date(Date.now()+Math.max(0,seconds)*1000).toISOString();const parsed=Date.parse(retry);if(Number.isFinite(parsed))return new Date(parsed).toISOString();}
  for(const key of ['x-ratelimit-reset-requests','x-ratelimit-reset-tokens','x-ratelimit-reset']){const value=headers?.get?.(key);if(!value)continue;const parsed=Date.parse(value);if(Number.isFinite(parsed))return new Date(parsed).toISOString();const m=String(value).trim().match(/^(\\d+(?:\\.\\d+)?)(ms|s|m|h)$/i);if(m){const mult={ms:1,s:1000,m:60000,h:3600000}[m[2].toLowerCase()];return new Date(Date.now()+Number(m[1])*mult).toISOString();}}
  return null;
}
async function syncQuotaFromHeaders(r,res){
  const requestLimit=quotaHeaderNumber(res.headers,'x-ratelimit-limit-requests'),requestRemaining=quotaHeaderNumber(res.headers,'x-ratelimit-remaining-requests'),tokenLimit=quotaHeaderNumber(res.headers,'x-ratelimit-limit-tokens'),tokenRemaining=quotaHeaderNumber(res.headers,'x-ratelimit-remaining-tokens'),resetAt=quotaResetAt(res.headers);
  const known=[requestLimit,requestRemaining,tokenLimit,tokenRemaining].some(v=>v!==null);
  if(!known&&!resetAt&&res.status!==429)return;
  const ratios=[];if(requestLimit>0&&requestRemaining!==null)ratios.push(requestRemaining/requestLimit);if(tokenLimit>0&&tokenRemaining!==null)ratios.push(tokenRemaining/tokenLimit);
  const remainingRatio=ratios.length?Math.max(0,Math.min(1,Math.min(...ratios))):null;
  const quota=normalizeQuota({known,usable:res.status!==429&&(remainingRatio===null||remainingRatio>0),remainingRatio,requestLimit,requestRemaining,tokenLimit,tokenRemaining,resetAt,cooldownUntil:res.status===429?resetAt:null,last429At:res.status===429?nowIso():null,sourceConfidence:known?'high':'medium'});
  await pool.query(\"update tigeriq_ai_resources set quota_state=$2::jsonb,last_429_at=case when $3 then now() else last_429_at end,updated_at=now() where resource_id=$1\",[r.resourceId,JSON.stringify(quota),res.status===429]);
}
async function surfSenseHealth() {""", 'quota response telemetry')

replace_once(core, """async function openAiCompat(endpoint, key, model, prompt, extraHeaders = {}, timeoutMs = 90000) {
  const body = await fetchJson(endpoint, {
    method: 'POST', headers: { 'content-type':'application/json', authorization:`Bearer ${key}`, ...extraHeaders },
    body: JSON.stringify({ model, messages:[{role:'user',content:prompt}], temperature:0, max_tokens:1200, stream:false }),
  }, timeoutMs);""", """async function openAiCompat(endpoint, key, model, prompt, extraHeaders = {}, timeoutMs = 90000, resource = null) {
  const body = await fetchJson(endpoint, {
    method: 'POST', headers: { 'content-type':'application/json', authorization:`Bearer ${key}`, ...extraHeaders },
    body: JSON.stringify({ model, messages:[{role:'user',content:prompt}], temperature:0, max_tokens:1200, stream:false }),
  }, timeoutMs, resource?res=>syncQuotaFromHeaders(resource,res):null);""", 'OpenAI-compatible quota telemetry')

replace_once(core, "return openAiCompat('http://127.0.0.1:11434/v1/chat/completions','',r.model,prompt,{authorization:undefined},OLLAMA_TIMEOUT_MS);", "return openAiCompat('http://127.0.0.1:11434/v1/chat/completions','',r.model,prompt,{authorization:undefined},OLLAMA_TIMEOUT_MS,r);", 'Ollama response hook')
for label, old in [
    ('Groq', "return openAiCompat('https://api.groq.com/openai/v1/chat/completions',process.env.GROQ_API_KEY,r.model,prompt);"),
    ('OpenRouter', "return openAiCompat('https://openrouter.ai/api/v1/chat/completions',process.env.OPENROUTER_API_KEY,r.model,prompt);"),
    ('Mistral', "return openAiCompat('https://api.mistral.ai/v1/chat/completions',process.env.MISTRAL_API_KEY,r.model,prompt);"),
    ('HuggingFace', "return openAiCompat('https://router.huggingface.co/v1/chat/completions',process.env.HF_TOKEN,r.model,prompt);"),
    ('Vercel', "return openAiCompat('https://ai-gateway.vercel.sh/v1/chat/completions',process.env.AI_GATEWAY_API_KEY,r.model,prompt);"),
    ('NVIDIA', "return openAiCompat('https://integrate.api.nvidia.com/v1/chat/completions',process.env.NVIDIA_API_KEY,r.model,prompt);"),
]:
    replace_once(core, old, old[:-2] + ',{},90000,r);', f'{label} response hook')

replace_once(core, "function failureHealth(kind){return kind==='rate_limit'?'RATE_LIMITED':(kind==='auth'||kind==='configuration'?'OFFLINE':'ERROR');}", "function failureHealth(kind){return kind==='rate_limit'?'RATE_LIMITED':(['auth','configuration','security','credential','paid','production','irreversible'].includes(kind)?'OFFLINE':'ERROR');}", 'sensitive failure health')
replace_once(core, "  const quotaPatch=rateLimited?{known:false,usable:false,resetAt:cooldownUntil,last429At:nowIso(),sourceConfidence:'medium'}:null;", "  const quotaPatch=rateLimited?{usable:false,resetAt:cooldownUntil,cooldownUntil,last429At:nowIso(),sourceConfidence:'medium'}:null;", 'rate limit quota patch')

replace_once(core, """async function refreshResources() {
  for (const r of resources) {
    let credential""", """async function refreshResources() {
  const staleOllama=(await pool.query(\"select employee_id,current_job_id from tigeriq_resources where provider='ollama' and employee_id<>$1\",[OLLAMA_EMPLOYEE_ID])).rows;
  if(staleOllama.some(x=>x.current_job_id))throw new Error('STALE_OLLAMA_IDENTITY_BUSY');
  for(const stale of staleOllama){await pool.query(\"delete from tigeriq_resources where employee_id=$1 and provider='ollama'\",[stale.employee_id]);await event('RESOURCE_IDENTITY_MIGRATED',{fromEmployeeId:stale.employee_id,toEmployeeId:OLLAMA_EMPLOYEE_ID,provider:'ollama'});}
  for (const r of resources) {
    const legacyResourceId=createResourceId(r.provider,r.accountBinding);
    if(legacyResourceId!==r.resourceId){const legacy=(await pool.query('select enabled,current_job_id from tigeriq_ai_resources where resource_id=$1',[legacyResourceId])).rows[0];if(legacy?.current_job_id)throw new Error(`LEGACY_RESOURCE_ID_BUSY:${legacyResourceId}`);if(legacy?.enabled!==false&&legacy){await pool.query('update tigeriq_ai_resources set enabled=false,updated_at=now() where resource_id=$1',[legacyResourceId]);await event('RESOURCE_IDENTITY_SUPERSEDED',{employeeId:r.id,resourceId:r.resourceId,legacyResourceId,provider:r.provider});}}
    let credential""", 'incremental identity migration')

replace_once(core, """async function taskPerformance(taskKind='general'){
  const q=await pool.query(`select resource_id,count(*) filter(where type in ('RESOURCE_SUCCESS','RESOURCE_PROBE_OK'))::int as success,count(*) filter(where type in ('RESOURCE_FAILURE','RESOURCE_PROBE_FAIL'))::int as failure,count(*) filter(where type='ROUTING_RETRY')::int as retry,count(*) filter(where type='ROUTING_FAILOVER')::int as failover from tigeriq_events where resource_id is not null and ts>=now()-interval '7 days' and (task_kind=$1 or task_kind is null or $1='general') group by resource_id`,[taskKind]);
  return new Map(q.rows.map(x=>[x.resource_id,{success:Number(x.success||0),failure:Number(x.failure||0),retry:Number(x.retry||0),failover:Number(x.failover||0)}]));
}""", """async function taskPerformance(taskKind='general'){
  const q=await pool.query(`select resource_id,count(*) filter(where type in ('RESOURCE_SUCCESS','RESOURCE_PROBE_OK'))::int as success,count(*) filter(where type in ('RESOURCE_FAILURE','RESOURCE_PROBE_FAIL'))::int as failure,count(*) filter(where type='ROUTING_RETRY')::int as retry,count(*) filter(where type='ROUTING_FAILOVER')::int as failover,round(avg((data->>'latencyMs')::numeric) filter(where data ? 'latencyMs'))::int as avg_latency_ms from tigeriq_events where resource_id is not null and ts>=now()-interval '7 days' and (task_kind=$1 or task_kind is null or $1='general') group by resource_id`,[taskKind]);
  return new Map(q.rows.map(x=>[x.resource_id,{success:Number(x.success||0),failure:Number(x.failure||0),retry:Number(x.retry||0),failover:Number(x.failover||0),avgLatencyMs:Number(x.avg_latency_ms||0)}]));
}""", 'task performance latency')

Path('tests/smart-router.test.ts').write_text("""// @ts-nocheck
import { describe,expect,it } from 'vitest';
import { ROUTING_PROFILES,createResourceId,deriveRoutingProfile,failurePolicy,normalizeQuota,quotaUsable,rankCandidates } from '../apps/tigeriq-core/smart-router.mjs';

const base=(overrides={})=>({resource_id:'res:groq:free-model:default:core',employee_id:'NV11',provider:'groq',model:'free-model',enabled:true,health_state:'ONLINE',cooldown_until:null,cost_tier:'FREE',capabilities:['general','reasoning','review'],rank:10,success_count:9,failure_count:1,last_latency_ms:900,quota_state:{known:false,usable:true},taskStats:{general:{success:9,failure:1,retry:0,failover:0}},...overrides});

describe('#777 Smart Router foundation',()=>{
  it('exposes every required routing profile',()=>{expect(ROUTING_PROFILES).toEqual(['AUTO','CODING','FAST','CHEAP','LOCAL','RESEARCH','REVIEW']);});
  it('uses stable resource identity separate from employee identity while preserving legacy lookup shape',()=>{expect(createResourceId('Ollama','qwen3:4b','default','core')).toBe('res:ollama:qwen3-4b:default:core');expect(createResourceId('Ollama','default')).toBe('res:ollama:default');const a=base({resource_id:'res:ollama:qwen3-4b:default:core',employee_id:'NV02',provider:'ollama'});const b={...a,employee_id:'NV10'};expect(a.resource_id).toBe(b.resource_id);});
  it('derives profiles from task kind/capability without guessing unknown requests',()=>{expect(deriveRoutingProfile({capability:'coding'})).toBe('CODING');expect(deriveRoutingProfile({taskKind:'research'})).toBe('RESEARCH');expect(deriveRoutingProfile({requested:'weird'})).toBe('AUTO');});
  it('never selects paid fallback and prefers local for LOCAL',()=>{const paid=base({resource_id:'res:paid:model:default:core',provider:'paid',cost_tier:'PAID',rank:1});const local=base({resource_id:'res:ollama:qwen3-4b:default:core',employee_id:'NV10',provider:'ollama',cost_tier:'LOCAL',rank:90,last_latency_ms:5000});const remote=base();expect(rankCandidates([paid,local,remote],{profile:'AUTO'}).candidates.find(x=>x.resourceId==='res:paid:model:default:core')?.reasons).toContain('paid_fallback_forbidden');expect(rankCandidates([local,remote],{profile:'LOCAL'}).chosen?.resourceId).toBe('res:ollama:qwen3-4b:default:core');});
  it('enforces reviewer independence',()=>{const a=base();const b=base({resource_id:'res:gemini:model:default:core',employee_id:'NV12',provider:'gemini',rank:20});const d=rankCandidates([a,b],{profile:'REVIEW',capability:'review',reviewerResourceId:'res:groq:free-model:default:core'});expect(d.chosen?.resourceId).toBe('res:gemini:model:default:core');expect(d.candidates.find(x=>x.resourceId==='res:groq:free-model:default:core')?.reasons).toContain('reviewer_independence');});
  it('keeps unknown quota unknown, normalizes real request/token budgets, and blocks known cooldowns',()=>{expect(normalizeQuota({})).toMatchObject({known:false,usable:true,remainingRatio:null,requestLimit:null,requestRemaining:null,tokenLimit:null,tokenRemaining:null,sourceConfidence:'low'});expect(normalizeQuota({requestLimit:100,requestRemaining:25,tokenLimit:1000,tokenRemaining:500,sourceConfidence:'high'})).toMatchObject({known:true,remainingRatio:0.25,requestLimit:100,requestRemaining:25,tokenLimit:1000,tokenRemaining:500});expect(quotaUsable({known:true,usable:false,cooldownUntil:'2999-01-01T00:00:00Z'},Date.parse('2026-09-15T00:00:00Z'))).toBe(false);expect(rankCandidates([base({quota_state:{known:true,usable:false,resetAt:'2999-01-01T00:00:00Z'}})],{}).chosen).toBeNull();});
  it('filters active cooldown and uses task-specific latency/failure/retry/failover history',()=>{const slow=base({resource_id:'res:slow:model:default:core',provider:'slow',last_latency_ms:50,taskStats:{research:{success:1,failure:9,retry:3,failover:2,avgLatencyMs:9000}}});const fast=base({resource_id:'res:fast:model:default:core',provider:'fast',last_latency_ms:5000,taskStats:{research:{success:9,failure:1,retry:0,failover:0,avgLatencyMs:100}}});expect(rankCandidates([slow,fast],{profile:'FAST',taskKind:'research'}).chosen?.resourceId).toBe('res:fast:model:default:core');expect(rankCandidates([fast,{...slow,cooldown_until:'2999-01-01T00:00:00Z'}],{nowMs:Date.parse('2026-09-15T00:00:00Z')}).candidates.find(x=>x.resourceId==='res:slow:model:default:core')?.reasons).toContain('cooldown');});
  it('returns explainable decision evidence',()=>{const d=rankCandidates([base()],{profile:'AUTO',taskKind:'general',capability:'reasoning'});expect(d).toMatchObject({profile:'AUTO',taskKind:'general',capability:'reasoning'});expect(d.chosen?.reasons.length).toBeGreaterThan(0);expect(d.candidates[0]).toHaveProperty('score');});
  it('uses bounded failure policies and never auto-bypasses auth/config/security/paid/production boundaries',()=>{expect(failurePolicy('rate_limit')).toMatchObject({retrySameResource:false,failover:true,stop:false});expect(failurePolicy('timeout')).toMatchObject({retrySameResource:true,failover:true});expect(failurePolicy('invalid_response')).toMatchObject({failover:true,stop:false});for(const kind of ['auth','configuration','security','credential','paid','production','irreversible'])expect(failurePolicy(kind)).toMatchObject({failover:false,stop:true});});
});
""", encoding='utf-8')

Path('tests/core-smart-router-integration.test.ts').write_text("""import { readFileSync } from 'node:fs';
import { describe,expect,it } from 'vitest';

const core=readFileSync('apps/tigeriq-core/core.mjs','utf8');
const router=readFileSync('apps/tigeriq-core/smart-router.mjs','utf8');

describe('#777 Core Smart Router integration',()=>{
  it('separates AI resource identity from employee identity without rewriting historical jobs/events',()=>{expect(core).toContain('create table if not exists tigeriq_ai_resources');expect(core).toContain('resource_id text primary key');expect(core).toContain('employee_id text');expect(core).toContain("alter table tigeriq_jobs add column if not exists resource_id text");expect(core).toContain("alter table tigeriq_events add column if not exists resource_id text");expect(core).toContain("createResourceId(provider,model,'default','core')");expect(core).toContain('RESOURCE_IDENTITY_SUPERSEDED');});
  it('keeps Ollama current identity on NV10 and migrates stale current NV02 rows safely',()=>{expect(core).toContain("const OLLAMA_EMPLOYEE_ID = 'NV10';");expect(core).toContain("R(OLLAMA_EMPLOYEE_ID,'Ollama','ollama'");expect(core).not.toContain("R('NV02','Ollama','ollama'");expect(core).not.toContain("employeeId:'NV02',provider:'ollama'");expect(core).toContain("where provider='ollama' and employee_id<>$1");expect(core).toContain('STALE_OLLAMA_IDENTITY_BUSY');expect(core).toContain("event('RESOURCE_IDENTITY_MIGRATED'");});
  it('routes by profile/capability with explainable decision evidence',()=>{expect(core).toContain('deriveRoutingProfile');expect(core).toContain('rankCandidates');expect(core).toContain("event('ROUTING_DECISION'");expect(core).toContain('routing_profile');expect(core).toContain('routing_decision');});
  it('persists quota/rate-limit telemetry only from real provider signals or bounded cooldown evidence',()=>{expect(core).toContain('quota_state');expect(core).toContain('last_429_at');expect(core).toContain('syncQuotaFromHeaders');expect(core).toContain('x-ratelimit-limit-requests');expect(core).toContain('x-ratelimit-remaining-tokens');expect(core).toContain("kind==='rate_limit'");});
  it('uses task-kind performance and bounded failure-aware failover without paid fallback',()=>{expect(core).toContain('avg_latency_ms');expect(core).toContain('failurePolicy(kind)');expect(core).toContain('if(policy.stop)break');expect(router).toContain('paid_fallback_forbidden');expect(router).toContain("'security','credential','paid','production','irreversible'");});
  it('exposes routing/performance truth through the existing status snapshot',()=>{expect(core).toContain('routingDecisions');expect(core).toContain('performanceByTask');expect(core).toContain('quota_state');});
});
""", encoding='utf-8')

Path('tests/core-ollama-identity.test.ts').write_text("""import { readFileSync } from 'node:fs';
import { describe,expect,it } from 'vitest';
const coreSource=readFileSync(new URL('../apps/tigeriq-core/core.mjs',import.meta.url),'utf8');
describe('#775/#777 Core Ollama identity',()=>{
  it('uses NV10 as canonical Ollama identity',()=>{expect(coreSource).toContain("const OLLAMA_EMPLOYEE_ID = 'NV10';");expect(coreSource).toContain("R(OLLAMA_EMPLOYEE_ID,'Ollama','ollama'");expect(coreSource).not.toContain("R('NV02','Ollama','ollama'");});
  it('does not write new Ollama/SurfSense runtime records as NV02',()=>{expect(coreSource).not.toContain("employeeId:'NV02',provider:'ollama'");expect(coreSource).not.toContain("employee_id='NV02',provider='ollama'");expect(coreSource).toContain('employeeId:OLLAMA_EMPLOYEE_ID');expect(coreSource).toContain('resourceId:ollama?.resourceId||null');});
  it('fails closed on busy stale identity before current-row migration',()=>{expect(coreSource).toContain("where provider='ollama' and employee_id<>$1");expect(coreSource).toContain('STALE_OLLAMA_IDENTITY_BUSY');expect(coreSource).toContain("event('RESOURCE_IDENTITY_MIGRATED'");});
});
""", encoding='utf-8')

print('issue-777-hardening-v2: applied')
