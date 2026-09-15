from pathlib import Path


def replace_exact(path, old, new, count=1):
    p=Path(path); s=p.read_text(encoding='utf-8'); n=s.count(old)
    if n!=count: raise SystemExit(f'{path}: expected {count} anchors, got {n}: {old[:100]!r}')
    p.write_text(s.replace(old,new,count),encoding='utf-8')

router='apps/tigeriq-core/smart-router.mjs'
core='apps/tigeriq-core/core.mjs'
test='tests/smart-router.test.ts'

replace_exact(router,"""export function createResourceId(provider, account='default') {
  const p=String(provider||'unknown').trim().toLowerCase().replace(/[^a-z0-9._-]+/g,'-');
  const a=String(account||'default').trim().toLowerCase().replace(/[^a-z0-9._-]+/g,'-');
  return `res:${p}:${a}`;
}""","""function resourcePart(value, fallback) {
  return String(value||fallback).trim().toLowerCase().replace(/[^a-z0-9._-]+/g,'-').replace(/^-+|-+$/g,'')||fallback;
}
export function createResourceId(provider, modelOrAccount='unknown', account, runtime='core') {
  const p=resourcePart(provider,'unknown');
  if(account===undefined)return `res:${p}:${resourcePart(modelOrAccount,'default')}`; // legacy provenance compatibility
  return `res:${p}:${resourcePart(modelOrAccount,'unknown')}:${resourcePart(account,'default')}:${resourcePart(runtime,'core')}`;
}""")

replace_exact(router,"""export function normalizeQuota(raw={}) {
  const q=raw&&typeof raw==='object'?raw:{};
  const known=q.known===true;
  const usable=q.usable!==false;
  const remainingRatio=Number.isFinite(Number(q.remainingRatio))?Math.max(0,Math.min(1,Number(q.remainingRatio))):null;
  const resetAt=q.resetAt?String(q.resetAt):null;
  const last429At=q.last429At?String(q.last429At):null;
  const sourceConfidence=['high','medium','low'].includes(String(q.sourceConfidence))?String(q.sourceConfidence):'low';
  return {known,usable,remainingRatio,resetAt,last429At,sourceConfidence};
}""","""export function normalizeQuota(raw={}) {
  const q=raw&&typeof raw==='object'?raw:{};
  const finite=(value)=>Number.isFinite(Number(value))?Math.max(0,Number(value)):null;
  const requestLimit=finite(q.requestLimit??q.requestsLimit);
  const requestRemaining=finite(q.requestRemaining??q.requestsRemaining);
  const tokenLimit=finite(q.tokenLimit??q.tokensLimit);
  const tokenRemaining=finite(q.tokenRemaining??q.tokensRemaining);
  let remainingRatio=Number.isFinite(Number(q.remainingRatio))?Math.max(0,Math.min(1,Number(q.remainingRatio))):null;
  const ratios=[];
  if(requestLimit&&requestRemaining!==null)ratios.push(Math.max(0,Math.min(1,requestRemaining/requestLimit)));
  if(tokenLimit&&tokenRemaining!==null)ratios.push(Math.max(0,Math.min(1,tokenRemaining/tokenLimit)));
  if(remainingRatio===null&&ratios.length)remainingRatio=Math.min(...ratios);
  const known=q.known===true||[requestLimit,requestRemaining,tokenLimit,tokenRemaining].some(v=>v!==null);
  const usable=q.usable!==false;
  const resetAt=q.resetAt?String(q.resetAt):null;
  const cooldownUntil=q.cooldownUntil?String(q.cooldownUntil):null;
  const last429At=q.last429At?String(q.last429At):null;
  const sourceConfidence=['high','medium','low'].includes(String(q.sourceConfidence))?String(q.sourceConfidence):'low';
  return {known,usable,remainingRatio,requestLimit,requestRemaining,tokenLimit,tokenRemaining,resetAt,cooldownUntil,last429At,sourceConfidence};
}""")
replace_exact(router,"""  if(!q.resetAt)return false;
  const reset=Date.parse(q.resetAt);""","""  const recoveryAt=q.resetAt||q.cooldownUntil;
  if(!recoveryAt)return false;
  const reset=Date.parse(recoveryAt);""")
replace_exact(router,"""  const resourceId=String(resource.resource_id??resource.resourceId??createResourceId(resource.provider,resource.account_binding??resource.accountBinding??'default'));""","""  const resourceId=String(resource.resource_id??resource.resourceId??createResourceId(resource.provider,resource.model,resource.account_binding??resource.accountBinding??'default',resource.runtime_binding??resource.runtimeBinding??'core'));""")
replace_exact(router,"""  const taskFailure=taskTotal?taskFail/taskTotal:globalFailure;
  const retries=Math.max(0,Number(stats.retry??stats.retries??0));""","""  const taskFailure=taskTotal?taskFail/taskTotal:globalFailure;
  const taskLatency=Math.max(0,Number(stats.avgLatencyMs??stats.avg_latency_ms??latency));
  const retries=Math.max(0,Number(stats.retry??stats.retries??0));""")
replace_exact(router,"""  let score=baseRank + globalFailure*25 + taskFailure*30 + retries*2 + failovers*3 + latency/1500;
  if(normalizedProfile==='FAST')score+=latency/350;""","""  let score=baseRank + globalFailure*25 + taskFailure*30 + retries*2 + failovers*3 + taskLatency/1500;
  if(normalizedProfile==='FAST')score+=taskLatency/350;""")
replace_exact(router,"""  reasons.push(`base:${baseRank}`,`latency:${latency}`,`success:${successRate(resource).toFixed(2)}`,`taskFailure:${taskFailure.toFixed(2)}`);""","""  reasons.push(`base:${baseRank}`,`latency:${taskLatency}`,`success:${successRate(resource).toFixed(2)}`,`taskFailure:${taskFailure.toFixed(2)}`);""")

replace_exact(core,"const SURFSENSE_SUMMARY_MODEL = process.env.TIGERIQ_SURFSENSE_SUMMARY_MODEL?.trim() || 'gemma3:4b';","const SURFSENSE_SUMMARY_MODEL = process.env.TIGERIQ_SURFSENSE_SUMMARY_MODEL?.trim() || 'gemma3:4b';\nconst OLLAMA_EMPLOYEE_ID = 'NV10';")
replace_exact(core,"""  id, employeeId:id, resourceId:createResourceId(provider,'default'), name, provider, model, req, rank,""","""  id, employeeId:id, resourceId:createResourceId(provider,model,'default','core'), name, provider, model, req, rank,""")
replace_exact(core,"R('NV02','Ollama','ollama',process.env.TIGERIQ_OLLAMA_MODEL || 'qwen3:4b',[],90),","R(OLLAMA_EMPLOYEE_ID,'Ollama','ollama',process.env.TIGERIQ_OLLAMA_MODEL || 'qwen3:4b',[],90),")
replace_exact(core,"""    const result={text:local.text,sources,researchProvider:'surfsense',aiProvider:'ollama',employeeId:'NV02',model:SURFSENSE_SUMMARY_MODEL,latencyMs:local.latencyMs}; await pool.query(\"update tigeriq_jobs set status='done',employee_id='NV02',provider='ollama',result=$2,lease_until=null,completed_at=now() where id=$1\",[id,JSON.stringify(result)]); await event('SURFSENSE_RESEARCH_DONE',{jobId:id,employeeId:'NV02',provider:'ollama'}); return {ok:true,jobId:id,...result};""","""    const ollama=resources.find(x=>x.provider==='ollama'); const result={text:local.text,sources,researchProvider:'surfsense',aiProvider:'ollama',employeeId:OLLAMA_EMPLOYEE_ID,resourceId:ollama?.resourceId||null,model:SURFSENSE_SUMMARY_MODEL,latencyMs:local.latencyMs}; await pool.query(\"update tigeriq_jobs set status='done',employee_id=$2,resource_id=$3,provider='ollama',result=$4,lease_until=null,completed_at=now() where id=$1\",[id,OLLAMA_EMPLOYEE_ID,ollama?.resourceId||null,JSON.stringify(result)]); await event('SURFSENSE_RESEARCH_DONE',{jobId:id,employeeId:OLLAMA_EMPLOYEE_ID,resourceId:ollama?.resourceId||null,provider:'ollama'}); return {ok:true,jobId:id,...result};""")

replace_exact(core,"""async function fetchJson(url, init = {}, timeoutMs = 90000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: c.signal });
    const text = await res.text();""","""async function fetchJson(url, init = {}, timeoutMs = 90000, onResponse = null) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: c.signal });
    if(onResponse)await onResponse(res);
    const text = await res.text();""")

fetch_anchor="""  finally { clearTimeout(t); }
}
async function surfSenseHealth() {"""
quota_helpers="""  finally { clearTimeout(t); }
}
function quotaHeaderNumber(headers,name){const value=headers?.get?.(name);if(value===null||value===undefined||String(value).trim()==='')return null;const n=Number(value);return Number.isFinite(n)?Math.max(0,n):null;}
function quotaResetAt(headers){
  const retry=headers?.get?.('retry-after');
  if(retry){const seconds=Number(retry);if(Number.isFinite(seconds))return new Date(Date.now()+Math.max(0,seconds)*1000).toISOString();const parsed=Date.parse(retry);if(Number.isFinite(parsed))return new Date(parsed).toISOString();}
  for(const key of ['x-ratelimit-reset-requests','x-ratelimit-reset-tokens','x-ratelimit-reset']){const value=headers?.get?.(key);if(!value)continue;const parsed=Date.parse(value);if(Number.isFinite(parsed))return new Date(parsed).toISOString();const m=String(value).trim().match(/^(\\d+(?:\\.\\d+)?)(ms|s|m|h)$/i);if(m){const mult={ms:1,s:1000,m:60000,h:3600000}[m[2].toLowerCase()];return new Date(Date.now()+Number(m[1])*mult).toISOString();}}
  return null;
}
async function syncQuotaFromHeaders(r,res){
  const requestLimit=quotaHeaderNumber(res.headers,'x-ratelimit-limit-requests'),requestRemaining=quotaHeaderNumber(res.headers,'x-ratelimit-remaining-requests'),tokenLimit=quotaHeaderNumber(res.headers,'x-ratelimit-limit-tokens'),tokenRemaining=quotaHeaderNumber(res.headers,'x-ratelimit-remaining-tokens'),resetAt=quotaResetAt(res.headers);const known=[requestLimit,requestRemaining,tokenLimit,tokenRemaining].some(v=>v!==null);if(!known&&!resetAt&&res.status!==429)return;const ratios=[];if(requestLimit&&requestRemaining!==null)ratios.push(requestRemaining/requestLimit);if(tokenLimit&&tokenRemaining!==null)ratios.push(tokenRemaining/tokenLimit);const remainingRatio=ratios.length?Math.max(0,Math.min(1,Math.min(...ratios))):null;const quota=normalizeQuota({known,usable:res.status!==429&&(remainingRatio===null||remainingRatio>0),remainingRatio,requestLimit,requestRemaining,tokenLimit,tokenRemaining,resetAt,cooldownUntil:res.status===429?resetAt:null,last429At:res.status===429?nowIso():null,sourceConfidence:known?'high':'medium'});await pool.query(\"update tigeriq_ai_resources set quota_state=$2::jsonb,last_429_at=case when $3 then now() else last_429_at end,updated_at=now() where resource_id=$1\",[r.resourceId,JSON.stringify(quota),res.status===429]);}
async function surfSenseHealth() {"""
replace_exact(core,fetch_anchor,quota_helpers)

replace_exact(core,"""async function openAiCompat(endpoint, key, model, prompt, extraHeaders = {}, timeoutMs = 90000) {
  const body = await fetchJson(endpoint, {
    method: 'POST', headers: { 'content-type':'application/json', authorization:`Bearer ${key}`, ...extraHeaders },
    body: JSON.stringify({ model, messages:[{role:'user',content:prompt}], temperature:0, max_tokens:1200, stream:false }),
  }, timeoutMs);""","""async function openAiCompat(endpoint, key, model, prompt, extraHeaders = {}, timeoutMs = 90000, resource = null) {
  const body = await fetchJson(endpoint, {
    method: 'POST', headers: { 'content-type':'application/json', authorization:`Bearer ${key}`, ...extraHeaders },
    body: JSON.stringify({ model, messages:[{role:'user',content:prompt}], temperature:0, max_tokens:1200, stream:false }),
  }, timeoutMs, resource?res=>syncQuotaFromHeaders(resource,res):null);""")
replace_exact(core,"return openAiCompat('http://127.0.0.1:11434/v1/chat/completions','',r.model,prompt,{authorization:undefined},OLLAMA_TIMEOUT_MS);","return openAiCompat('http://127.0.0.1:11434/v1/chat/completions','',r.model,prompt,{authorization:undefined},OLLAMA_TIMEOUT_MS,r);")
for provider,needle in [
 ('groq',"return openAiCompat('https://api.groq.com/openai/v1/chat/completions',process.env.GROQ_API_KEY,r.model,prompt);"),
 ('openrouter',"return openAiCompat('https://openrouter.ai/api/v1/chat/completions',process.env.OPENROUTER_API_KEY,r.model,prompt);"),
 ('mistral',"return openAiCompat('https://api.mistral.ai/v1/chat/completions',process.env.MISTRAL_API_KEY,r.model,prompt);"),
 ('huggingface',"return openAiCompat('https://router.huggingface.co/v1/chat/completions',process.env.HF_TOKEN,r.model,prompt);"),
 ('vercel',"return openAiCompat('https://ai-gateway.vercel.sh/v1/chat/completions',process.env.AI_GATEWAY_API_KEY,r.model,prompt);"),
 ('nvidia',"return openAiCompat('https://integrate.api.nvidia.com/v1/chat/completions',process.env.NVIDIA_API_KEY,r.model,prompt);")]:
    replace_exact(core,needle,needle[:-2]+",{},90000,r);")

replace_exact(core,"""  const quotaPatch=rateLimited?{known:false,usable:false,resetAt:cooldownUntil,last429At:nowIso(),sourceConfidence:'medium'}:null;""","""  const quotaPatch=rateLimited?{usable:false,resetAt:cooldownUntil,cooldownUntil,last429At:nowIso(),sourceConfidence:'medium'}:null;""")
replace_exact(core,"""async function refreshResources() {
  for (const r of resources) {
    let credential""","""async function refreshResources() {
  for (const r of resources) {
    const legacyResourceId=createResourceId(r.provider,r.accountBinding);
    if(legacyResourceId!==r.resourceId){const legacy=(await pool.query('select enabled,current_job_id from tigeriq_ai_resources where resource_id=$1',[legacyResourceId])).rows[0];if(legacy?.current_job_id)throw new Error(`LEGACY_RESOURCE_ID_BUSY:${legacyResourceId}`);if(legacy?.enabled!==false&&legacy){await pool.query('update tigeriq_ai_resources set enabled=false,updated_at=now() where resource_id=$1',[legacyResourceId]);await event('RESOURCE_IDENTITY_SUPERSEDED',{employeeId:r.id,resourceId:r.resourceId,legacyResourceId,provider:r.provider});}}
    let credential""")
replace_exact(core,"""async function taskPerformance(taskKind='general'){
  const q=await pool.query(`select resource_id,count(*) filter(where type in ('RESOURCE_SUCCESS','RESOURCE_PROBE_OK'))::int as success,count(*) filter(where type in ('RESOURCE_FAILURE','RESOURCE_PROBE_FAIL'))::int as failure,count(*) filter(where type='ROUTING_RETRY')::int as retry,count(*) filter(where type='ROUTING_FAILOVER')::int as failover from tigeriq_events where resource_id is not null and ts>=now()-interval '7 days' and (task_kind=$1 or task_kind is null or $1='general') group by resource_id`,[taskKind]);
  return new Map(q.rows.map(x=>[x.resource_id,{success:Number(x.success||0),failure:Number(x.failure||0),retry:Number(x.retry||0),failover:Number(x.failover||0)}]));
}""","""async function taskPerformance(taskKind='general'){
  const q=await pool.query(`select resource_id,count(*) filter(where type in ('RESOURCE_SUCCESS','RESOURCE_PROBE_OK'))::int as success,count(*) filter(where type in ('RESOURCE_FAILURE','RESOURCE_PROBE_FAIL'))::int as failure,count(*) filter(where type='ROUTING_RETRY')::int as retry,count(*) filter(where type='ROUTING_FAILOVER')::int as failover,round(avg((data->>'latencyMs')::numeric) filter(where data ? 'latencyMs'))::int as avg_latency_ms from tigeriq_events where resource_id is not null and ts>=now()-interval '7 days' and (task_kind=$1 or task_kind is null or $1='general') group by resource_id`,[taskKind]);
  return new Map(q.rows.map(x=>[x.resource_id,{success:Number(x.success||0),failure:Number(x.failure||0),retry:Number(x.retry||0),failover:Number(x.failover||0),avgLatencyMs:Number(x.avg_latency_ms||0)}]));
}""")

# Tests: full identity, quota budgets, task-latency scoring, and no NV02 Ollama regression.
p=Path(test); s=p.read_text(encoding='utf-8')
s=s.replace("resource_id:'res:groq:default'","resource_id:'res:groq:free-model:default:core'")
s=s.replace("expect(createResourceId('Ollama','default')).toBe('res:ollama:default');const a=base({resource_id:'res:ollama:default',employee_id:'NV02',provider:'ollama'});const b={...a,employee_id:'NV10'};expect(a.resource_id).toBe(b.resource_id);","expect(createResourceId('Ollama','qwen3:4b','default','core')).toBe('res:ollama:qwen3-4b:default:core');expect(createResourceId('Ollama','default')).toBe('res:ollama:default');const a=base({resource_id:'res:ollama:qwen3-4b:default:core',employee_id:'NV02',provider:'ollama'});const b={...a,employee_id:'NV10'};expect(a.resource_id).toBe(b.resource_id);")
s=s.replace("res:paid:default","res:paid:model:default:core").replace("res:ollama:default","res:ollama:qwen3-4b:default:core").replace("res:gemini:default","res:gemini:model:default:core").replace("res:groq:default","res:groq:free-model:default:core").replace("res:slow:default","res:slow:model:default:core").replace("res:fast:default","res:fast:model:default:core")
s=s.replace("expect(normalizeQuota({})).toMatchObject({known:false,usable:true,remainingRatio:null,sourceConfidence:'low'});","expect(normalizeQuota({})).toMatchObject({known:false,usable:true,remainingRatio:null,requestLimit:null,requestRemaining:null,tokenLimit:null,tokenRemaining:null,sourceConfidence:'low'});expect(normalizeQuota({requestLimit:100,requestRemaining:25,tokenLimit:1000,tokenRemaining:500,sourceConfidence:'high'})).toMatchObject({known:true,remainingRatio:0.25,requestLimit:100,requestRemaining:25,tokenLimit:1000,tokenRemaining:500});")
anchor="  it('returns explainable decision evidence',()=>"
extra="  it('uses task-specific latency instead of only global latency',()=>{const slowTask=base({resource_id:'res:a:m:default:core',provider:'a',rank:10,last_latency_ms:50,taskStats:{research:{success:9,failure:1,avgLatencyMs:9000}}});const fastTask=base({resource_id:'res:b:m:default:core',provider:'b',rank:10,last_latency_ms:5000,taskStats:{research:{success:9,failure:1,avgLatencyMs:100}}});expect(rankCandidates([slowTask,fastTask],{profile:'FAST',taskKind:'research'}).chosen?.resourceId).toBe('res:b:m:default:core');});\n"
if s.count(anchor)!=1: raise SystemExit('smart-router test anchor missing')
s=s.replace(anchor,extra+anchor,1)
p.write_text(s,encoding='utf-8')

integration=Path('tests/core-smart-router-integration.test.ts')
si=integration.read_text(encoding='utf-8')
anchor="describe('#777 Core integration',()=>{"
if si.count(anchor)!=1: raise SystemExit('integration test anchor missing')
extra="""describe('#777 current workforce/resource identity regression',()=>{
  it('never reintroduces NV02 as Ollama current resource',()=>{const source=readFileSync('apps/tigeriq-core/core.mjs','utf8');expect(source).toContain(\"const OLLAMA_EMPLOYEE_ID = 'NV10';\");expect(source).toContain(\"R(OLLAMA_EMPLOYEE_ID,'Ollama','ollama'\");expect(source).not.toContain(\"R('NV02','Ollama','ollama'\");expect(source).not.toContain(\"employeeId:'NV02',provider:'ollama'\");});
  it('uses provider model account runtime in current resource identity',()=>{const source=readFileSync('apps/tigeriq-core/core.mjs','utf8');expect(source).toContain(\"createResourceId(provider,model,'default','core')\");expect(source).toContain('RESOURCE_IDENTITY_SUPERSEDED');});
  it('captures normalized provider quota headers when available',()=>{const source=readFileSync('apps/tigeriq-core/core.mjs','utf8');expect(source).toContain('x-ratelimit-limit-requests');expect(source).toContain('x-ratelimit-remaining-tokens');expect(source).toContain('syncQuotaFromHeaders');});
});

"""
integration.write_text(si.replace(anchor,extra+anchor,1),encoding='utf-8')
