import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {branchName,checkGateState,extractCanonicalAllowedPaths,isRetryableAiError,parseJsonObject,safeRepoPath,validateChanges} from './policy.mjs';

export class CodingScopeViolationError extends Error {
  constructor(offending) {
    super(`CODING_SCOPE_VIOLATION: ${offending.join(', ')}`);
    this.code='CODING_SCOPE_VIOLATION';
    this.offending=offending;
    this.detail={code:'CODING_SCOPE_VIOLATION',offending};
  }
}

export function validateJobScope(jobPaths,changes){
  const allowed=new Set(Array.isArray(jobPaths)?jobPaths:[]);
  const offending=(changes||[]).map(c=>c?.path).filter(Boolean).filter(p=>!allowed.has(p));
  if(offending.length) throw new CodingScopeViolationError(offending);
  return true;
}

export function validateSourceScope(proposedPaths,canonicalPaths){
  const canonical=new Set((canonicalPaths||[]).map(String));
  if(!canonical.size)return true;
  const offending=(proposedPaths||[]).map(String).filter(p=>!canonical.has(p));
  if(offending.length)throw new CodingScopeViolationError(offending);
  return true;
}

export function shrinkAiPrompt(prompt,maxChars=18000){
  const p=String(prompt||'');
  if(p.length<=maxChars)return p;
  const head=Math.floor(maxChars*0.45),tail=maxChars-head;
  return `${p.slice(0,head)}\n...[MODEL_CONTEXT_REDUCED]...\n${p.slice(-tail)}`;
}

export function assertPrOpenState(pr){
  if(pr?.state==='open')return true;
  const code=pr?.merged?'PR_EXTERNALLY_MERGED':'PR_CLOSED_UNMERGED';
  const e=new Error(code);
  e.code=code;
  e.detail={code,number:pr?.number||null,state:pr?.state||null,merged:Boolean(pr?.merged)};
  throw e;
}

const DATABASE_URL=process.env.DATABASE_URL?.trim(); if(!DATABASE_URL&&process.env.NODE_ENV!=='test')throw new Error('DATABASE_URL_MISSING');
const GH_TOKEN=(process.env.TIGERIQ_GITHUB_TOKEN||process.env.GITHUB_TOKEN||'').trim(); if(!GH_TOKEN&&process.env.NODE_ENV!=='test')throw new Error('GITHUB_TOKEN_MISSING');
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
function pickResource(exclude=[]){const available=resources.filter(x=>!exclude.includes(x.id));if(!available.length)return null;const r=available[rr%available.length];rr++;return r;}

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

export async function invokeJsonWithFailover(initialResource,prompt,{exclude=[],resourcePool=resources,invokeFn=invoke,shrinkPrompt=shrinkAiPrompt,maxResources=3,validateData=null}={}){
  const initial=initialResource;
  if(!initial)throw new Error('NO_FREE_API_CODING_RESOURCE');
  const ordered=[initial,...resourcePool.filter(r=>r?.id!==initial.id&&!exclude.includes(r?.id))];
  const unique=[];const ids=new Set();
  for(const r of ordered){if(!r||exclude.includes(r.id)||ids.has(r.id))continue;ids.add(r.id);unique.push(r);if(unique.length>=maxResources)break;}
  let lastError=null;let attempts=0;
  let currentPrompt=String(prompt);
  for(let resourceIdx=0; resourceIdx<unique.length; resourceIdx++){
    const resource=unique[resourceIdx];
    for(let same=0;same<2;same++){
      attempts++;
      try{
        if(same>0) currentPrompt=shrinkPrompt(currentPrompt);
        const raw=await invokeFn(resource,currentPrompt);
        const data=parseJsonObject(raw);
        if(typeof validateData==='function')validateData(data);
        return {data,resource,attempts};
      }catch(e){
        lastError=e;
        if(e.code==='CODING_SCOPE_VIOLATION'||String(e.message||'').includes('CODING_SCOPE_VIOLATION')||e.code==='CREDENTIAL_VIOLATION'||String(e.message||'').includes('CREDENTIAL_VIOLATION')){
          throw e;
        }
        if(!isRetryableAiError(e)){
          throw e;
        }
        if(e.status===429 || String(e.message||'').includes('HTTP_429')){
          const backoffTime = Math.min(1000 * Math.pow(2, resourceIdx + same), 8000);
          await new Promise(r=>setTimeout(r, backoffTime));
        }
      }
    }
  }
  throw lastError||new Error('AI_INVOCATION_FAILED');
}
  let gates=null;
  let waiting_ci=false;
  let timeoutRetries=0;
  for(let repairCycle=0; repairCycle<3; repairCycle++){
    try{
      waiting_ci=true;
      gates=await waitGates(branch);
      waiting_ci=false;
      break;
    }catch(e){
      waiting_ci=false;
      if(e.code==='CI_GATES_TIMEOUT'){
        if(timeoutRetries<1){
          timeoutRetries++;
          continue;
        }else{
          throw e;
        }
      }else if(e.code==='CI_GATES_FAILED'){
        if(repairCycle===2) throw e;
        const repairPrompt=`CI gates failed with output:
${e.failedOutput}
Apply an in-place patch on branch ${branch} to fix these errors.`;
        const repairRes=await invokeJsonWithFailover(resource,repairPrompt,{resourcePool:resources,invokeFn:invoke,shrinkPrompt:shrinkAiPrompt});
        validateChanges(repairRes.data.changes);
        await applyChanges(branch,repairRes.data.changes,`repair ci gates cycle ${repairCycle+1}`);
      }else{
        throw e;
      }
    }
  }

  const reviewPrompt=`Review the PR #${pr.number} changes.`;
  const reviewRes=await invokeJsonWithFailover(pickResource([resource.id]),reviewPrompt,{resourcePool:resources,invokeFn:invoke,shrinkPrompt:shrinkAiPrompt});
  const review=reviewRes.data;

  let merge=null;
  if(AUTO_MERGE && review?.decision==='approve'){
    merge=await mergePr(pr.number);
  }else{
    merge={merged:false,message:'not_auto_merged_or_rejected'};
  }

  const finalSha=await gh('rev-parse',['HEAD']);
  const status=merge?.merged?'done':'blocked';
  await pool.query("update tigeriq_coding_jobs set status=$2,head_sha=$3,result=$4,completed_at=now() where id=$1",[j.id,status,finalSha,JSON.stringify({summary:gen.summary,prNumber:pr.number,branch,gates,review,merge})]);
  await pool.query("update tigeriq_coding_objectives set status=$2,summary=$3,updated_at=now() where id=$1",[j.objective_id,merge?.merged?'completed':'blocked',merge?.merged?`Merged PR #${pr.number}`:`PR #${pr.number} ready but merge blocked: ${String(merge?.message||'unknown').slice(0,500)}`]);
  return {prNumber:pr.number,branch,merge};
}
async function gh(cmd,args=[]){const {execFile}=await import('node:child_process');const {promisify}=await import('node:util');const execFileAsync=promisify(execFile);try{const {stdout}=await execFileAsync('gh',[cmd,...args],{env:{...process.env,GH_TOKEN}});return String(stdout||'').trim();}catch(e){const msg=String(e?.stderr||e?.message||e);const err=new Error(`GH_${cmd.toUpperCase()}_FAILED:${msg.slice(0,300)}`);err.code='GH_CLI_ERROR';throw err;}}

async function waitGates(branch,maxWaitMs=600000){const start=Date.now();let attempts=0;while(Date.now()-start<maxWaitMs){attempts++;try{const out=await gh('pr','checks',[branch]);if(out.includes('fail')||out.includes('FAILURE')){const match=out.match(/(?:FAIL|FAILURE)[^
]*/i);const failedOutput=match?match[0]:out.slice(0,1000);const err=new Error('CI_GATES_FAILED');err.code='CI_GATES_FAILED';err.failedOutput=failedOutput;throw err;}if(out.includes('success')||out.includes('SUCCESS')||(out&&!out.includes('pending')&&!out.includes('in_progress'))){const sha=await gh('rev-parse',['HEAD']);return {status:'passed',sha};}}catch(e){if(e.code==='CI_GATES_FAILED')throw e;}if(Date.now()-start>maxWaitMs){const err=new Error('CI_GATES_TIMEOUT');err.code='CI_GATES_TIMEOUT';err.failedOutput='CI gates timed out after maximum wait duration';throw err;}await sleep(10000);}const err=new Error('CI_GATES_TIMEOUT');err.code='CI_GATES_TIMEOUT';err.failedOutput='CI gates timed out';throw err;}

async function mergePr(prNumber){try{await gh('pr','merge',[String(prNumber),'-s','--delete-branch']);return {merged:true};}catch(e){return {merged:false,message:e.message};}}

async function failJob(j,e){if(!pool)return;await pool.query("update tigeriq_coding_jobs set status='failed',failure=$2,completed_at=now() where id=$1",[j.id,JSON.stringify({message:String(e?.message||e),code:e?.code||null,detail:e?.detail||null})]);await pool.query("update tigeriq_coding_objectives set status='blocked',summary=$2,updated_at=now() where id=$1",[j.objective_id,String(e?.message||e).slice(0,1000)])}

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
        void runJob(j).catch(e=>failJob(j,e)).finally(()=>active.delete(j.id));
      }
    }catch(e){console.error(JSON.stringify({event:'CODING_LANE_LOOP_ERROR',error:String(e?.message||e)}))}
    await sleep(1500);
  }
  if(pool)await pool.end();
}
