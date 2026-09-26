import {PRIORITY_RANK,bodyValue,effectiveBacklogPriority,exactBodyFlag} from './github-backlog-policy.mjs';
import {activeRoleClaim,classifyWorkOrder} from './work-routing-policy.mjs';

const OWNER='newsdayads',REPO='tigeriq-ai-lab';
const WORKERS=['NV02','NV03','NV04'];
const REQUIRED=['NO_PC01_SHELL','NO_DIRECT_MAIN','NO_PAID_COST','NO_CREDENTIAL_CHANGE','NO_DESTRUCTIVE','NO_PRODUCTION_RELEASE'];

function value(body,key){return bodyValue(body,key);}
function yes(body,key){return exactBodyFlag(body,key,'true');}
function clean(v){return String(v||'').replace(/[\r\n\t]+/g,' ').replace(/\s+/g,' ').trim().slice(0,180);}
function rank(p){return PRIORITY_RANK[String(p||'P5')]??PRIORITY_RANK.P5;}
function issueNo(jobId){const m=String(jobId||'').match(/^GH-(\d+)$/);return m?Number(m[1]):null;}
function resourceId(workerId){return 'res:ui:'+String(workerId).toLowerCase()+':subscription:chrome';}

export function selectCoreUiWorker(capability='general'){
  const cap=String(capability||'general').toLowerCase();
  return cap==='review'?'NV03':(cap==='research'||cap==='deep_research')?'NV04':'NV02';
}

export function parseCoreUiIssue(issue){
  if(!issue||issue.pull_request||issue.state!=='open')return null;
  const body=String(issue.body||'');
  if(!yes(body,'TIGERIQ_EXECUTABLE')||value(body,'OWNER_POLICY')!=='AUTO')return null;
  if(REQUIRED.some(k=>!yes(body,k)))return null;
  const readOnly=yes(body,'NO_CODE_CHANGE');
  const autonomousCode=yes(body,'AUTONOMOUS_CODE');
  if(!readOnly&&!autonomousCode)return null;
  const classification=classifyWorkOrder(body);
  if(classification.route!=='UI'||!WORKERS.includes(String(classification.workerId||'')))return null;
  const resourceScope=String(value(body,'RESOURCE_SCOPE')||'').trim();if(!resourceScope)return null;
  const number=Number(issue.number);if(!Number.isInteger(number)||number<=0)return null;
  return {
    number,jobId:'GH-'+number,workItemId:'CORE-UI-GH-'+number,title:clean(issue.title),url:String(issue.html_url||''),
    priority:classification.priority,sourcePriority:classification.sourcePriority,legacyP0Autonomous:classification.legacyP0Autonomous,
    ownerControlled:classification.ownerControlled,capability:classification.capability,resourceScope,workerId:classification.workerId,
    readOnly,autonomousCode,updatedAt:String(issue.updated_at||''),commentCount:Math.max(0,Number(issue.comments||0)),
  };
}

export function buildCoreUiPrompt(spec,repo=OWNER+'/'+REPO){
  return 'LÀM — NO YAPPING. CURRENT_WORK_ORDER=['+spec.url+'] | JOB_ID='+spec.jobId+'. Đây là Core assignment ưu tiên hơn role-fallback. Chỉ làm #'+spec.number+' - '+spec.title+' trong repo '+repo+'. Không tự đổi sang P0/việc khác khi assignment còn hiệu lực. Tuân thủ guardrail; không MAIN/Production, không chi phí, không đổi credential/security, không destructive. Khi terminal hoặc phải handoff/wait, cập nhật evidence và nhả role lease nếu có.';
}

function bindings(){return Object.fromEntries(WORKERS.map(workerId=>[workerId,{workerId,state:'READY_UNASSIGNED',currentWorkOrder:null}]));}
export function readyUnassignedCoreUiSnapshot({observedAt=new Date().toISOString(),revision='core-ui-v3:ready-unassigned',previousJob,reason='NO_CURRENT_UI_ASSIGNMENT'}={}){
  return {source:'CORE',authority:'CORE',observedAt,revision,assignmentState:'READY_UNASSIGNED',previousJob,nextJobs:[],requiredWorkers:[],workerBindings:bindings(),reason};
}
function completion({jobId,workerId,priority,issueRef,closedAt,updatedAt,verifiedAt}){
  const completedAt=String(closedAt||updatedAt||verifiedAt),completionRevision=['core-ui-completion-v1',jobId,completedAt,String(updatedAt||'')].join(':');
  return {jobId,workItemId:'CORE-UI-'+jobId,workerId,status:'DONE',executable:false,priority,issueRef,coreSelected:true,completedAt,completionRevision,evidence:[{source:'GITHUB',ref:issueRef,verifiedAt,jobId,completedAt,completionRevision}]};
}
async function gh(fetchImpl,url,token=''){const headers={accept:'application/vnd.github+json','user-agent':'TigerIQ-Core-UI-Assignment/3.0','x-github-api-version':'2022-11-28'};if(token)headers.authorization='Bearer '+token;const r=await fetchImpl(url,{headers,signal:AbortSignal.timeout(12000)});if(!r.ok)throw new Error('GITHUB_HTTP_'+r.status);return r.json();}
async function readIssue(fetchImpl,owner,repo,token,n){return gh(fetchImpl,'https://api.github.com/repos/'+owner+'/'+repo+'/issues/'+n,token);}
async function readComments(fetchImpl,owner,repo,token,n,count){if(Number(count||0)<=0)return[];try{return await gh(fetchImpl,'https://api.github.com/repos/'+owner+'/'+repo+'/issues/'+n+'/comments?per_page=100',token);}catch{return[];}}

async function row(pool,{jobId,workerId}={}){
  const params=[];let where="o.status='active' and o.metadata->>'executionSurface'='CORE_UI' and j.kind='ui' and j.status in ('ui_assigned','ui_running')";
  if(jobId){params.push(jobId);where="j.id=$1 and j.kind='ui'";}
  else if(workerId){params.push(workerId);where+=" and j.employee_id=$1";}
  const q=await pool.query("select j.id job_id,j.objective_id,j.status,j.employee_id,j.resource_id,j.provider,j.created_at,j.started_at,j.completed_at,j.result,o.priority,o.metadata,o.updated_at objective_updated_at from tigeriq_jobs j join tigeriq_objectives o on o.id=j.objective_id where "+where+" order by j.created_at limit 1",params);
  return q.rows[0]||null;
}

async function reconcile({pool,fetchImpl,owner,repo,token,item,observedAt}){
  if(!item)return null;const n=Number(item.metadata?.issueNumber||issueNo(item.job_id));if(!n)return item;
  let issue;try{issue=await readIssue(fetchImpl,owner,repo,token,n);}catch{return item;}
  if(issue.state!=='closed')return {...item,issue};
  const done=issue.state_reason==='completed'||!issue.state_reason,status=done?'done':'cancelled';
  await pool.query("update tigeriq_jobs set status=$2,lease_until=null,completed_at=coalesce(completed_at,now()),result=coalesce(result,'{}'::jsonb)||$3::jsonb where id=$1 and status in ('ui_assigned','ui_running')",[item.job_id,status,JSON.stringify({source:'github',issueRef:issue.html_url,verifiedAt:observedAt})]);
  await pool.query("update tigeriq_objectives set status=$2,summary=$3,updated_at=now() where id=$1 and status='active'",[item.objective_id,done?'completed':'blocked',done?'Core-assigned UI Work Order completed with GitHub evidence':'Core-assigned UI Work Order cancelled/superseded']);
  return {...item,status,completed_at:issue.closed_at||issue.updated_at,issue};
}

async function scopeBusy(pool,scope){return (await pool.query("select 1 from tigeriq_objectives where status='active' and metadata->>'resourceScope'=$1 limit 1",[scope])).rowCount>0;}

async function materializeForWorker({pool,fetchImpl,owner,repo,token,workerId,rows}){
  if(await row(pool,{workerId}))return null;
  const specs=(Array.isArray(rows)?rows:[]).map(parseCoreUiIssue).filter(x=>x&&x.workerId===workerId).sort((a,b)=>rank(a.priority)-rank(b.priority)||a.number-b.number);
  for(const spec of specs){
    const oid='OBJ-UI-GH-'+spec.number;
    if((await pool.query('select 1 from tigeriq_objectives where id=$1',[oid])).rowCount)continue;
    if(await scopeBusy(pool,spec.resourceScope))continue;
    const comments=await readComments(fetchImpl,owner,repo,token,spec.number,spec.commentCount);
    if(activeRoleClaim(comments))continue;
    const metadata={source:'github_ui',issueNumber:spec.number,issueUrl:spec.url,capability:spec.capability,resourceScope:spec.resourceScope,executionSurface:'CORE_UI',uiWorkerId:spec.workerId,currentWorkOrder:'#'+spec.number+' - '+spec.title,assignmentAuthority:'CORE',readOnly:spec.readOnly,autonomousCode:spec.autonomousCode,sourcePriority:spec.sourcePriority,legacyP0Autonomous:spec.legacyP0Autonomous,ownerControlled:spec.ownerControlled};
    await pool.query("insert into tigeriq_objectives(id,objective,priority,status,summary,metadata) values($1,$2,$3,'active',$4,$5) on conflict(id) do nothing",[oid,'Core-selected UI Work Order #'+spec.number+' - '+spec.title,spec.priority,'CURRENT_WORK_ORDER=#'+spec.number+' - '+spec.title+'; worker='+spec.workerId,JSON.stringify(metadata)]);
    await pool.query("insert into tigeriq_jobs(id,objective_id,title,prompt,capability,kind,status,employee_id,resource_id,provider,routing_profile,routing_decision,max_attempts) values($1,$2,$3,$4,$5,'ui','ui_assigned',$6,$7,'ui','UI',$8,1) on conflict(id) do nothing",[spec.jobId,oid,'#'+spec.number+' - '+spec.title,buildCoreUiPrompt(spec,owner+'/'+repo),spec.capability,spec.workerId,resourceId(spec.workerId),JSON.stringify({authority:'CORE',workerId:spec.workerId,capability:spec.capability,resourceScope:spec.resourceScope})]);
    await pool.query("insert into tigeriq_events(type,objective_id,job_id,employee_id,resource_id,task_kind,data) values('CORE_UI_ASSIGNMENT_CREATED',$1,$2,$3,$4,'ui',$5)",[oid,spec.jobId,spec.workerId,resourceId(spec.workerId),JSON.stringify({issueNumber:spec.number,issueUrl:spec.url,resourceScope:spec.resourceScope,capability:spec.capability,priority:spec.priority})]);
    return row(pool,{workerId});
  }
  return null;
}

function publicJob(item,{status='READY',executable=true,prompt}={}){
  const m=item.metadata||{},out={jobId:String(item.job_id),workItemId:'CORE-UI-'+String(item.job_id),workerId:String(item.employee_id||m.uiWorkerId||'NV02'),status,executable,priority:String(item.priority||'P3'),issueRef:String(m.issueUrl||''),coreSelected:true,riskFlags:[],resourceScope:String(m.resourceScope||''),currentWorkOrder:String(m.currentWorkOrder||'')};
  if(prompt!==undefined)out.prompt=String(prompt||'');return out;
}

export async function buildCoreUiAssignmentSnapshot({pool,fetchImpl=fetch,token='',owner=OWNER,repo=REPO,previousJobId}={}){
  if(!pool)throw new Error('CORE_UI_POOL_REQUIRED');
  const observedAt=new Date().toISOString();let previous;
  let prev=previousJobId?await row(pool,{jobId:previousJobId}):null;
  if(prev){
    prev=await reconcile({pool,fetchImpl,owner,repo,token,item:prev,observedAt});
    const m=prev.metadata||{},n=Number(m.issueNumber||issueNo(prev.job_id));let issue=prev.issue;if(!issue&&n)try{issue=await readIssue(fetchImpl,owner,repo,token,n);}catch{}
    if(prev.status==='done'&&issue)previous=completion({jobId:prev.job_id,workerId:prev.employee_id||m.uiWorkerId||'NV02',priority:prev.priority||'P3',issueRef:m.issueUrl||issue.html_url,closedAt:issue.closed_at||prev.completed_at,updatedAt:issue.updated_at,verifiedAt:observedAt});
    else if(prev.status==='cancelled')previous=publicJob(prev,{status:'CANCELLED',executable:false});
    else{previous=publicJob(prev,{status:'RUNNING',executable:true});if(prev.status==='ui_assigned')await pool.query("update tigeriq_jobs set status='ui_running',started_at=coalesce(started_at,now()) where id=$1",[prev.job_id]);}
  }
  const issues=await gh(fetchImpl,'https://api.github.com/repos/'+owner+'/'+repo+'/issues?state=open&per_page=100&sort=created&direction=asc',token);
  const current=[];
  for(const workerId of WORKERS){
    let item=await row(pool,{workerId});
    if(item)item=await reconcile({pool,fetchImpl,owner,repo,token,item,observedAt});
    if(!item||!['ui_assigned','ui_running'].includes(String(item.status||'')))item=await materializeForWorker({pool,fetchImpl,owner,repo,token,workerId,rows:issues});
    if(item&&['ui_assigned','ui_running'].includes(String(item.status||'')))current.push(item);
  }
  const b=bindings(),nextJobs=[];
  for(const item of current){
    const wid=String(item.employee_id||item.metadata?.uiWorkerId||'NV02');
    const isPrevious=Boolean(previousJobId&&previousJobId===item.job_id);
    b[wid]={workerId:wid,state:isPrevious?'WORKING':'ASSIGNED',currentWorkOrder:{workItemId:'CORE-UI-'+item.job_id,jobId:item.job_id,issueRef:item.metadata?.issueUrl||null,resourceScope:item.metadata?.resourceScope||null,title:item.metadata?.currentWorkOrder||null}};
    if(!isPrevious&&item.status==='ui_assigned'){const p=(await pool.query('select prompt from tigeriq_jobs where id=$1',[item.job_id])).rows[0]?.prompt;nextJobs.push(publicJob(item,{status:'READY',executable:true,prompt:p}));}
  }
  nextJobs.sort((a,b2)=>rank(a.priority)-rank(b2.priority)||WORKERS.indexOf(a.workerId)-WORKERS.indexOf(b2.workerId));
  const nextJob=nextJobs[0];
  const requiredWorkers=current.map(x=>String(x.employee_id||x.metadata?.uiWorkerId||'NV02'));
  const assignmentState=nextJobs.length?'READY_ASSIGNED':current.length?'WORKING':'READY_UNASSIGNED';
  const revision=['core-ui-v3',previous?.jobId||'none',previous?.status||'none',...current.map(x=>x.job_id+':'+x.status)].join(':');
  if(!current.length&&!previous)return readyUnassignedCoreUiSnapshot({observedAt,revision});
  return{source:'CORE',authority:'CORE',observedAt,revision,assignmentState,previousJob:previous,nextJob,nextJobs,requiredWorkers,workerBindings:b};
}
