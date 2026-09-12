import {Pool} from 'pg';
const DEFAULT_OWNER='newsdayads';
const DEFAULT_REPO='tigeriq-ai-lab';
const DEFAULT_CODING_URL='http://100.97.23.87:8797';
const DEFAULT_INTERVAL_MS=120000;

function exactFlag(body,key,value='true'){
  return new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}=${value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}$`,'m').test(String(body||''));
}
export function parseCodingIssue(issue){
  if(!issue||issue.pull_request||issue.state!=='open')return null;
  const body=String(issue.body||'');
  const required=[['TIGERIQ_EXECUTABLE','true'],['OWNER_POLICY','AUTO'],['AUTONOMOUS_CODE','true'],['ZERO_COST','true'],['NO_PC01_SHELL','true'],['NO_PAID_COST','true'],['NO_CREDENTIAL_CHANGE','true'],['NO_DESTRUCTIVE','true'],['NO_PRODUCTION_RELEASE','true'],['NO_BROWSER_AUTH','true'],['NO_DIRECT_MAIN','true']];
  if(required.some(([k,v])=>!exactFlag(body,k,v)))return null;
  const priority=body.match(/^PRIORITY=(P[0-3])$/m)?.[1]||'P1';
  return {number:Number(issue.number),title:String(issue.title||''),body,priority:priority==='P3'?'P2':priority,url:String(issue.html_url||'')};
}
async function jsonFetch(fetchImpl,url,init={}){const res=await fetchImpl(url,{...init,signal:AbortSignal.timeout(12000)});const text=await res.text();let body={};try{body=text?JSON.parse(text):{}}catch{body={text}}if(!res.ok)throw new Error(`HTTP_${res.status}:${String(body?.error||body?.message||text).slice(0,300)}`);return body}
async function gh(fetchImpl,owner,repo,path,token,init={}){const headers={accept:'application/vnd.github+json','content-type':'application/json','user-agent':'TigerIQ-Coding-Intake/1.0','x-github-api-version':'2022-11-28',...(init.headers||{})};if(token)headers.authorization=`Bearer ${token}`;return jsonFetch(fetchImpl,`https://api.github.com/repos/${owner}/${repo}${path}`,{...init,headers})}
async function comment(fetchImpl,owner,repo,n,token,body){if(token)await gh(fetchImpl,owner,repo,`/issues/${n}/comments`,token,{method:'POST',body:JSON.stringify({body})})}
async function close(fetchImpl,owner,repo,n,token){if(token)await gh(fetchImpl,owner,repo,`/issues/${n}`,token,{method:'PATCH',body:JSON.stringify({state:'closed',state_reason:'completed'})})}
async function markerExists(pool,type,n){const q=await pool.query("select 1 from tigeriq_events where type=$1 and data->>'issueNumber'=$2 limit 1",[type,String(n)]);return q.rowCount>0}
async function mark(pool,type,data){await pool.query('insert into tigeriq_events(type,data) values($1,$2)',[type,JSON.stringify(data)])}

export async function materializeGithubCodingIssues({pool,fetchImpl=fetch,owner=DEFAULT_OWNER,repo=DEFAULT_REPO,token='',codingLaneUrl=process.env.TIGERIQ_CODING_LANE_URL||DEFAULT_CODING_URL}){
  const issues=await gh(fetchImpl,owner,repo,'/issues?state=open&per_page=100&sort=updated&direction=desc',token);let created=0;
  for(const issue of issues){const spec=parseCodingIssue(issue);if(!spec||await markerExists(pool,'GITHUB_CODING_DISPATCHED',spec.number))continue;const objective=`GitHub autonomous coding issue #${spec.number}: ${spec.title}\n${spec.url}\n\n${spec.body}\n\nExecute only zero-cost reversible repository work. Keep direct main writes, paid cost, credentials/security, destructive actions, production release, browser authentication and PC01 source editing blocked.`;const out=await jsonFetch(fetchImpl,`${codingLaneUrl.replace(/\/$/,'')}/api/objectives`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({objective,priority:spec.priority})});if(!out?.id)throw new Error('CODING_OBJECTIVE_ID_MISSING');await mark(pool,'GITHUB_CODING_DISPATCHED',{issueNumber:spec.number,issueUrl:spec.url,codingObjectiveId:out.id});await comment(fetchImpl,owner,repo,spec.number,token,`[CLAIM] TigerIQ Coding Lane accepted this issue as ${out.id}. Automatic coding pipeline is active.`);created++}
  return {created};
}
export async function syncGithubCodingOutcomes({pool,fetchImpl=fetch,owner=DEFAULT_OWNER,repo=DEFAULT_REPO,token='',codingLaneUrl=process.env.TIGERIQ_CODING_LANE_URL||DEFAULT_CODING_URL}){
  const rows=(await pool.query("select data from tigeriq_events where type='GITHUB_CODING_DISPATCHED' limit 100")).rows;if(!rows.length)return {progress:0,results:0};const status=await jsonFetch(fetchImpl,`${codingLaneUrl.replace(/\/$/,'')}/api/status`);let progress=0,results=0;
  for(const row of rows){const n=Number(row.data?.issueNumber),id=String(row.data?.codingObjectiveId||'');if(!n||!id)continue;const objective=(status.objectives||[]).find(x=>x.id===id);if(!objective)continue;const job=(status.jobs||[]).find(x=>x.objective_id===id);if(job&&!(await markerExists(pool,'GITHUB_CODING_PROGRESS_REPORTED',n))){const pr=job.pr_number?` PR #${job.pr_number}.`:'';await comment(fetchImpl,owner,repo,n,token,`[PROGRESS] ${id} is ${job.status}. Implementer: ${job.employee_id||'pending'}; reviewer: ${job.reviewer_employee_id||'pending'}.${pr}`);await mark(pool,'GITHUB_CODING_PROGRESS_REPORTED',{issueNumber:n,codingObjectiveId:id,jobId:job.id,prNumber:job.pr_number||null});progress++}if(['completed','blocked'].includes(objective.status)&&!(await markerExists(pool,'GITHUB_CODING_RESULT_REPORTED',n))){await comment(fetchImpl,owner,repo,n,token,`[RESULT] ${id} ${objective.status}. ${String(objective.summary||'').slice(0,3000)}`);if(objective.status==='completed')await close(fetchImpl,owner,repo,n,token);await mark(pool,'GITHUB_CODING_RESULT_REPORTED',{issueNumber:n,codingObjectiveId:id,status:objective.status});results++}}
  return {progress,results};
}
export function startGithubCodingIntake({databaseUrl=process.env.DATABASE_URL,fetchImpl=fetch,owner=process.env.TIGERIQ_GITHUB_OWNER||DEFAULT_OWNER,repo=process.env.TIGERIQ_GITHUB_REPO||DEFAULT_REPO,token=process.env.TIGERIQ_GITHUB_TOKEN||process.env.GITHUB_TOKEN||'',codingLaneUrl=process.env.TIGERIQ_CODING_LANE_URL||DEFAULT_CODING_URL,intervalMs=Number(process.env.TIGERIQ_GITHUB_INTAKE_MS||DEFAULT_INTERVAL_MS),initialDelayMs=20000}={}){
  if(!databaseUrl)return {enabled:false,stop(){}};const pool=new Pool({connectionString:databaseUrl,max:1});let stopped=false,busy=false,timer=null,interval=null;const tick=async()=>{if(stopped||busy)return;busy=true;try{const a=await materializeGithubCodingIssues({pool,fetchImpl,owner,repo,token,codingLaneUrl});const b=await syncGithubCodingOutcomes({pool,fetchImpl,owner,repo,token,codingLaneUrl});if(a.created||b.progress||b.results)console.log(JSON.stringify({event:'GITHUB_CODING_INTAKE_SYNC',created:a.created,progress:b.progress,results:b.results}))}catch(e){console.error(JSON.stringify({event:'GITHUB_CODING_INTAKE_ERROR',error:String(e?.message||e)}))}finally{busy=false}};timer=setTimeout(()=>{void tick();interval=setInterval(()=>void tick(),Math.max(60000,intervalMs));interval.unref?.()},Math.max(1000,initialDelayMs));timer.unref?.();return {enabled:true,async stop(){stopped=true;if(timer)clearTimeout(timer);if(interval)clearInterval(interval);await pool.end()}};
}
