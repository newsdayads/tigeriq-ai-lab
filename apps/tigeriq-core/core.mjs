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
const SURFSENSE_APP_URL = process.env.TIGERIQ_SURFSENSE_APP_URL?.trim() || 'http://127.0.0.1:3929';
const SURFSENSE_SEARCH_URL = process.env.TIGERIQ_SURFSENSE_SEARCH_URL?.trim() || 'http://127.0.0.1:3930/search';
const SURFSENSE_SUMMARY_MODEL = process.env.TIGERIQ_SURFSENSE_SUMMARY_MODEL?.trim() || 'gemma3:4b';
const pool = new Pool({ connectionString: DATABASE_URL, max: 4 });
pool.on('error', (err) => console.error(JSON.stringify({event:'PG_POOL_ERROR',error:String(err?.message||err)})));

const R = (id, name, provider, model, req = [], rank = 50) => ({
  id, name, provider, model, req, rank,
  capabilities: ['general', 'reasoning', 'review'],
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
    const result={text:local.text,sources,researchProvider:'surfsense',aiProvider:'ollama',employeeId:'NV02',model:SURFSENSE_SUMMARY_MODEL,latencyMs:local.latencyMs}; await pool.query("update tigeriq_jobs set status='done',employee_id='NV02',provider='ollama',result=$2,lease_until=null,completed_at=now() where id=$1",[id,JSON.stringify(result)]); await event('SURFSENSE_RESEARCH
...[MODEL_CONTEXT_REDUCED]...
t pool.query(`select employee_id,
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
  return {ok:true,core:{host:HOST,port:PORT,pid:process.pid,uptimeSec:Math.floor(process.uptime()),time:nowIso()},integrations:{surfsense:await surfSenseHealth()},resources:rr,objectives,jobs,events,telemetry};
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
    if(req.method==='POST'&&url.pathname==='/api/research'){
      if(!auth(req)&&!localSelf(req)){res.writeHead(401);return res.end('unauthorized');}
      const b=await readBody(req); const query=String(b.query||'').trim(); if(!query){res.writeHead(400);return res.end('query_required');}
      const result=await runSurfSenseResearch(query,Number(b.limit||6)); res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});return res.end(JSON.stringify(result));
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

let stop=false, lastRefresh=0, lastRecover=0, lastManager=0, lastProbe=0, lastIdleAudit=0; const active=new Set(); const MAX_PARALLEL=3; let nextIdleAuditInterval = 10 * 60 * 1000 + Math.floor(Math.random() * (20 * 60 * 1000 + 1));
async function auditIdleNode(){
  const t = Date.now();
  if (t - lastIdleAudit < nextIdleAuditInterval) return;
  lastIdleAudit = t;
  nextIdleAuditInterval = 10 * 60 * 1000 + Math.floor(Math.random() * (20 * 60 * 1000 + 1));

  try {
    const res = await pool.query(
      `select * from tigeriq_resources where enabled = true and work_state not in ('BUSY', 'CRITICAL') and health_state not in ('RATE_LIMITED', 'OFFLINE', 'ERROR', 'BLOCKED', 'CRITICAL') and credential_state not in ('WAIT_KEY') order by random() limit 20`
    );

    const rows = res.rows || [];
    let candidate = null;
    for (const r of rows) {
      const st = publicStatus(r);
      if ((st === 'READY' || st === 'IDLE') && !String(r.work_state||'').includes('CRITICAL') && !String(r.health_state||'').includes('CRITICAL')) {
        candidate = r;
        break;
      }
    }

    if (!candidate) return;

    const hb = await pool.query(
      `select * from tigeriq_events where employee_id = $1 and type in ('RESOURCE_SUCCESS', 'RESOURCE_PROBE_OK') order by seq desc limit 1`,
      [candidate.employee_id]
    );
    if (!hb.rows || hb.rows.length === 0) return;

    const findingKey = `AUDIT_FINDING_${candidate.employee_id}_${Math.floor(Date.now() / (3600000 * 24))}`;
    const existing = await pool.query(
      `select seq from tigeriq_events where type = 'ROTATING_IDLE_AUDIT_HANDOFF' and data->>'findingKey' = $1 limit 1`,
      [findingKey]
    );
    if (existing.rows && existing.rows.length > 0) return;

    await event('ROTATING_IDLE_AUDIT_HANDOFF', {
      employeeId: candidate.employee_id,
      provider: candidate.provider,
      model: candidate.model,
      findingKey,
      auditedAt: nowIso()
    });

    const stateData = { lastIdleAudit, nextIdleAuditInterval, employeeId: candidate.employee_id };
    await pool.query(
      `insert into tigeriq_events(type, data) values('ROTATING_IDLE_AUDITOR_STATE', $1)`,
      [stateData]
    );
  } catch (err) {
    console.error(JSON.stringify({ event: 'ROTATING_IDLE_AUDIT_ERROR', error: String(err?.message || err) }));
    throw err;
  }
}

async function recoverIdleAuditorState(){
  try {
    const r = await pool.query(
      `select data from tigeriq_events where type = 'ROTATING_IDLE_AUDITOR_STATE' order by seq desc limit 1`
    );
    if (r.rows && r.rows[0] && r.rows[0].data) {
      let d = r.rows[0].data;
      if (typeof d === 'string') {
        try { d = JSON.parse(d); } catch (e) {}
      }
      if (d && typeof d === 'object') {
        if (typeof d.lastIdleAudit === 'number') lastIdleAudit = d.lastIdleAudit;
        if (typeof d.nextIdleAuditInterval === 'number') nextIdleAuditInterval = d.nextIdleAuditInterval;
      }
    }
  } catch (e) {}
}

async function loop(){
  while(!stop){const t=Date.now();
    try{
      if(t-lastRefresh>15000){await refreshResources();lastRefresh=t;}
      if(t-lastRecover>10000){await recoverStale();lastRecover=t;}
      if(t-lastManager>MANAGER_IDLE_MS){await managerTick();lastManager=t;}
      if(t-lastProbe>60000){await probeReadyResources();lastProbe=t;}
      await auditIdleNode();
      while(active.size<MAX_PARALLEL){const j=await claimJob();if(!j)break;active.add(j.id);void runJob(j).finally(()=>active.delete(j.id));}
    }catch(e){console.error(JSON.stringify({event:'CORE_LOOP_ERROR',error:String(e?.message||e)}));}
    await sleep(POLL_MS);
  }
}
await initDb();
await recoverAfterCoreRestart();
await recoverIdleAuditorState();
await refreshResources();
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(PORT,HOST,resolve);});
void probeReadyResources();
console.log(JSON.stringify({event:'TIGERIQ_CORE_STARTED',host:HOST,port:PORT,pid:process.pid,resources:resources.length}));
process.on('SIGINT',()=>{stop=true;server.close();});process.on('SIGTERM',()=>{stop=true;server.close();});
await loop(); await pool.end();