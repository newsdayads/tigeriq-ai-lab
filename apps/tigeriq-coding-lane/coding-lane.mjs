import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {branchName,checkGateState,parseJsonObject,safeRepoPath,validateChanges} from './policy.mjs';

export class CodingScopeViolationError extends Error {
  constructor(offending) {
    super(`CODING_SCOPE_VIOLATION: ${offending.join(', ')}`);
    this.code = 'CODING_SCOPE_VIOLATION';
    this.offending = offending;
    this.detail = { code: 'CODING_SCOPE_VIOLATION', offending };
  }
}

export function validateJobScope(jobPaths, changes) {
  const allowed = new Set(Array.isArray(jobPaths) ? jobPaths : []);
  const changePaths = (changes || []).map(c => c?.path).filter(Boolean);
  const offending = changePaths.filter(p => !allowed.has(p));
  if (offending.length > 0) {
    throw new CodingScopeViolationError(offending);
  }
  return true;
}

const DATABASE_URL=process.env.DATABASE_URL?.trim(); if(!DATABASE_URL && process.env.NODE_ENV!=='test') throw new Error('DATABASE_URL_MISSING');
const GH_TOKEN=(process.env.TIGERIQ_GITHUB_TOKEN||process.env.GITHUB_TOKEN||'').trim(); if(!GH_TOKEN && process.env.NODE_ENV!=='test') throw new Error('GITHUB_TOKEN_MISSING');
const OWNER=process.env.TIGERIQ_GITHUB_OWNER||'newsdayads';
const REPO=process.env.TIGERIQ_GITHUB_REPO||'tigeriq-ai-lab';
const HOST=process.env.TIGERIQ_CODING_HOST||'127.0.0.1';
const PORT=Number(process.env.TIGERIQ_CODING_PORT||8797);
const AUTO_MERGE=String(process.env.TIGERIQ_CODING_AUTO_MERGE||'true').toLowerCase()==='true';
const MAX_PARALLEL=Math.max(1,Math.min(2,Number(process.env.TIGERIQ_CODING_MAX_PARALLEL||1)));
const pool=DATABASE_URL?new Pool({connectionString:DATABASE_URL,max:4}):null;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

const R=(id,provider,model,ready)=>({id,provider,model,ready});
const resources=[
  R('NV11','groq',process.env.TIGERIQ_GROQ_MODEL||'openai/gpt-oss-120b',()=>process.env.GROQ_API_KEY&&process.env.TIGERIQ_GROQ_FREE_TIER_VERIFIED==='true'),
  R('NV12','gemini',process.env.TIGERIQ_GEMINI_MODEL||'gemini-3.5-flash-lite',()=>process.env.GEMINI_API_KEY&&process.env.TIGERIQ_GEMINI_FREE_TIER_VERIFIED==='true'),
  R('NV13','openrouter','openrouter/free',()=>process.env.OPENROUTER_API_KEY),
  R('NV14','mistral','mistral-small-latest',()=>process.env.MISTRAL_API_KEY),
  R('NV16','huggingface','openai/gpt-oss-120b:fastest',()=>process.env.HF_TOKEN),
  R('NV19','cohere','command-a-plus-05-2026',()=>process.env.COHERE_API_KEY&&process.env.TIGERIQ_COHERE_TRIAL_CONFIRMED==='true'),
].filter(x=>x.ready());
let rr=0;
function pickResource(exclude=[]){const pool=resources.filter(x=>!exclude.includes(x.id));if(!pool.length)return null;const r=pool[rr%pool.length];rr++;return r;}

async function fetchJson(url,init={},timeout=90000){const c=new AbortController(),t=setTimeout(()=>c.abort(),timeout);try{const res=await fetch(url,{...init,signal:c.signal});const text=await res.text();let body={};try{body=text?JSON.parse(text):{};}catch{body={text};}if(!res.ok){const e=new Error(`HTTP_${res.status}:${String(body?.message||body?.error||text).slice(0,300)}`);e.status=res.status;throw e;}return body;}finally{clearTimeout(t)}}
async function openAi(endpoint,key,model,prompt){const b=await fetchJson(endpoint,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${key}`},body:JSON.stringify({model,messages:[{role:'user',content:prompt}],temperature:0,max_tokens:8000,stream:false})});const text=b?.choices?.[0]?.message?.content;if(!String(text||'').trim())throw new Error('EMPTY_RESPONSE');return String(text)}
async function invoke(r,prompt){
  if(r.provider==='groq')return openAi('https://api.groq.com/openai/v1/chat/completions',process.env.GROQ_API_KEY,r.model,prompt);
  if(r.provider==='openrouter')return openAi('https://openrouter.ai/api/v1/chat/completions',process.env.OPENROUTER_API_KEY,r.model,prompt);
  if(r.provider==='mistral')return openAi('https://api.mistral.ai/v1/chat/completions',process.env.MISTRAL_API_KEY,r.model,prompt);
  if(r.provider==='huggingface')return openAi('https://router.huggingface.co/v1/chat/completions',process.env.HF_TOKEN,r.model,prompt);
  if(r.provider==='gemini'){const b=await fetchJson(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(r.model)}:generateContent`,{method:'POST',headers:{'content-type':'application/json','x-goog-api-key':process.env.GEMINI_API_KEY},body:JSON.stringify({contents:[{role:'user',parts:[{text:prompt}]}],generationConfig:{temperature:0,maxOutputTokens:8192}})});const text=b?.candidates?.[0]?.content?.parts?.map(x=>x.text||'').join('\n');if(!String(text||'').trim())throw new Error('EMPTY_RESPONSE');return String(text)}
  if(r.provider==='cohere'){const b=await fetchJson('https://api.cohere.com/v2/chat',{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${process.env.COHERE_API_KEY}`},body:JSON.stringify({model:r.model,messages:[{role:'user',content:prompt}],temperature:0,max_tokens:8000})});const text=b?.message?.content?.map(x=>x.text||'').join('');if(!String(text||'').trim())throw new Error('EMPTY_RESPONSE');return String(text)}
  throw new Error('PROVIDER_UNSUPPORTED');
}

async function gh(path,init={}){return fetchJson(`https://api.github.com/repos/${OWNER}/${REPO}${path}`,{...init,headers:{accept:'application/vnd.github+json','content-type':'application/json','user-agent':'TigerIQ-Coding-Lane/1.0','x-github-api-version':'2022-11-28',authorization:`Bearer ${GH_TOKEN}`,...(init.headers||{})}},30000)}
async function ghText(path,accept){const res=await fetch(`https://api.github.com/repos/${OWNER}/${REPO}${path}`,{headers:{accept,authorization:`Bearer ${GH_TOKEN}`,'user-agent':'TigerIQ-Coding-Lane/1.0'},signal:AbortSignal.timeout(30000)});const text=await res.text();if(!res.ok)throw new Error(`GITHUB_HTTP_${res.status}:${text.slice(0,250)}`);return text}
async function mainSha(){return (await gh('/git/ref/heads/main')).object.sha}
async function repoTree(){const sha=await mainSha();const t=await gh(`/git/trees/${sha}?recursive=1`);return (t.tree||[]).filter(x=>x.type==='blob').map(x=>x.path).filter(safeRepoPath).slice(0,3000)}
async function readRepoFile(path,ref='main'){try{const x=await gh(`/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(ref)}`);return {path,sha:x.sha,content:Buffer.from(x.content||'','base64').toString('utf8');}catch(e){if(e.status===404)return {path,sha:null,content:''};throw e}}
async function createBranch(name,sha){await gh('/git/refs',{method:'POST',body:JSON.stringify({ref:`refs/heads/${name}`,sha})})}
async function writeFile(branch,change){const old=await readRepoFile(change.path,branch);const body={message:`TigerIQ ${change.path}`,content:Buffer.from(change.content,'utf8').toString('base64'),branch};if(old.sha)body.sha=old.sha;return gh(`/contents/${change.path.split('/').map(encodeURIComponent).join('/')}`,{method:'PUT',body:JSON.stringify(body)})}
async function openPr(branch,title,body){return gh('/pulls',{method:'POST',body:JSON.stringify({title,head:branch,base:'main',body,draft:false,maintainer_can_modify:true})})}
async function headSha(branch){return (await gh(`/git/ref/heads/${encodeURIComponent(branch)}`)).object.sha}
async function waitGates(branch,timeoutMs=20*60*1000){const deadline=Date.now()+timeoutMs;while(Date.now()<deadline){const sha=await headSha(branch);const x=await gh(`/commits/${sha}/check-runs?per_page=100`);const g=checkGateState(x.check_runs||[]);if(g.state==='passed')return {sha,...g};if(g.state==='failed')throw Object.assign(new Error('CI_GATES_FAILED'),{detail:g});await sleep(15000)}throw new Error('CI_GATES_TIMEOUT')}
async function mergePr(number,sha){return gh(`/pulls/${number}/merge`,{method:'PUT',body:JSON.stringify({sha,merge_method:'squash',commit_title:`TigerIQ Coding Lane PR #${number}`})})}

async function initDb(){if(!pool)return;await pool.query(`
create table if not exists tigeriq_coding_objectives(id text primary key,objective text not null,priority text not null default 'P1',status text not null default 'active',summary text,manager_employee_id text,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create table if not exists tigeriq_coding_jobs(id text primary key,objective_id text references tigeriq_coding_objectives(id),title text not null,instruction text not null,paths jsonb not null default '[]'::jsonb,status text not null default 'queued',employee_id text,reviewer_employee_id text,branch text,pr_number int,head_sha text,result jsonb,failure jsonb,attempts int not null default 0,created_at timestamptz not null default now(),started_at timestamptz,completed_at timestamptz);
create index if not exists tigeriq_coding_jobs_status_idx on tigeriq_coding_jobs(status,created_at);
`)}

async function managerTick(){const q=await pool.query("select * from tigeriq_coding_objectives where status='active' and not exists(select 1 from tigeriq_coding_jobs j where j.objective_id=tigeriq_coding_objectives.id and j.status in ('queued','running','review','waiting_ci')) order by case priority when 'P0' then 0 when 'P1' then 1 else 2 end,created_at limit 1");const o=q.rows[0];if(!o)return;const manager=pickResource();if(!manager){await pool.query("update tigeriq_coding_objectives set status='blocked',summary='NO_FREE_API_CODING_RESOURCE' where id=$1",[o.id]);return}const tree=await repoTree();const prompt=`You are TigerIQ Coding Manager. Decompose this repository objective into ONE safe coding job. Repository files:\n${tree.join('\n').slice(0,45000)}\n\nOBJECTIVE: ${o.objective}\nReturn ONLY JSON {"status":"continue|blocked","summary":"short","job":{"title":"short","instruction":"standalone implementation instruction","paths":["exact/repo/path"]}}. Max 8 paths. Include relevant tests. Never select .github/workflows, credentials/secrets, production/deploy config, docs/EXECUTION_BOUNDARY.md, docs/SECURITY.md, scripts/tigeriq-core/run-core.ps1, or main/release controls.`;try{const d=parseJsonObject(await invoke(manager,prompt));if(d.status!=='continue'||!d.job){await pool.query("update tigeriq_coding_objectives set status='blocked',summary=$2,manager_employee_id=$3,updated_at=now() where id=$1",[o.id,String(d.summary||'manager blocked').slice(0,1000),manager.id]);return}const paths=[...new Set((d.job.paths||[]).map(String))].filter(safeRepoPath).slice(0,8);if(!paths.length)throw new Error('MANAGER_PATHS_EMPTY');const id=`CODE-${randomUUID()}`;await pool.query('insert into tigeriq_coding_jobs(id,objective_id,title,instruction,paths) values($1,$2,$3,$4,$5)',[id,o.id,String(d.job.title||'Coding job').slice(0,180),String(d.job.instruction||o.objective).slice(0,12000),JSON.stringify(paths)]);await pool.query("update tigeriq_coding_objectives set manager_employee_id=$2,summary=$3,updated_at=now() where id=$1",[o.id,manager.id,String(d.summary||'coding job created').slice(0,1000)]);}catch(e){await pool.query("update tigeriq_coding_objectives set status='blocked',summary=$2,manager_employee_id=$3,updated_at=now() where id=$1",[o.id,String(e.message).slice(0,1000),manager.id])}}

async function claimJob(){const c=await pool.connect();try{await c.query('begin');const q=await c.query("select * from tigeriq_coding_jobs where status='queued' order by created_at for update skip locked limit 1");if(!q.rows[0]){await c.query('commit');return null}const j=q.rows[0];await c.query("update tigeriq_coding_jobs set status='running',started_at=coalesce(started_at,now()),attempts=attempts+1 where id=$1",[j.id]);await c.query('commit');return j}catch(e){await c.query('rollback');throw e}finally{c.release()}}
async function contextFor(paths,ref='main'){const rows=[];for(const p of paths){const f=await readRepoFile(p,ref);rows.push(`FILE ${p}\n${f.content.slice(0,45000)}`)}return rows.join('\n\n---\n\n').slice(0,180000)}
async function generateChanges(worker,j,context,reviewIssues=[]){const prompt=`You are ${worker.id}, an autonomous TigerIQ repository engineer. Implement ONLY the assigned task on a GitHub branch.\nTASK: ${j.instruction}\nALLOWED PATHS: ${j.paths.join(', ')}\n${reviewIssues.length?`REVIEW ISSUES TO FIX: ${JSON.stringify(reviewIssues)}\n`:''}CURRENT FILES:\n${context}\nReturn ONLY JSON {"summary":"short","changes":[{"path":"exact allowed path","content":"complete replacement UTF-8 file content"}]}. Do not touch paths outside ALLOWED PATHS. Never output secrets. Keep changes minimal and testable.`;const d=parseJsonObject(await invoke(worker,prompt));validateChanges(d.changes,j.paths);validateJobScope(j.paths, d.changes);return d}
async function reviewPr(reviewer,j,diff){const prompt=`You are ${reviewer.id}, independent TigerIQ code reviewer. Review against the task and safety boundaries. TASK: ${j.instruction}\nDIFF:\n${diff.slice(0,180000)}\nReturn ONLY JSON {"decision":"approve|changes_requested","summary":"short","issues":["specific issue"]}. Reject unsafe, untested, out-of-scope, credential/security/production changes.`;const d=parseJsonObject(await invoke(reviewer,prompt));if(!['approve','changes_requested'].includes(d.decision))throw new Error('REVIEW_DECISION_INVALID');d.issues=Array.isArray(d.issues)?d.issues.slice(0,8):[];return d}

async function runJob(j){const worker=pickResource();if(!worker)throw new Error('NO_IMPLEMENTER_AVAILABLE');const reviewer=pickResource([worker.id]);if(!reviewer)throw new Error('NO_INDEPENDENT_REVIEWER_AVAILABLE');j.paths=Array.isArray(j.paths)?j.paths:j.paths||[];const base=await mainSha();const branch=branchName(worker.id,j.id);await createBranch(branch,base);await pool.query("update tigeriq_coding_jobs set employee_id=$2,reviewer_employee_id=$3,branch=$4 where id=$1",[j.id,worker.id,reviewer.id,branch]);let context=await contextFor(j.paths,'main');let gen=await generateChanges(worker,j,context);

validateJobScope(j.paths, gen.changes);

for(const ch of gen.changes)await writeFile(branch,ch);const pr=await openPr(branch,`[${worker.id}] ${j.title}`,`Automated TigerIQ Coding Lane job \`${j.id}\`.\n\nImplementer: ${worker.id}\nIndependent reviewer: ${reviewer.id}\nDirect writes to main are forbidden. Merge is attempted only after CI gates and reviewer approval.`);await pool.query("update tigeriq_coding_jobs set pr_number=$2,status='waiting_ci' where id=$1",[j.id,pr.number]);let review=null,gates=null;for(let cycle=0;cycle<3;cycle++){gates=await waitGates(branch);await pool.query("update tigeriq_coding_jobs set status='review',head_sha=$2 where id=$1",[j.id,gates.sha]);const diff=await ghText(`/pulls/${pr.number}`, 'application/vnd.github.v3.diff');review=await reviewPr(reviewer,j,diff);if(review.decision==='approve')break;if(cycle===2)throw Object.assign(new Error('REVIEW_CHANGES_UNRESOLVED'),{detail:review});context=await contextFor(j.paths,branch);gen=await generateChanges(worker,j,context,review.issues);

validateJobScope(j.paths, gen.changes);

for(const ch of gen.changes)await writeFile(branch,ch);await pool.query("update tigeriq_coding_jobs set status='waiting_ci' where id=$1",[j.id])}if(review?.decision!=='approve')throw new Error('REVIEW_NOT_APPROVED');const finalSha=await headSha(branch);let merge={merged:false,message:'AUTO_MERGE_DISABLED'};if(AUTO_MERGE){try{merge=await mergePr(pr.number,finalSha)}catch(e){merge={merged:false,message:String(e.message||e)}}}const status=merge?.merged?'done':'blocked';await pool.query("update tigeriq_coding_jobs set status=$2,head_sha=$3,result=$4,completed_at=now() where id=$1",[j.id,status,finalSha,JSON.stringify({summary:gen.summary,prNumber:pr.number,branch,gates,review,merge})]);await pool.query("update tigeriq_coding_objectives set status=$2,summary=$3,updated_at=now() where id=$1",[j.objective_id,merge?.merged?'completed':'blocked',merge?.merged?`Merged PR #${pr.number}`:`PR #${pr.number} ready but merge blocked: ${String(merge?.message||'unknown').slice(0,500)}`]);return {prNumber:pr.number,branch,merge}}
async function failJob(j,e){if(!pool)return;await pool.query("update tigeriq_coding_jobs set status='failed',failure=$2,completed_at=now() where id=$1",[j.id,JSON.stringify({message:String(e?.message||e),detail:e?.detail||null})]);await pool.query("update tigeriq_coding_objectives set status='blocked',summary=$2,updated_at=now() where id=$1",[j.objective_id,String(e?.message||e).slice(0,1000)])}

async function snapshot(){const objectives=(await pool.query('select * from tigeriq_coding_objectives order by created_at desc limit 20')).rows;const jobs=(await pool.query('select * from tigeriq_coding_jobs order by created_at desc limit 30')).rows;return {ok:true,service:'tigeriq-coding-lane',host:HOST,port:PORT,pid:process.pid,resources:resources.map(x=>({id:x.id,provider:x.provider,model:x.model})),objectives,jobs}}
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
        void runJob(j).catch(e=>failJob(j,e)).finally(()=>active.delete(j.id))
      }
    }catch(e){
      console.error(JSON.stringify({event:'CODING_LANE_LOOP_ERROR',error:String(e?.message||e)}))
    }
    await sleep(1500);
  }
  if(pool) await pool.end();
}
