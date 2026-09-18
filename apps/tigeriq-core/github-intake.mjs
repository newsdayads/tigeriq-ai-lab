import { Pool } from 'pg';

const DEFAULT_OWNER='newsdayads';
const DEFAULT_REPO='tigeriq-ai-lab';
const DEFAULT_INTERVAL_MS=120000;
const DEFAULT_INITIAL_DELAY_MS=15000;
const MAX_CONTEXT_CHARS=50000;
const SAFE_PATH_RE=/^[A-Za-z0-9._/-]+\.(?:md|mjs|js|ts|json|ya?ml)$/i;

export function hasExactFlag(body,key,value='true'){
  return new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}=${value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}$`,'m').test(String(body||''));
}

export function parseExecutableIssue(issue){
  if(!issue||issue.pull_request||issue.state!=='open') return null;
  const body=String(issue.body||'');
  if(!hasExactFlag(body,'TIGERIQ_EXECUTABLE')||!hasExactFlag(body,'OWNER_POLICY','AUTO')) return null;
  if(!hasExactFlag(body,'NO_CODE_CHANGE')||!hasExactFlag(body,'NO_PC01_SHELL')) return null;
  const p=body.match(/^PRIORITY=(P[0-3])$/m)?.[1]||'P2';
  const capability=body.match(/^CAPABILITY=(general|reasoning|review)$/m)?.[1]||'reasoning';
  return {number:Number(issue.number),title:String(issue.title||''),body,priority:p,capability,url:String(issue.html_url||'')};
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

export async function materializeGithubIssues({pool,fetchImpl=fetch,owner=DEFAULT_OWNER,repo=DEFAULT_REPO,token=''}){
  const rows=await ghJson(fetchImpl,`https://api.github.com/repos/${owner}/${repo}/issues?state=open&per_page=100&sort=updated&direction=desc`,token);
  let created=0;
  for(const issue of rows){
    const spec=parseExecutableIssue(issue); if(!spec) continue;
    const id=`OBJ-GH-${spec.number}`;
    const exists=(await pool.query('select 1 from tigeriq_objectives where id=$1',[id])).rowCount>0;
    if(exists) continue;
    const context=await hydrateContext(fetchImpl,owner,repo,spec,token);
    const objective=`GitHub autonomous work item #${spec.number}. Execute only the read-only task below. Do not edit repository source, use PC01 shell, deploy, change credentials/security, spend money, reboot, or perform destructive actions. Ground conclusions only in the supplied GitHub context. When the requested analysis is satisfied, complete the objective.\n\n${context}`;
    await pool.query('insert into tigeriq_objectives(id,objective,priority,metadata) values($1,$2,$3,$4) on conflict(id) do nothing',[id,objective,spec.priority,JSON.stringify({source:'github',issueNumber:spec.number,issueUrl:spec.url,capability:spec.capability})]);
    await pool.query("insert into tigeriq_events(type,objective_id,data) values('GITHUB_OBJECTIVE_MATERIALIZED',$1,$2)",[id,JSON.stringify({issueNumber:spec.number,issueUrl:spec.url})]);
    created++;
  }
  return {created};
}

export async function syncGithubOutcomes({pool,fetchImpl=fetch,owner=DEFAULT_OWNER,repo=DEFAULT_REPO,token=''}){
  if(!token) return {claims:0,results:0};
  const rows=(await pool.query("select id,status,summary,metadata from tigeriq_objectives where metadata->>'source'='github' order by created_at asc limit 100")).rows;
  let claims=0,results=0;
  for(const row of rows){
    const number=Number(row.metadata?.issueNumber); if(!number) continue;
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

export async function fetchIssues(fetchImpl, owner, repo, token) {
  const headers = { accept: 'application/vnd.github.v3+json' };
  if (token) headers.authorization = `token ${token}`;
  const response = await fetchImpl(`https://api.github.com/repos/${owner}/${repo}/issues?state=open&per_page=100`, { headers });
  if (!response.ok) throw new Error(`github_issues_fetch_${response.status}`);
  const data = await response.json();
  return Array.isArray(data) ? data : [];
}

export function filterBacklogIssues(issues) {
  if (!Array.isArray(issues)) return [];
  const filtered = issues.filter(issue => {
    if (!issue || issue.pull_request || issue.state !== 'open') return false;
    const body = String(issue.body || '');
    if (!hasExactFlag(body, 'TIGERIQ_EXECUTABLE', 'true') || !hasExactFlag(body, 'OWNER_POLICY', 'AUTO')) return false;
    if (!hasExactFlag(body, 'OWNER', 'OWNER_DIRECT')) return false;
    const p = body.match(/^PRIORITY=(P[0-3])$/m)?.[1] || 'P2';
    return ['P0', 'P1', 'P2', 'P3'].includes(p);
  }).map(issue => {
    const body = String(issue.body || '');
    return {
      number: Number(issue.number),
      title: String(issue.title || '').trim(),
      body,
      priority: body.match(/^PRIORITY=(P[0-3])$/m)?.[1] || 'P2',
      capability: body.match(/^CAPABILITY=(general|reasoning|review)$/m)?.[1] || 'reasoning',
      htmlUrl: String(issue.html_url || '')
    };
  });

  const order = { P0: 0, P1: 1, P2: 2, P3: 3 };
  filtered.sort((a, b) => {
    const pa = order[a.priority] ?? 2;
    const pb = order[b.priority] ?? 2;
    if (pa !== pb) return pa - pb;
    return a.number - b.number;
  });
  return filtered;
}

export async function dispatchAutoBacklog({ pool, fetchImpl = fetch, owner = DEFAULT_OWNER, repo = DEFAULT_REPO, token = '' }) {
  const issues = await fetchIssues(fetchImpl, owner, repo, token);
  const executable = filterBacklogIssues(issues);
  let dispatched = 0, skipped = 0;
  for (const item of executable) {
    const existing = await pool.query("select id from tigeriq_objectives where metadata->>'githubIssueNumber'=$1 limit 1", [String(item.number)]);
    if (existing.rows.length > 0) {
      skipped++;
      continue;
    }
    const isCoding = item.body.includes('ROUTE=CODING') || item.title.toLowerCase().includes('coding') || item.capability === 'reasoning';
    const routeTarget = isCoding ? 'coding_handoff' : 'api_eligible';
    const metadata = {
      githubIssueNumber: item.number,
      githubHtmlUrl: item.htmlUrl,
      priority: item.priority,
      capability: item.capability,
      dispatchSource: 'auto_backlog',
      routeTarget,
      ownerDirect: true
    };
    const objectiveId = `OBJ-GBK-${item.number}-${Date.now().toString(36)}`;
    await pool.query(
      `insert into tigeriq_objectives (
        id, objective, priority, status, summary, manager_cycles, next_check_at, timestamps, metadata, created_at, updated_at
      ) values ($1, $2, $3, 'active', $4, 0, now(), '{}'::jsonb, $5::jsonb, now(), now())`,
      [
        objectiveId,
        item.body,
        item.priority,
        item.title,
        JSON.stringify(metadata)
      ]
    );
    if (routeTarget === 'coding_handoff') {
      try {
        const { materializeGithubCodingIssues } = await import('./github-coding-intake.mjs');
        await materializeGithubCodingIssues({ pool, fetchImpl, owner, repo, token });
      } catch (err) {
        console.error(JSON.stringify({ event: 'CODING_HANDOFF_DISPATCH_ERROR', error: String(err?.message || err) }));
      }
    }
    dispatched++;
  }
  return { checked: issues.length, dispatched, skipped };
}

export function startGithubIntake({databaseUrl=process.env.DATABASE_URL,fetchImpl=fetch,owner=process.env.TIGERIQ_GITHUB_OWNER||DEFAULT_OWNER,repo=process.env.TIGERIQ_GITHUB_REPO||DEFAULT_REPO,token=process.env.TIGERIQ_GITHUB_TOKEN||process.env.GITHUB_TOKEN||'',intervalMs=Number(process.env.TIGERIQ_GITHUB_INTAKE_MS||DEFAULT_INTERVAL_MS),initialDelayMs=DEFAULT_INITIAL_DELAY_MS}={}){
  if(!databaseUrl) return {enabled:false,stop(){}};
  const pool=new Pool({connectionString:databaseUrl,max:1}); let stopped=false,busy=false,timer=null,interval=null;
  const tick=async()=>{if(stopped||busy)return;busy=true;try{const a=await materializeGithubIssues({pool,fetchImpl,owner,repo,token});const b=await syncGithubOutcomes({pool,fetchImpl,owner,repo,token});const c=await dispatchAutoBacklog({pool,fetchImpl,owner,repo,token});if(a.created||b.claims||b.results||c.dispatched)console.log(JSON.stringify({event:'GITHUB_INTAKE_SYNC',created:a.created,claims:b.claims,results:b.results,dispatchedBacklog:c.dispatched}));}catch(e){console.error(JSON.stringify({event:'GITHUB_INTAKE_ERROR',error:String(e?.message||e)}));}finally{busy=false;}};
  timer=setTimeout(()=>{void tick();interval=setInterval(()=>void tick(),Math.max(60000,intervalMs));interval.unref?.();},Math.max(1000,initialDelayMs)); timer.unref?.();
  return {enabled:true,async stop(){stopped=true;if(timer)clearTimeout(timer);if(interval)clearInterval(interval);await pool.end();}};
}
