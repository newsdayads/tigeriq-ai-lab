import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Pool } from 'pg';

const DATABASE_URL = process.env.DATABASE_URL?.trim();
if (!DATABASE_URL) throw new Error('DATABASE_URL_MISSING');
const HOST = process.env.TIGERIQ_CORE_HOST?.trim() || '127.0.0.1';
const PORT = Number(process.env.TIGERIQ_CORE_PORT || 8795);
const TOKEN = process.env.TIGERIQ_CORE_TOKEN?.trim() || '';
const POLL_MS = Number(process.env.TIGERIQ_CORE_POLL_MS || 1000);
const MANAGER_IDLE_MS = Number(process.env.TIGERIQ_MANAGER_IDLE_MS || 5000);
const pool = new Pool({ connectionString: DATABASE_URL, max: 4 });
pool.on('error', (err) => console.error(JSON.stringify({event:'PG_POOL_ERROR',error:String(err?.message||err)})));

const R = (id, name, provider, model, req = [], rank = 50) => ({
  id, name, provider, model, req, rank,
  capabilities: ['general', 'reasoning', 'coding', 'review'],
});
const resources = [
  R('NV02','Ollama','ollama',process.env.TIGERIQ_OLLAMA_MODEL || 'qwen3:4b',[],90),
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
  if (status === 401 || status === 403) return 'auth';
  if (status === 408 || status === 504) return 'timeout';
  if (status >= 500) return 'outage';
  return 'invalid_response';
}
async function fetchJson(url, init = {}, timeoutMs = 90000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: c.signal });
    const text = await res.text();
    let body; try { body = text ? JSON.parse(text) : {}; } catch { body = { text }; }
    if (!res.ok) { const e = new Error(`HTTP_${res.status}`); e.kind = classifyHttp(res.status); throw e; }
    return body;
  } catch (e) { if (e.name === 'AbortError') { e.kind = 'timeout'; } throw e; }
  finally { clearTimeout(t); }
}async function openAiCompat(endpoint, key, model, prompt, extraHeaders = {}) {
  const body = await fetchJson(endpoint, {
    method: 'POST', headers: { 'content-type':'application/json', authorization:`Bearer ${key}`, ...extraHeaders },
    body: JSON.stringify({ model, messages:[{role:'user',content:prompt}], temperature:0, max_tokens:1200, stream:false }),
  });
  const text = body?.choices?.[0]?.message?.content;
  if (!String(text || '').trim()) { const e = new Error('EMPTY_RESPONSE'); e.kind='invalid_response'; throw e; }
  return String(text);
}
async function invokeProvider(r, prompt) {
  switch (r.provider) {
    case 'ollama': return openAiCompat('http://127.0.0.1:11434/v1/chat/completions','',r.model,prompt,{authorization:undefined});
    case 'groq': return openAiCompat('https://api.groq.com/openai/v1/chat/completions',process.env.GROQ_API_KEY,r.model,prompt);
    case 'openrouter': return openAiCompat('https://openrouter.ai/api/v1/chat/completions',process.env.OPENROUTER_API_KEY,r.model,prompt);
    case 'mistral': return openAiCompat('https://api.mistral.ai/v1/chat/completions',process.env.MISTRAL_API_KEY,r.model,prompt);
    case 'huggingface': return openAiCompat('https://router.huggingface.co/v1/chat/completions',process.env.HF_TOKEN,r.model,prompt);
    case 'vercel': return openAiCompat('https://ai-gateway.vercel.sh/v1/chat/completions',process.env.AI_GATEWAY_API_KEY,r.model,prompt);
    case 'nvidia': return openAiCompat('https://integrate.api.nvidia.com/v1/chat/completions',process.env.NVIDIA_API_KEY,r.model,prompt);
    case 'gemini': {
      const b = await fetchJson(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(r.model)}:generateContent`, {
        method:'POST', headers:{'content-type':'application/json','x-goog-api-key':process.env.GEMINI_API_KEY},
        body:JSON.stringify({contents:[{role:'user',parts:[{text:prompt}]}]}) });
      const text = b?.candidates?.[0]?.content?.parts?.map(x=>x.text||'').join('\n');
      if (!String(text||'').trim()) { const e=new Error('EMPTY_RESPONSE'); e.kind='invalid_response'; throw e; }
      return String(text);
    }    case 'cloudflare': {
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
        body:JSON.stringify({model:r.model,messages:[{role:'user',content:prompt}],temperature:0,max_tokens:1200}) });
      const text = b?.message?.content?.map(x=>x.text||'').join('');
      if (!String(text||'').trim()) { const e=new Error('EMPTY_RESPONSE'); e.kind='invalid_response'; throw e; }
      return String(text);
    }
    case 'watsonx': {
      const form = new URLSearchParams({grant_type:'urn:ibm:params:oauth:grant-type:apikey',apikey:process.env.WATSONX_API_KEY});
      const iam = await fetchJson('https://iam.cloud.ibm.com/identity/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:form.toString()});
      const b = await fetchJson('https://us-south.ml.cloud.ibm.com/ml/v1/text/generation?version=2024-05-01',{
        method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${iam.access_token}`},
        body:JSON.stringify({model_id:process.env.WATSONX_MODEL_ID,input:prompt,project_id:process.env.WATSONX_PROJECT_ID,parameters:{max_new_tokens:1200,temperature:0}})});
      const text=b?.results?.[0]?.generated_text;
      if(!String(text||'').trim()){const e=new Error('EMPTY_RESPONSE');e.kind='invalid_response';throw e;} return String(text);
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
    create table if not exists tigeriq_events(
      seq bigserial primary key, ts timestamptz not null default now(), type text not null, objective_id text, job_id text, employee_id text, data jsonb not null default '{}'::jsonb);
    create index if not exists tigeriq_jobs_status_idx on tigeriq_jobs(status,created_at);
  `);
}
async function event(type, data = {}) {
  await pool.query('insert into tigeriq_events(type,objective_id,job_id,employee_id,data) values($1,$2,$3,$4,$5)',
    [type,data.objectiveId||null,data.jobId||null,data.employeeId||null,JSON.stringify(data)]);
}async function refreshResources() {
  for (const r of resources) {
    let credential = r.provider === 'ollama' ? 'LOCAL' : (!credentialPresent(r) ? 'WAIT_KEY' : (reqReady(r) ? 'READY' : 'BLOCKED'));
    let health = credential === 'WAIT_KEY' || credential === 'BLOCKED' ? 'OFFLINE' : 'READY';
    const old = (await pool.query('select health_state,work_state,last_seen_at,cooldown_until,current_job_id from tigeriq_resources where employee_id=$1',[r.id])).rows[0];
    if (r.provider === 'ollama') {
      try { await fetchJson('http://127.0.0.1:11434/api/tags',{},3000); health='ONLINE'; }
      catch { health='OFFLINE'; }
    } else if (old?.health_state === 'ONLINE' && old?.last_seen_at && (Date.now()-new Date(old.last_seen_at).getTime()) < 900000) {
      health='ONLINE';
    } else if (old?.health_state === 'RATE_LIMITED' || old?.health_state === 'ERROR' || old?.health_state === 'OFFLINE') {
      health=old.health_state;
    }
    if (r.provider !== 'ollama' && old?.health_state === 'RATE_LIMITED' && old?.cooldown_until && new Date(old.cooldown_until) > new Date()) health='RATE_LIMITED';
    const work = old?.current_job_id ? 'BUSY' : (health === 'ONLINE' ? 'IDLE' : (health === 'READY' ? 'READY' : health));
    await pool.query(`insert into tigeriq_resources(employee_id,name,provider,model,credential_state,health_state,work_state,current_job_id,capabilities,rank,updated_at)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now())
      on conflict(employee_id) do update set name=excluded.name,provider=excluded.provider,model=excluded.model,
      credential_state=excluded.credential_state,health_state=case when tigeriq_resources.current_job_id is null then excluded.health_state else tigeriq_resources.health_state end,
      work_state=case when tigeriq_resources.current_job_id is null then excluded.work_state else 'BUSY' end,
      capabilities=excluded.capabilities,rank=excluded.rank,updated_at=now()`,
      [r.id,r.name,r.provider,r.model,credential,health,work,old?.current_job_id||null,r.capabilities,r.rank]);
  }
}
async function recoverAfterCoreRestart() {
  const q=await pool.query("select id,employee_id from tigeriq_jobs where status='running' and kind='ai'");
  for(const j of q.rows){
    await pool.query("update tigeriq_jobs set status='queued',employee_id=null,provider=null,lease_until=null where id=$1",[j.id]);
    if(j.employee_id) await pool.query("update tigeriq_resources set current_job_id=null,work_state='IDLE',health_state=case when credential_state in ('WAIT_KEY','BLOCKED') then 'OFFLINE' else 'READY' end,updated_at=now() where employee_id=$1",[j.employee_id]);
    await event('JOB_RECOVERED_AFTER_CORE_RESTART',{jobId:j.id,employeeId:j.employee_id});
  }
}
async function recoverStale() {
  const stale = await pool.query("select id,employee_id from tigeriq_jobs where status='running' and lease_until < now()");
  for (const j of stale.rows) {
    await pool.query("update tigeriq_jobs set status='queued',employee_id=null,provider=null,lease_until=null,attempts=attempts+1 where id=$1",[j.id]);
    if (j.employee_id) await pool.query("update tigeriq_resources set current_job_id=null,work_state='IDLE',health_state='READY',updated_at=now() where employee_id=$1",[j.employee_id]);
    await event('JOB_LEASE_RECOVERED',{jobId:j.id,employeeId:j.employee_id});
  }
}async function candidates(capability='general') {
  const q = await pool.query(`select * from tigeriq_resources where enabled=true and credential_state in ('LOCAL','READY')
    and health_state in ('READY','ONLINE') and current_job_id is null and (cooldown_until is null or cooldown_until<=now())
    and ($1=any(capabilities) or 'general'=any(capabilities)) order by rank + failure_count*5 + coalesce(last_latency_ms,0)/1000 asc`,[capability]);
  return q.rows;
}
async function claimResource(capability, jobId, excluded=[]) {
  const c=await pool.connect();
  try { await c.query('begin');
    const q=await c.query(`select * from tigeriq_resources where enabled=true and credential_state in ('LOCAL','READY')
      and health_state in ('READY','ONLINE') and current_job_id is null and (cooldown_until is null or cooldown_until<=now())
      and ($1=any(capabilities) or 'general'=any(capabilities)) and not(employee_id=any($2::text[]))
      order by rank + failure_count*5 + coalesce(last_latency_ms,0)/1000 asc for update skip locked limit 1`,[capability,excluded]);
    const r=q.rows[0]; if(!r){await c.query('commit');return null;}
    await c.query("update tigeriq_resources set current_job_id=$2,work_state='BUSY',updated_at=now() where employee_id=$1",[r.employee_id,jobId]);
    await c.query('commit'); return r;
  } catch(e){await c.query('rollback');throw e;} finally{c.release();}
}
async function invokeRouted(prompt, capability, jobId, maxAttempts=3) {
  const failures=[],excluded=[];
  for(let i=0;i<maxAttempts;i++){
    const row=await claimResource(capability,jobId,excluded); if(!row) break; excluded.push(row.employee_id);
    const r=resources.find(x=>x.id===row.employee_id); if(!r) continue;
    await pool.query("update tigeriq_jobs set employee_id=$2,provider=$3,attempts=attempts+1,lease_until=now()+interval '5 minutes' where id=$1",[jobId,r.id,r.provider]);
    const started=Date.now();
    try { const text=await invokeProvider(r,prompt); const latency=Date.now()-started;
      await pool.query("update tigeriq_resources set current_job_id=null,work_state='IDLE',health_state='ONLINE',last_seen_at=now(),last_latency_ms=$2,success_count=success_count+1,updated_at=now() where employee_id=$1",[r.id,latency]);
      await event('RESOURCE_SUCCESS',{jobId,employeeId:r.id,provider:r.provider,latencyMs:latency}); return {text,resource:r,latencyMs:latency,failures};
    } catch(error){ const kind=error?.kind||'outage'; failures.push({employeeId:r.id,provider:r.provider,kind,message:String(error?.message||error)});
      const health=kind==='rate_limit'?'RATE_LIMITED':(kind==='auth'||kind==='configuration'?'OFFLINE':'ERROR'); const cooldown=kind==='rate_limit'?new Date(Date.now()+1800000).toISOString():null;
      await pool.query("update tigeriq_resources set current_job_id=null,work_state=$2,health_state=$3,cooldown_until=$4,last_seen_at=now(),failure_count=failure_count+1,updated_at=now() where employee_id=$1",[r.id,health,health,cooldown]); await event('RESOURCE_FAILURE',{jobId,employeeId:r.id,provider:r.provider,kind}); }
  }
  const e=new Error('NO_AI_RESOURCE_AVAILABLE');e.failures=failures;throw e;
}
async function probeResource(employeeId) {
  const r=resources.find(x=>x.id===employeeId); if(!r) throw new Error('RESOURCE_NOT_FOUND');
  if(!reqReady(r)&&r.provider!=='ollama') throw new Error('RESOURCE_CREDENTIAL_NOT_READY');
  const started=Date.now();
  try {
    const marker='TIGERIQ_RESOURCE_PROBE_'+r.id; const text=await invokeProvider(r,'Return exactly '+marker);
    if(!String(text).includes(marker)) throw Object.assign(new Error('PROBE_UNEXPECTED_RESPONSE'),{kind:'invalid_response'});
    const latency=Date.now()-started;
    await pool.query("update tigeriq_resources set health_state='ONLINE',work_state=case when current_job_id is null then 'IDLE' else 'BUSY' end,last_seen_at=now(),last_latency_ms=$2,cooldown_until=null,success_count=success_count+1,updated_at=now() where employee_id=$1",[r.id,latency]);
    await event('RESOURCE_PROBE_OK',{employeeId:r.id,provider:r.provider,latencyMs:latency}); return {ok:true,employeeId:r.id,provider:r.provider,latencyMs:latency};
  } catch(error) {
    const kind=error?.kind||'outage'; const health=kind==='rate_limit'?'RATE_LIMITED':(kind==='auth'||kind==='configuration'?'OFFLINE':'ERROR');
    const cooldown=new Date(Date.now()+(kind==='rate_limit'?1800000:300000)).toISOString();
    await pool.query("update tigeriq_resources set health_state=$2,work_state=$2,cooldown_until=$3,last_seen_at=now(),failure_count=failure_count+1,updated_at=now() where employee_id=$1",[r.id,health,cooldown]);
    await event('RESOURCE_PROBE_FAIL',{employeeId:r.id,provider:r.provider,kind,message:String(error?.message||error).slice(0,300)}); const e=new Error('RESOURCE_PROBE_FAILED');e.kind=kind;throw e;
  }
}
async function probeReadyResources() {
  const rows=(await pool.query("select employee_id,credential_state,health_state,current_job_id,last_seen_at,cooldown_until from tigeriq_resources where enabled=true and credential_state in ('LOCAL','READY') and current_job_id is null order by rank")).rows;
  const now=Date.now();
  for(const row of rows){
    const neverSeen=!row.last_seen_at;
    const staleOnline=row.health_state==='ONLINE' && row.last_seen_at && (now-new Date(row.last_seen_at).getTime())>=900000;
    const retryDue=['READY','ERROR','RATE_LIMITED','OFFLINE'].includes(row.health_state) && (!row.cooldown_until || new Date(row.cooldown_until).getTime()<=now);
    if(!neverSeen && !staleOnline && !retryDue) continue;
    try{await probeResource(row.employee_id);}catch{}
  }
}
async function claimJob() {
  const c=await pool.connect();
  try { await c.query('begin');
    const q=await c.query(`select j.* from tigeriq_jobs j join tigeriq_objectives o on o.id=j.objective_id
      where j.status='queued' and j.attempts<j.max_attempts and o.status='active'
      order by case o.priority when 'P0' then 0 when 'P1' then 1 when 'P2' then 2 else 3 end,j.created_at for update skip locked limit 1`);
    if(!q.rows[0]){await c.query('commit');return null;} const j=q.rows[0];
    await c.query("update tigeriq_jobs set status='running',started_at=coalesce(started_at,now()),lease_until=now()+interval '5 minutes' where id=$1",[j.id]);
    await c.query('commit'); return j;
  } catch(e){await c.query('rollback');throw e;} finally{c.release();}
}async function runJob(j) {
  try {
    const routed=await invokeRouted(j.prompt,j.capability,j.id,j.max_attempts-j.attempts);
    await pool.query("update tigeriq_jobs set status='done',employee_id=$2,provider=$3,result=$4,lease_until=null,completed_at=now() where id=$1",
      [j.id,routed.resource.id,routed.resource.provider,JSON.stringify({text:routed.text,latencyMs:routed.latencyMs,failures:routed.failures})]);
    await event('JOB_DONE',{jobId:j.id,objectiveId:j.objective_id,employeeId:routed.resource.id,provider:routed.resource.provider});
  } catch(error) {
    await pool.query("update tigeriq_jobs set status='failed',failure=$2,lease_until=null,completed_at=now() where id=$1",
      [j.id,JSON.stringify({message:String(error?.message||error),failures:error?.failures||[]})]);
    await event('JOB_FAILED',{jobId:j.id,objectiveId:j.objective_id});
  }
}
function parseManagerJson(text) {
  const clean=String(text||'').replace(/```json|```/gi,'').trim();
  const a=clean.indexOf('{'), b=clean.lastIndexOf('}');
  if(a<0||b<a) throw new Error('MANAGER_JSON_MISSING');
  const x=JSON.parse(clean.slice(a,b+1));
  if(!['continue','complete','blocked'].includes(x.status)) throw new Error('MANAGER_STATUS_INVALID');
  x.jobs=Array.isArray(x.jobs)?x.jobs.slice(0,3):[];
  return x;
}
async function managerTick() {
  const q=await pool.query(`select o.* from tigeriq_objectives o where o.status='active' and o.next_check_at<=now()
    and not exists(select 1 from tigeriq_jobs j where j.objective_id=o.id and j.status in ('queued','running'))
    order by case o.priority when 'P0' then 0 when 'P1' then 1 else 2 end,o.created_at limit 1`);
  const o=q.rows[0]; if(!o) return;
  if(o.manager_cycles>=30){await pool.query("update tigeriq_objectives set status='blocked',summary='manager cycle safety limit reached',updated_at=now() where id=$1",[o.id]);return;}
  const history=(await pool.query("select title,status,provider,result,failure from tigeriq_jobs where objective_id=$1 order by created_at desc limit 8",[o.id])).rows;
  const prompt=`You are TigerIQ AI Manager. Goal: ${o.objective}\nRecent work: ${JSON.stringify(history).slice(0,10000)}\nDecide the next useful work. Return ONLY JSON: {"status":"continue|complete|blocked","summary":"short","jobs":[{"title":"short","prompt":"standalone task instruction","capability":"general|reasoning|coding|review"}]}. Maximum 3 jobs. Prefer independent useful work. Never request paid services, Production/Main release, credential/security changes, destructive actions or reboot. If the goal is already achieved, status=complete.`;
  try {
    const routed=await invokeRouted(prompt,'reasoning',`MGR-${o.id}`,3); const decision=parseManagerJson(routed.text);
    await pool.query("update tigeriq_objectives set manager_cycles=manager_cycles+1,summary=$2,updated_at=now(),next_check_at=now()+interval '5 seconds' where id=$1",[o.id,String(decision.summary||'').slice(0,2000)]);
    if(decision.status!=='continue'){await pool.query('update tigeriq_objectives set status=$2,updated_at=now() where id=$1',[o.id,decision.status==='complete'?'completed':'blocked']);await event('OBJECTIVE_'+decision.status.toUpperCase(),{objectiveId:o.id});return;}
    for(const spec of decision.jobs){
      if(!spec?.title||!spec?.prompt) continue; const id=`JOB-${randomUUID()}`;
      await pool.query('insert into tigeriq_jobs(id,objective_id,title,prompt,capability) values($1,$2,$3,$4,$5)',[id,o.id,String(spec.title).slice(0,200),String(spec.prompt).slice(0,12000),['general','reasoning','coding','review'].includes(spec.capability)?spec.capability:'general']);
      await event('JOB_CREATED',{objectiveId:o.id,jobId:id});
    }
  } catch(error){await pool.query("update tigeriq_objectives set summary=$2,next_check_at=now()+interval '1 minute',updated_at=now() where id=$1",[o.id,`manager error: ${String(error?.message||error).slice(0,500)}`]);await event('MANAGER_ERROR',{objectiveId:o.id});}
}function publicStatus(r){
  if(!r.enabled) return 'DISABLED';
  if(r.credential_state==='WAIT_KEY') return 'WAIT_KEY';
  if(r.current_job_id||r.work_state==='BUSY') return 'BUSY';
  if(r.health_state==='RATE_LIMITED') return 'RATE_LIMITED';
  if(r.health_state==='ERROR') return 'ERROR';
  if(r.health_state==='OFFLINE') return 'OFFLINE';
  if(r.health_state==='ONLINE') return 'IDLE';
  return 'READY';
}
async function snapshot(){
  const base=(await pool.query('select * from tigeriq_resources order by employee_id')).rows;
  const failures=(await pool.query(`select distinct on(employee_id) employee_id,ts,type,data from tigeriq_events
    where employee_id is not null and type in ('RESOURCE_FAILURE','RESOURCE_PROBE_FAIL') order by employee_id,seq desc`)).rows;
  const failureMap=new Map(failures.map(x=>[x.employee_id,x]));
  const callStats=(await pool.query(`select employee_id,
    count(*) filter(where type in ('RESOURCE_SUCCESS','RESOURCE_PROBE_OK'))::int as ok,
    count(*) filter(where type in ('RESOURCE_FAILURE','RESOURCE_PROBE_FAIL'))::int as fail
    from tigeriq_events where employee_id is not null and ts>=now()-interval '24 hours'
    and type in ('RESOURCE_SUCCESS','RESOURCE_PROBE_OK','RESOURCE_FAILURE','RESOURCE_PROBE_FAIL') group by employee_id`)).rows;
  const statMap=new Map(callStats.map(x=>[x.employee_id,x]));
  const rr=base.map(x=>{const f=failureMap.get(x.employee_id),st=statMap.get(x.employee_id)||{ok:0,fail:0};return {...x,status:publicStatus(x),last_error:f?.data?.kind||f?.data?.message||null,last_error_at:f?.ts||null,calls_success_24h:Number(st.ok||0),calls_failure_24h:Number(st.fail||0)};});
  const objectives=(await pool.query("select id,objective,priority,status,summary,manager_cycles,updated_at from tigeriq_objectives order by created_at desc limit 20")).rows;
  const jobs=(await pool.query("select id,objective_id,title,capability,status,employee_id,provider,attempts,created_at,started_at,completed_at from tigeriq_jobs order by created_at desc limit 40")).rows;
  const events=(await pool.query("select seq,ts,type,objective_id,job_id,employee_id,data from tigeriq_events order by seq desc limit 80")).rows;
  const telemetry=(await pool.query(`select ts,employee_id,type,(data->>'latencyMs')::int as latency_ms from tigeriq_events
    where ts>=now()-interval '24 hours' and type in ('RESOURCE_SUCCESS','RESOURCE_PROBE_OK') and data ? 'latencyMs'
    order by ts asc limit 500`)).rows;
  return {ok:true,core:{host:HOST,port:PORT,pid:process.pid,uptimeSec:Math.floor(process.uptime()),time:nowIso()},resources:rr,objectives,jobs,events,telemetry};
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
    if(req.method==='GET'&&url.pathname==='/'){res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});return res.end(dashboard());}
    if(req.method==='POST'&&url.pathname==='/api/resources/probe'){
      if(!auth(req)&&!localSelf(req)){res.writeHead(401);return res.end('unauthorized');}
      const b=await readBody(req); const result=await probeResource(String(b.employeeId||''));
      res.writeHead(200,{'content-type':'application/json'});return res.end(JSON.stringify(result));
    }
    if(req.method==='POST'&&url.pathname==='/api/objectives'){
      if(!auth(req)&&!localSelf(req)){res.writeHead(401);return res.end('unauthorized');}
      const b=await readBody(req); if(!String(b.objective||'').trim()){res.writeHead(400);return res.end('objective_required');}
      const id=`OBJ-${randomUUID()}`; const priority=['P0','P1','P2'].includes(b.priority)?b.priority:'P1';
      await pool.query('insert into tigeriq_objectives(id,objective,priority,metadata) values($1,$2,$3,$4)',[id,String(b.objective).slice(0,12000),priority,JSON.stringify({source:b.source||'api'})]);
      await event('OBJECTIVE_CREATED',{objectiveId:id}); res.writeHead(201,{'content-type':'application/json'});return res.end(JSON.stringify({ok:true,id}));
    }
    res.writeHead(404);res.end('not_found');
  }catch(e){res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({ok:false,error:String(e?.message||e)}));}
});

let stop=false, lastRefresh=0, lastRecover=0, lastManager=0, lastProbe=0; const active=new Set(); const MAX_PARALLEL=3;
async function loop(){
  while(!stop){const t=Date.now();
    try{
      if(t-lastRefresh>15000){await refreshResources();lastRefresh=t;}
      if(t-lastRecover>10000){await recoverStale();lastRecover=t;}
      if(t-lastManager>MANAGER_IDLE_MS){await managerTick();lastManager=t;}
      if(t-lastProbe>60000){await probeReadyResources();lastProbe=t;}
      while(active.size<MAX_PARALLEL){const j=await claimJob();if(!j)break;active.add(j.id);void runJob(j).finally(()=>active.delete(j.id));}
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