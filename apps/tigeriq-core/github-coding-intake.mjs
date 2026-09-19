import {Pool} from 'pg';
import {backlogOwnerDirect,sortBacklogSpecs} from './github-backlog-policy.mjs';
const DEFAULT_OWNER='newsdayads';
const DEFAULT_REPO='tigeriq-ai-lab';
const DEFAULT_CODING_URL='http://100.97.23.87:8797';
const DEFAULT_INTERVAL_MS=120000;
const MAX_AUTO_RETRIES=2;
const PROVIDER_RETRY_BASE_MS=60000;

function exactFlag(body,key,value='true'){
  return new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}=${value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}$`,'m').test(String(body||''));
}

export function extractCodingDependencies(body){
  const raw=String(body||'').match(/^DEPENDS_ON=(.+)$/m)?.[1]||'';
  const values=(raw.match(/#?\d+/g)||[]).map(x=>Number(x.replace(/^#/,''))).filter(n=>Number.isInteger(n)&&n>0);
  return [...new Set(values)].slice(0,16);
}

export function parseCodingIssue(issue){
  if(!issue||issue.pull_request||issue.state!=='open')return null;
  const body=String(issue.body||'');
  const required=[['TIGERIQ_EXECUTABLE','true'],['OWNER_POLICY','AUTO'],['AUTONOMOUS_CODE','true'],['ZERO_COST','true'],['NO_PC01_SHELL','true'],['NO_PAID_COST','true'],['NO_CREDENTIAL_CHANGE','true'],['NO_DESTRUCTIVE','true'],['NO_PRODUCTION_RELEASE','true'],['NO_BROWSER_AUTH','true'],['NO_DIRECT_MAIN','true']];
  if(required.some(([k,v])=>!exactFlag(body,k,v)))return null;
  const sourcePriority=body.match(/^PRIORITY=(P[0-3])$/m)?.[1]||'P1';
  const priority=sourcePriority==='P3'?'P2':sourcePriority;
  return {number:Number(issue.number),title:String(issue.title||''),body,priority,sourcePriority,url:String(issue.html_url||''),dependsOn:extractCodingDependencies(body),ownerDirect:backlogOwnerDirect(body)};
}

async function jsonFetch(fetchImpl,url,init={}){const res=await fetchImpl(url,{...init,signal:AbortSignal.timeout(12000)});const text=await res.text();let body={};try{body=text?JSON.parse(text):{}}catch{body={text}}if(!res.ok)throw new Error(`HTTP_${res.status}:${String(body?.error||body?.message||text).slice(0,300)}`);return body}
async function gh(fetchImpl,owner,repo,path,token,init={}){const headers={accept:'application/vnd.github+json','content-type':'application/json','user-agent':'TigerIQ-Coding-Intake/1.0','x-github-api-version':'2022-11-28',...(init.headers||{})};if(token)headers.authorization=`Bearer ${token}`;return jsonFetch(fetchImpl,`https://api.github.com/repos/${owner}/${repo}${path}`,{...init,headers})}
async function comment(fetchImpl,owner,repo,n,token,body){if(token)await gh(fetchImpl,owner,repo,`/issues/${n}/comments`,token,{method:'POST',body:JSON.stringify({body})})}
async function close(fetchImpl,owner,repo,n,token){if(token)await gh(fetchImpl,owner,repo,`/issues/${n}`,token,{method:'PATCH',body:JSON.stringify({state:'closed',state_reason:'completed'})})}
async function markerExists(pool,type,n){const q=await pool.query("select 1 from tigeriq_events where type=$1 and data->>'issueNumber'=$2 limit 1",[type,String(n)]);return q.rowCount>0}
async function eventData(pool,type,n){const q=await pool.query("select data from tigeriq_events where type=$1 and data->>'issueNumber'=$2 order by seq desc limit 100",[type,String(n)]);return q.rows.map(row=>row.data||{})}
async function mark(pool,type,data){await pool.query('insert into tigeriq_events(type,data) values($1,$2)',[type,JSON.stringify(data)])}
async function hasCompletedCodingResult(pool,n){return (await eventData(pool,'GITHUB_CODING_RESULT_REPORTED',n)).some(x=>String(x.status||'').toLowerCase()==='completed')}
export function classifyCodingBlocker(summary){
  const raw=String(summary||'').trim();
  const text=raw.toUpperCase();
  const hard=/(SECURITY|CREDENTIAL|PAID|DESTRUCTIVE|PRODUCTION|BROWSER_AUTH|AUTHORIZATION_REQUIRED|HUMAN_POLICY|SCOPE_VIOLATION|OUT_OF_SCOPE|POLICY_BLOCK|POLICY_REJECT|REVIEW_(?:REJECTED|CHANGES).*HUMAN)/.test(text);
  if(hard)return {kind:'HARD',transient:false,reason:raw||'HARD_POLICY_BLOCK'};
  const transient=/(HTTP[_ -]?429|RATE[_ -]?LIMIT|PROVIDER|TIMEOUT|TRANSIENT|NETWORK|RESOURCE_EXHAUSTED|WAITING_RESOURCE)/.test(text);
  const recoverable=transient||/(CODING_COMPACT_EDIT_INVALID|CODING_COMPACT_REPAIR(?:_MULTI_FILE)?_INVALID|COMPACT_(?:EDIT|REPAIR)|OUTPUT_CONTRACT|OUTPUT_SCHEMA|SCHEMA_INVALID|CI_GATE_REPAIR_EXHAUSTED|CI_REPAIR_EXHAUSTED)/.test(text);
  return recoverable?{kind:'RECOVERABLE',transient,reason:raw||'RECOVERABLE_BLOCK'}:{kind:'HARD',transient:false,reason:raw||'UNCLASSIFIED_TERMINAL'};
}
function issueSuperseded(issue){
  if(!issue||issue.state!=='open')return true;
  const body=String(issue.body||'');
  return /^(?:STATE=(?:SUPERSEDED|CANCELLED)|SUPERSEDED(?:_BY)?=|TIGERIQ_EXECUTABLE=false)$/mi.test(body);
}
function objectiveTerminal(objective){return ['completed','blocked'].includes(String(objective?.status||'').toLowerCase())}
function objectiveMentionsIssue(objective,n){return new RegExp(`(?:issue\\s+|#)${n}\\b`,'i').test(String(objective?.objective||''))}
function objectiveIssueNumber(objective){const m=String(objective?.objective||'').match(/\bissue\s+#(\d+)\b/i);const n=Number(m?.[1]||0);return Number.isInteger(n)&&n>0?n:null}
async function activeCodingOwnerBlocksRetry({pool,status,fetchImpl,owner,repo,token,excludeObjectiveIds=[]}){
  const excluded=new Set(excludeObjectiveIds.filter(Boolean));
  for(const active of status.objectives||[]){
    if(excluded.has(active?.id)||objectiveTerminal(active))continue;
    const sourceIssueNumber=objectiveIssueNumber(active);
    if(!sourceIssueNumber)return true;
    let sourceIssue;
    try{sourceIssue=await gh(fetchImpl,owner,repo,`/issues/${sourceIssueNumber}`,token)}catch{return true}
    if(sourceIssue?.state==='open'&&!sourceIssue?.pull_request)return true;
    if(!(await markerExists(pool,'GITHUB_CODING_STALE_OWNER_IGNORED',sourceIssueNumber))){
      await mark(pool,'GITHUB_CODING_STALE_OWNER_IGNORED',{issueNumber:sourceIssueNumber,codingObjectiveId:active.id,sourceState:String(sourceIssue?.state||'unknown')});
    }
  }
  return false;
}
async function hasOpenCodingDispatch(pool){
  const q=await pool.query("select 1 from (select data from tigeriq_events where type='GITHUB_CODING_DISPATCHED' order by seq desc limit 1) d where not exists(select 1 from tigeriq_events r where r.data->>'issueNumber'=d.data->>'issueNumber' and (r.type='GITHUB_CODING_BLOCKED_FINAL' or (r.type='GITHUB_CODING_RESULT_REPORTED' and lower(coalesce(r.data->>'status',''))='completed')))");
  return q.rowCount>0;
}

export async function acquireScopeLease(pool, scopeKey, holderId, ttlMs=600000){
  const now=Date.now();
  const expiresAt=new Date(now+ttlMs).toISOString();
  await pool.query(`
    insert into tigeriq_leases (scope_key, holder_id, expires_at, updated_at)
    values ($1, $2, $3, to_timestamp($4/1000.0))
    on conflict (scope_key) do update
    set holder_id = excluded.holder_id,
        expires_at = excluded.expires_at,
        updated_at = excluded.updated_at
    where tigeriq_leases.expires_at < to_timestamp($4/1000.0) or tigeriq_leases.holder_id = $2
  `, [scopeKey, holderId, expiresAt, now]);
  const res=await pool.query('select holder_id from tigeriq_leases where scope_key=$1', [scopeKey]);
  return res.rows[0]?.holder_id===holderId;
}

async function dependencyGate(fetchImpl,owner,repo,token,dependsOn){
  for(const depNum of dependsOn){
    let depIssue;
    try{depIssue=await gh(fetchImpl,owner,repo,`/issues/${depNum}`,token)}catch(error){return {ok:false,reason:'DEPENDENCY_LOOKUP_FAILED',dependency:depNum,error:String(error?.message||error)}}
    if(!depIssue||depIssue.pull_request||depIssue.state!=='closed')return {ok:false,reason:'DEPENDENCY_OPEN',dependency:depNum,state:String(depIssue?.state||'unknown')};
  }
  return {ok:true};
}

export async function materializeGithubCodingIssues({pool,fetchImpl=fetch,owner=DEFAULT_OWNER,repo=DEFAULT_REPO,token='',codingLaneUrl=process.env.TIGERIQ_CODING_LANE_URL||DEFAULT_CODING_URL}){
  if(await hasOpenCodingDispatch(pool))return {created:0,active:1,considered:0};
  const issues=await gh(fetchImpl,owner,repo,'/issues?state=open&per_page=100&sort=updated&direction=desc',token);
  const specs=sortBacklogSpecs(issues.map(parseCodingIssue).filter(Boolean));
  
...[MODEL_CONTEXT_REDUCED]...
G_COMPACT_EDIT_INVALID'},
        {id:'obj-806',status:'blocked',summary:'CODING_COMPACT_EDIT_INVALID'}
      ],jobs:[]});
      if(url.includes('/api/objectives')){posted++;return response({id:`obj-retry-${posted}`});}
      if(url.includes('/issues/805'))return response(issue(SAFE,{number:805}));
      if(url.includes('/issues/806'))return response(issue(SAFE,{number:806}));
      if(url.includes('/comments'))return response({});
      return response({});
    };
    await syncGithubCodingOutcomes({pool,fetchImpl,token:'fake',now:()=>1000});
    expect(posted).toBe(1);
    expect(pool.events.filter(e=>e.type==='GITHUB_CODING_RETRY_DISPATCHED')).toHaveLength(1);
  });

  it('resumes idempotently after restart between retry POST and durable dispatch markers',async()=>{
    const pool=fakePool();
    pool.events.push(
      {type:'GITHUB_CODING_DISPATCHED',data:{issueNumber:804,codingObjectiveId:'obj-804'}},
      {type:'GITHUB_CODING_RETRY_SCHEDULED',data:{issueNumber:804,priorObjectiveId:'obj-804',retryAttempt:1,reason:'CODING_COMPACT_EDIT_INVALID',transient:false,nextAt:new Date(0).toISOString()}}
    );
    const current=issue(SAFE,{number:804});
    let posted=0;
    const existingRetry={id:'obj-existing-retry',status:'queued',objective:'RETRY_KEY=GITHUB-ISSUE-804-RETRY-1 issue #804'};
    const fetchImpl=async(url)=>{
      if(url.includes('/api/status'))return response({objectives:[{id:'obj-804',status:'blocked',summary:'CODING_COMPACT_EDIT_INVALID'},existingRetry],jobs:[]});
      if(url.includes('/api/objectives')){posted++;return response({id:'unexpected'});}
      if(url.includes('/issues/804'))return response(current);
      if(url.includes('/comments'))return response({});
      return response({});
    };
    await syncGithubCodingOutcomes({pool,fetchImpl,token:'fake',now:()=>1000});
    await syncGithubCodingOutcomes({pool,fetchImpl,token:'fake',now:()=>1000});
    expect(posted).toBe(0);
    expect(pool.events.filter(e=>e.type==='GITHUB_CODING_RETRY_DISPATCHED')).toHaveLength(1);
    expect(pool.events.filter(e=>e.type==='GITHUB_CODING_DISPATCHED')).toHaveLength(2);
  });
});

it('coding backlog serializes three issues by OWNER_DIRECT then priority',async()=>{
  const pool=fakePool(); const posted=[];
  const withFlags=(number,priority,ownerDirect=false)=>issue(`${SAFE.replace('PRIORITY=P1',`PRIORITY=${priority}`)}${ownerDirect?'\nOWNER_DIRECT=true':''}`,{number,title:`Issue ${number}`});
  const issues=[
    withFlags(30,'P0',false),
    withFlags(20,'P2',true),
    withFlags(10,'P1',true),
  ];
  const fetchImpl=async(url,init={})=>{
    if(url.includes('/issues?'))return response(issues);
    if(url.includes('/api/objectives')){
      const payload=JSON.parse(init.body);
      posted.push(payload.objective);
      return response({id:`obj-${posted.length}`});
    }
    if(url.includes('/comments'))return response({});
    return response({});
  };

  let out=await materializeGithubCodingIssues({pool,fetchImpl,token:'fake'});
  expect(out.issueNumber).toBe(10);
  expect(posted[0]).toContain('#10');

  out=await materializeGithubCodingIssues({pool,fetchImpl,token:'fake'});
  expect(out.created).toBe(0);
  expect(out.active).toBe(1);

  pool.events.push({type:'GITHUB_CODING_RESULT_REPORTED',data:{issueNumber:10,status:'completed'}});
  out=await materializeGithubCodingIssues({pool,fetchImpl,token:'fake'});
  expect(out.issueNumber).toBe(20);
  expect(posted[1]).toContain('#20');

  pool.events.push({type:'GITHUB_CODING_RESULT_REPORTED',data:{issueNumber:20,status:'completed'}});
  out=await materializeGithubCodingIssues({pool,fetchImpl,token:'fake'});
  expect(out.issueNumber).toBe(30);
  expect(posted[2]).toContain('#30');
});
