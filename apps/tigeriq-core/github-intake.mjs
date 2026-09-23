import { createHash } from 'node:crypto';
import { Pool } from 'pg';
import { backlogOwnerDirect, sortBacklogSpecs } from './github-backlog-policy.mjs';

const DEFAULT_OWNER='newsdayads';
const DEFAULT_REPO='tigeriq-ai-lab';
const DEFAULT_INTERVAL_MS=120000;
const DEFAULT_INITIAL_DELAY_MS=15000;
const MAX_CONTEXT_CHARS=50000;
const SAFE_PATH_RE=/^[A-Za-z0-9._/-]+\.(?:md|mjs|js|ts|json|ya?ml)$/i;

export function hasExactFlag(body,key,value='true'){
  return new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}=${value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}$`,'m').test(String(body||''));
}

export function extractPcOperatorInstruction(body){
  const text=String(body||'');
  const match=text.match(/(?:^|\n)(?:##\s*)?ASSIGNED_ACTION\s*\n([\s\S]*?)(?=\n(?:##\s*)?ACCEPTANCE\s*\n|$)/i);
  return String(match?.[1]||'').trim();
}

export function parseExecutableIssue(issue){
  if(!issue||issue.pull_request||issue.state!=='open') return null;
  const body=String(issue.body||'');
  if(!hasExactFlag(body,'TIGERIQ_EXECUTABLE')||!hasExactFlag(body,'OWNER_POLICY','AUTO')) return null;
  if(/^EXECUTION_SURFACE=UI$/m.test(body)) return null;
  if(!hasExactFlag(body,'NO_CODE_CHANGE')||!hasExactFlag(body,'NO_PC01_SHELL')) return null;
  const p=body.match(/^PRIORITY=(P[0-3])$/m)?.[1]||'P2';
  const capability=body.match(/^CAPABILITY=(general|reasoning|review|pc_operator)$/m)?.[1]||'reasoning';
  const ownerDirect=backlogOwnerDirect(body);
  if(capability==='pc_operator'&&(!ownerDirect||!/^RESOURCE_SCOPE=\S.+$/m.test(body)||!extractPcOperatorInstruction(body)))return null;
  const title=String(issue.title||'');
  const sourceRevision=createHash('sha256').update(title).update('\n').update(body).update('\n').update(String(issue.state_reason||'')).digest('hex').slice(0,12);
  return {number:Number(issue.number),title,body,priority:p,capability,url:String(issue.html_url||''),ownerDirect,sourceRevision,updatedAt:String(issue.updated_at||'')};
}

export function extractIssueRefs(body,currentNumber){
  const out=[]; const seen=new Set([Number(currentNumber)]);
  for(const m of String(body||'').matchAll(/#(\d{1,6})/g)){
    const n=Number(m[1]); if(!n||seen.has(n)) continue; seen.add(n); out.push(n); if(out.length>=5) break;
  }
  return out;
}

export function extractRepoPaths(body){
  const out=[]; const seen=new Set();
  for(const m of String(body||'').matchAll(/`([^`]+)`/g)){
    const p=m[1].trim(); if(!SAFE_PATH_RE.test(p)||seen.has(p)) continue; seen.add(p); out.push(p); if(out.length>=5) break;
  }
  return out;
}

export function formatResultComment(row){
  const summary=String(row?.summary||'Objective completed.').trim().slice(0,5000);
  return `[RESULT] TigerIQ Core ${row?.status==='completed'?'completed':'blocked'} ${row?.id}.\n\n${summary}\n\nEvidence: Core objective \`${row?.id}\`, status \`${row?.status}\`.`;
}

async function ghJson(fetchImpl,url,token='',init={}){
  const headers={'accept':'application/vnd.github+json','user-agent':'TigerIQ-Core-GitHub-Intake/1.1','x-github-api-version':'2022-11-28',...(init.headers||{})};
  if(token) headers.authorization=`Bearer ${token}`;
  const r=await fetchImpl(url,{...init,headers,signal:AbortSignal.timeout(12000)});
  if(!r.ok){const e=new Error(`GITHUB_HTTP_${r.status}`);e.status=r.status;throw e;}
  if(r.status===204) return {};
  return r.json();
}

async function hydrateContext(fetchImpl,owner,repo,spec,token){
  const chunks=[`SOURCE ISSUE #${spec.number}: ${spec.title}\nURL: ${spec.url}\n\n${spec.body}`];
  for(const n of extractIssueRefs(spec.body,spec.number)){
    try{const x=await ghJson(fetchImpl,`https://api.github.com/repos/${owner}/${repo}/issues/${n}`,token);chunks.push(`REFERENCED ISSUE #${n}: ${x.title||''}\n${x.body||''}`);}catch{}
  }
  for(const path of extractRepoPaths(spec.body)){
    try{
      const x=await ghJson(fetchImpl,`https://api.github.com/repos/${owner}/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=main`,token);
      if(x?.encoding==='base64'&&x?.content){chunks.push(`REPOSITORY FILE ${path}:\n${Buffer.from(x.content,'base64').toString('utf8')}`);}
    }catch{}
  }
  return chunks.join('\n\n---\n\n').slice(0,MAX_CONTEXT_CHARS);
}

async function commentIssue(fetchImpl,owner,repo,issueNumber,body,token){
  if(!token) return false;
  await ghJson(fetchImpl,`https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/comments`,token,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({body})});
  return true;
}

async function closeIssue(fetchImpl,owner,repo,issueNumber,token){
  if(!token) return false;
  await ghJson(fetchImpl,`https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}`,token,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({state:'closed',state_reason:'completed'})});
  return true;
}

export async function cleanupTerminalObjectiveJobs({pool}={}){
  if(!pool)throw new Error('CORE_GITHUB_POOL_REQUIRED');
  const reason={kind:'ORPHANED_BY_TERMINAL_OBJECTIVE',message:'Parent objective is terminal; queued/waiting_resource job cannot remain claimable.'};
  const q=await pool.query(`update tigeriq_jobs j
    set status='failed',lease_until=null,completed_at=coalesce(completed_at,now()),failure=coalesce(failure,'{}'::jsonb)||$1::jsonb
    where j.status in ('queued','waiting_resource')
      and exists(select 1 from tigeriq_objectives o where o.id=j.objective_id and o.status in ('completed','blocked'))
    returning j.id,j.objective_id`,[JSON.stringify(reason)]);
  return {cleaned:q.rowCount||0,jobs:q.rows||[]};
}

function rearmKey(spec){
  const stamp=String(spec.updatedAt||'').replace(/\D/g,'').slice(0,14)||'nostamp';
  return `${spec.sourceRevision}-${stamp}`;
}

export async function materializeGithubIssues({pool,fetchImpl=fetch,owner=DEFAULT_OWNER,repo=DEFAULT_REPO,token=''}){
  const cleanup=await cleanupTerminalObjectiveJobs({pool});
  const rows=await ghJson(fetchImpl,`https://api.github.com/repos/${owner}/${repo}/issues?state=open&per_page=100&sort=updated&direction=desc`,token);
  const specs=sortBacklogSpecs(rows.map(parseExecutableIssue).filter(Boolean));
  const active=(await pool.query("select 1 from tigeriq_objectives where metadata->>'source'='github' and status='active' limit 1")).rowCount>0;
  if(active)return {created:0,skipped:0,active:1,considered:specs.length};
  let skipped=0;
  for(const spec of specs){
    const prior=(await pool.query("select id,status,metadata from tigeriq_objectives where metadata->>'source'='github' and metadata->>'issueNumber'=$1 order by created_at desc limit 1",[String(spec.number)])).rows[0]||null;
    if(prior?.status==='active'){skipped++;continue;}
    const sourceChanged=Boolean(prior&&String(prior.metadata?.sourceRevision||'')!==spec.sourceRevision);
    const reopenedAfterCompletion=Boolean(prior?.metadata?.githubClosed===true);
    if(prior&&!sourceChanged&&!reopenedAfterCompletion){skipped++;continue;}
    const id=prior?`OBJ-GH-${spec.number}-R${rearmKey(spec)}`:`OBJ-GH-${spec.number}`;
    const exists=(await pool.query('select 1 from tigeriq_objectives where id=$1',[id])).rowCount>0;
    if(exists){skipped++;continue;}
    const context=await hydrateContext(fetchImpl,owner,repo,spec,token);
    const objective=spec.capability==='pc_operator'
      ? `GitHub OWNER_DIRECT bounded PC operator work item #${spec.number}. Core must create only the assigned pc_operator work and dispatch it through NV06/OpenClaw. Use only approved bounded TigerIQ/OpenClaw tools; NO arbitrary PC01 shell, repository source edit, Production/main mutation, paid action, credential/security change, reboot/shutdown, or destructive action. OpenClaw must not choose backlog/P0/new work. Return structured verified evidence and complete only when the assigned bounded action is satisfied.\n\n${context}`
      : `GitHub autonomous work item #${spec.number}. Execute only the read-only task below. Do not edit repository source, use PC01 shell, deploy, change credentials/security, spend money, reboot, or perform destructive actions. Ground conclusions only in the supplied GitHub context. When the requested analysis is satisfied, complete the objective.\n\n${context}`;
    const metadata={source:'github',issueNumber:spec.number,issueUrl:spec.url,capability:spec.capability,ownerDirect:spec.ownerDirect,sourceRevision:spec.sourceRevision,sourceUpdatedAt:spec.updatedAt,rearmedFromObjectiveId:prior?.id||null,dispatchReason:spec.ownerDirect?`OWNER_DIRECT>${spec.priority}`:`PRIORITY_${spec.priority}`,executionSurface:spec.capability==='pc_operator'?'CORE_OPENCLAW_BOUNDED':'READ_ONLY'};
    await pool.query('insert into tigeriq_objectives(id,objective,priority,metadata) values($1,$2,$3,$4) on conflict(id) do nothing',[id,objective,spec.priority,JSON.stringify(metadata)]);
    if(spec.capability==='pc_operator'){
      const assigned=extractPcOperatorInstruction(spec.body);
      const jobId=`JOB-GH-${spec.number}-PC`;
      const prompt=`Execute ONLY this Owner-assigned bounded PC action through NV06/OpenClaw. Do not choose backlog, P0, or new work. Use approved tigeriq_pc/tigeriq_runtime tools only.\n\nASSIGNED ACTION:\n${assigned}`;
      await pool.query("insert into tigeriq_jobs(id,objective_id,title,prompt,capability,kind,status,max_attempts) values($1,$2,$3,$4,'pc_operator','pc_operator','queued',2) on conflict(id) do nothing",[jobId,id,`GitHub #${spec.number} bounded PC operator`,prompt]);
      await pool.query("insert into tigeriq_events(type,objective_id,job_id,task_kind,data) values('GITHUB_PC_OPERATOR_JOB_MATERIALIZED',$1,$2,'pc_operator',$3)",[id,jobId,JSON.stringify({issueNumber:spec.number,executionSurface:'CORE_OPENCLAW_BOUNDED'})]);
    }
    await pool.query("insert into tigeriq_events(type,objective_id,data) values('GITHUB_OBJECTIVE_MATERIALIZED',$1,$2)",[id,JSON.stringify({issueNumber:spec.number,issueUrl:spec.url,ownerDirect:spec.ownerDirect,priority:spec.priority,dispatchReason:metadata.dispatchReason})]);
    return {created:1,skipped,active:0,considered:specs.length,issueNumber:spec.number,objectiveId:id,cleanedOrphans:cleanup.cleaned};
  }
  return {created:0,skipped,active:0,considered:specs.length,cleanedOrphans:cleanup.cleaned};
}

export async function syncGithubOutcomes({pool,fetchImpl=fetch,owner=DEFAULT_OWNER,repo=DEFAULT_REPO,token=''}){
  if(!token) return {claims:0,results:0};
  const rows=(await pool.query("select id,status,summary,metadata from tigeriq_objectives where metadata->>'source'='github' order by created_at asc limit 100")).rows;
  let claims=0,results=0;
  for(const row of rows){
    const number=Number(row.metadata?.issueNumber); if(!number) continue;
    if(row.status==='active'&&row.metadata?.executionSurface==='CORE_OPENCLAW_BOUNDED'){
      const job=(await pool.query("select id,status,employee_id,resource_id,provider,result,failure,completed_at from tigeriq_jobs where objective_id=$1 and capability='pc_operator' order by created_at desc limit 1",[row.id])).rows[0];
      if(job?.status==='done'){
        row.status='completed';
        row.summary=`bounded pc_operator completed via ${job.employee_id||'NV06'}/${job.provider||'openclaw'}; job=${job.id}`;
        await pool.query("update tigeriq_objectives set status='completed',summary=$2,updated_at=now() where id=$1",[row.id,row.summary]);
      }else if(job?.status==='failed'){
        row.status='blocked';
        row.summary=`bounded pc_operator failed; job=${job.id}; failure=${String(job.failure?.message||job.failure?.kind||'terminal_failure').slice(0,300)}`;
        await pool.query("update tigeriq_objectives set status='blocked',summary=$2,updated_at=now() where id=$1",[row.id,row.summary]);
      }
    }
    if(!row.metadata?.githubClaimReported){
      await commentIssue(fetchImpl,owner,repo,number,`[CLAIM] TigerIQ Core accepted this issue as ${row.id}. Automatic processing is active.`,token);
      await pool.query("update tigeriq_objectives set metadata=metadata||$2::jsonb,updated_at=now() where id=$1",[row.id,JSON.stringify({githubClaimReported:true})]);
      row.metadata={...row.metadata,githubClaimReported:true}; claims++;
    }
    if(['completed','blocked'].includes(row.status)&&!row.metadata?.githubResultReported){
      await commentIssue(fetchImpl,owner,repo,number,formatResultComment(row),token);
      if(row.status==='completed') await closeIssue(fetchImpl,owner,repo,number,token);
      await pool.query("update tigeriq_objectives set metadata=metadata||$2::jsonb,updated_at=now() where id=$1",[row.id,JSON.stringify({githubResultReported:true,githubClosed:row.status==='completed'})]);
      results++;
    }
  }
  return {claims,results};
}

export function startGithubIntake({databaseUrl=process.env.DATABASE_URL,fetchImpl=fetch,owner=process.env.TIGERIQ_GITHUB_OWNER||DEFAULT_OWNER,repo=process.env.TIGERIQ_GITHUB_REPO||DEFAULT_REPO,token=process.env.TIGERIQ_GITHUB_TOKEN||process.env.GITHUB_TOKEN||'',intervalMs=Number(process.env.TIGERIQ_GITHUB_INTAKE_MS||DEFAULT_INTERVAL_MS),initialDelayMs=DEFAULT_INITIAL_DELAY_MS}={}){
  if(!databaseUrl) return {enabled:false,stop(){}};
  const pool=new Pool({connectionString:databaseUrl,max:1}); let stopped=false,busy=false,timer=null,interval=null;
  const tick=async()=>{if(stopped||busy)return;busy=true;try{const b=await syncGithubOutcomes({pool,fetchImpl,owner,repo,token});const a=await materializeGithubIssues({pool,fetchImpl,owner,repo,token});if(a.created||b.claims||b.results)console.log(JSON.stringify({event:'GITHUB_INTAKE_SYNC',created:a.created,claims:b.claims,results:b.results,active:a.active||0,issueNumber:a.issueNumber||null}));}catch(e){console.error(JSON.stringify({event:'GITHUB_INTAKE_ERROR',error:String(e?.message||e)}));}finally{busy=false;}};
  timer=setTimeout(()=>{void tick();interval=setInterval(()=>void tick(),Math.max(60000,intervalMs));interval.unref?.();},Math.max(1000,initialDelayMs)); timer.unref?.();
  return {enabled:true,async stop(){stopped=true;if(timer)clearTimeout(timer);if(interval)clearInterval(interval);await pool.end();}};
}
