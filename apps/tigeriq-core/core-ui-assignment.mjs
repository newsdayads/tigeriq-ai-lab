const OWNER='newsdayads',REPO='tigeriq-ai-lab';
const WORKERS=['NV02','NV03','NV04'];
const REQUIRED=['NO_CODE_CHANGE','NO_PC01_SHELL','NO_DIRECT_MAIN','NO_PAID_COST','NO_CREDENTIAL_CHANGE','NO_DESTRUCTIVE','NO_PRODUCTION_RELEASE'];

function value(body,key){const e=String(key).replace(/[.*+?^\${}()|[\]\\]/g,'\\$&');return String(body||'').match(new RegExp('^'+e+'=([^\\r\\n]+)$','m'))?.[1]?.trim();}
function yes(body,key){return value(body,key)==='true';}
function clean(v){return String(v||'').replace(/[\r\n\t]+/g,' ').replace(/\s+/g,' ').trim().slice(0,180);}
function rank(p){return p==='P0'?0:p==='P1'?1:9;}
function issueNo(jobId){const m=String(jobId||'').match(/^GH-(\d+)$/);return m?Number(m[1]):null;}
function resourceId(workerId){return 'res:ui:'+String(workerId).toLowerCase()+':subscription:chrome';}

export function selectCoreUiWorker(capability='general'){
  const cap=String(capability||'general').toLowerCase();
  return cap==='review'?'NV03':(cap==='research'||cap==='reasoning')?'NV04':'NV02';
}

export function parseCoreUiIssue(issue){
  if(!issue||issue.pull_request||issue.state!=='open')return null;
  const body=String(issue.body||'');
  if(!yes(body,'TIGERIQ_EXECUTABLE')||value(body,'OWNER_POLICY')!=='AUTO'||String(value(body,'EXECUTION_SURFACE')||'').toUpperCase()!=='UI')return null;
  if(REQUIRED.some(k=>!yes(body,k)))return null;
  const priority=value(body,'PRIORITY'); if(!['P0','P1'].includes(priority))return null;
  const resourceScope=String(value(body,'RESOURCE_SCOPE')||'').trim(); if(!resourceScope)return null;
  const capability=String(value(body,'CAPABILITY')||'general').toLowerCase();
  if(!['ui','general','review','research','reasoning'].includes(capability))return null;
  const number=Number(issue.number); if(!Number.isInteger(number)||number<=0)return null;
  return {number,jobId:'GH-'+number,workItemId:'CORE-UI-GH-'+number,title:clean(issue.title),url:String(issue.html_url||''),priority,capability,resourceScope,workerId:selectCoreUiWorker(capability),updatedAt:String(issue.updated_at||'')};
}

export function buildCoreUiPrompt(spec,repo=OWNER+'/'+REPO){
  return 'LÀM — NO YAPPING. CURRENT_WORK_ORDER=['+spec.url+'] | JOB_ID='+spec.jobId+'. Đọc đầy đủ #'+spec.number+' - '+spec.title+' trong repo '+repo+' và chỉ thực hiện đúng Work Order đó. App Chrome/UI worker không được quét backlog, tự chọn P0 hoặc đổi sang việc khác. Tuân thủ guardrail; không MAIN/Production, không chi phí, không đổi credential/security, không destructive. Cập nhật GitHub bằng evidence kiểm chứng được; chỉ dừng DONE có evidence, BLOCKED thật, EXTERNAL_WAIT hoặc hard gate.';
}
function bindings(){return Object.fromEntries(WORKERS.map(workerId=>[workerId,{workerId,state:'READY_UNASSIGNED',currentWorkOrder:null}]));}
export function readyUnassignedCoreUiSnapshot({observedAt=new Date().toISOString(),revision='core-ui-v2:ready-unassigned',previousJob,reason='NO_CURRENT_UI_ASSIGNMENT'}={}){
  return {source:'CORE',authority:'CORE',observedAt,revision,assignmentState:'READY_UNASSIGNED',previousJob,requiredWorkers:[],workerBindings:bindings(),reason};
}
function completion({jobId,workerId,priority,issueRef,closedAt,updatedAt,verifiedAt}){
  const completedAt=String(closedAt||updatedAt||verifiedAt),completionRevision=['core-ui-completion-v1',jobId,completedAt,String(updatedAt||'')].join(':');
  return {jobId,workItemId:'CORE-UI-'+jobId,workerId,status:'DONE',executable:false,priority,issueRef,coreSelected:true,completedAt,completionRevision,evidence:[{source:'GITHUB',ref:issueRef,verifiedAt,jobId,completedAt,completionRevision}]};
}
async function gh(fetchImpl,url,token=''){const headers={accept:'application/vnd.github+json','user-agent':'TigerIQ-Core-UI-Assignment/2.0','x-github-api-version':'2022-11-28'};if(token)headers.authorization='Bearer '+token;const r=await fetchImpl(url,{headers,signal:AbortSignal.timeout(12000)});if(!r.ok)throw new Error('GITHUB_HTTP_'+r.status);return r.json();}
async function readIssue(fetchImpl,owner,repo,token,n){return gh(fetchImpl,'https://api.github.com/repos/'+owner+'/'+repo+'/issues/'+n,token);}
async function row(pool,jobId){
  const where=jobId?'j.id=$1 and j.kind=\'ui\'':"o.status='active' and o.metadata->>'executionSurface'='CORE_UI' and j.kind='ui' and j.status in ('ui_assigned','ui_running')";
  const q=await pool.query("select j.id job_id,j.objective_id,j.status,j.employee_id,j.resource_id,j.provider,j.created_at,j.started_at,j.completed_at,j.result,o.priority,o.metadata,o.updated_at objective_updated_at from tigeriq_jobs j join tigeriq_objectives o on o.id=j.objective_id where "+where+" order by j.created_at limit 1",jobId?[jobId]:[]);
  return q.rows[0]||null;
}
async function reconcile({pool,fetchImpl,owner,repo,token,item,observedAt}){
  if(!item)return null; const n=Number(item.metadata?.issueNumber||issueNo(item.job_id)); if(!n)return item;
  let issue;try{issue=await readIssue(fetchImpl,owner,repo,token,n);}catch{return item;}
  if(issue.state!=='closed')return {...item,issue};
  const done=issue.state_reason==='completed'||!issue.state_reason,status=done?'done':'cancelled';
  await pool.query("update tigeriq_jobs set status=$2,lease_until=null,completed_at=coalesce(completed_at,now()),result=coalesce(result,'{}'::jsonb)||$3::jsonb where id=$1 and status in ('ui_assigned','ui_running')",[item.job_id,status,JSON.stringify({source:'github',issueRef:issue.html_url,verifiedAt:observedAt})]);
  await pool.query("update tigeriq_objectives set status=$2,summary=$3,updated_at=now() where id=$1 and status='active'",[item.objective_id,done?'completed':'blocked',done?'Core-assigned UI Work Order completed with GitHub evidence':'Core-assigned UI Work Order cancelled/superseded']);
  return {...item,status,completed_at:issue.closed_at||issue.updated_at,issue};
}
async function scopeBusy(pool,scope){return (await pool.query("select 1 from tigeriq_objectives where status='active' and metadata->>'resourceScope'=$1 limit 1",[scope])).rowCount>0;}
async function materialize({pool,fetchImpl,owner,repo,token}){
  const rows=await gh(fetchImpl,'https://api.github.com/repos/'+owner+'/'+repo+'/issues?state=open&per_page=100&sort=created&direction=asc',token);
  const specs=(Array.isArray(rows)?rows:[]).map(parseCoreUiIssue).filter(Boolean).sort((a,b)=>rank(a.priority)-rank(b.priority)||a.number-b.number);
  for(const spec of specs){
    const oid='OBJ-UI-GH-'+spec.number;if((await pool.query('select 1 from tigeriq_objectives where id=$1',[oid])).rowCount)continue;if(await scopeBusy(pool,spec.resourceScope))continue;
    const metadata={source:'github_ui',issueNumber:spec.number,issueUrl:spec.url,capability:spec.capability,resourceScope:spec.resourceScope,executionSurface:'CORE_UI',uiWorkerId:spec.workerId,currentWorkOrder:'#'+spec.number+' - '+spec.title,assignmentAuthority:'CORE'};
    await pool.query("insert into tigeriq_objectives(id,objective,priority,status,summary,metadata) values($1,$2,$3,'active',$4,$5) on conflict(id) do nothing",[oid,'Core-selected UI Work Order #'+spec.number+' - '+spec.title,spec.priority,'CURRENT_WORK_ORDER=#'+spec.number+' - '+spec.title+'; worker='+spec.workerId,JSON.stringify(metadata)]);
    await pool.query("insert into tigeriq_jobs(id,objective_id,title,prompt,capability,kind,status,employee_id,resource_id,provider,routing_profile,routing_decision,max_attempts) values($1,$2,$3,$4,$5,'ui','ui_assigned',$6,$7,'ui','UI',$8,1) on conflict(id) do nothing",[spec.jobId,oid,'#'+spec.number+' - '+spec.title,buildCoreUiPrompt(spec,owner+'/'+repo),spec.capability,spec.workerId,resourceId(spec.workerId),JSON.stringify({authority:'CORE',workerId:spec.workerId,capability:spec.capability,resourceScope:spec.resourceScope})]);
    await pool.query("insert into tigeriq_events(type,objective_id,job_id,employee_id,resource_id,task_kind,data) values('CORE_UI_ASSIGNMENT_CREATED',$1,$2,$3,$4,'ui',$5)",[oid,spec.jobId,spec.workerId,resourceId(spec.workerId),JSON.stringify({issueNumber:spec.number,issueUrl:spec.url,resourceScope:spec.resourceScope,capability:spec.capability})]);
    return row(pool);
  } return null;
}
function publicJob(item,{status='READY',executable=true,prompt}={}){
  const m=item.metadata||{},out={jobId:String(item.job_id),workItemId:'CORE-UI-'+String(item.job_id),workerId:String(item.employee_id||m.uiWorkerId||'NV02'),status,executable,priority:String(item.priority||'P1'),issueRef:String(m.issueUrl||''),coreSelected:true,riskFlags:[],resourceScope:String(m.resourceScope||''),currentWorkOrder:String(m.currentWorkOrder||'')};
  if(prompt!==undefined)out.prompt=String(prompt||'');return out;
}
export async function buildCoreUiAssignmentSnapshot({pool,fetchImpl=fetch,token='',owner=OWNER,repo=REPO,previousJobId}={}){
  if(!pool)throw new Error('CORE_UI_POOL_REQUIRED');const observedAt=new Date().toISOString();let previous,prev=previousJobId?await row(pool,previousJobId):null;
  if(prev){prev=await reconcile({pool,fetchImpl,owner,repo,token,item:prev,observedAt});const m=prev.metadata||{},n=Number(m.issueNumber||issueNo(prev.job_id));let issue=prev.issue;if(!issue&&n)try{issue=await readIssue(fetchImpl,owner,repo,token,n);}catch{}
    if(prev.status==='done'&&issue)previous=completion({jobId:prev.job_id,workerId:prev.employee_id||m.uiWorkerId||'NV02',priority:prev.priority||'P1',issueRef:m.issueUrl||issue.html_url,closedAt:issue.closed_at||prev.completed_at,updatedAt:issue.updated_at,verifiedAt:observedAt});
    else if(prev.status==='cancelled')previous=publicJob(prev,{status:'CANCELLED',executable:false});
    else{previous=publicJob(prev,{status:'RUNNING',executable:true});if(prev.status==='ui_assigned')await pool.query("update tigeriq_jobs set status='ui_running',started_at=coalesce(started_at,now()) where id=$1",[prev.job_id]);}
  }else if(previousJobId){const n=issueNo(previousJobId);if(n)try{const issue=await readIssue(fetchImpl,owner,repo,token,n),body=String(issue.body||''),w=String(value(body,'PRIMARY_EMPLOYEE')||'NV02'),workerId=WORKERS.includes(w)?w:'NV02',p=value(body,'PRIORITY'),priority=['P0','P1'].includes(p)?p:'P1';previous=issue.state==='closed'?(issue.state_reason==='completed'||!issue.state_reason?completion({jobId:previousJobId,workerId,priority,issueRef:String(issue.html_url||''),closedAt:issue.closed_at,updatedAt:issue.updated_at,verifiedAt:observedAt}):{jobId:previousJobId,workItemId:'LEGACY-'+previousJobId,workerId,status:'CANCELLED',executable:false,priority,issueRef:String(issue.html_url||''),coreSelected:true}):{jobId:previousJobId,workItemId:'LEGACY-'+previousJobId,workerId,status:'RUNNING',executable:true,priority,issueRef:String(issue.html_url||''),coreSelected:true};}catch{}}
  let current=await row(pool);if(current)current=await reconcile({pool,fetchImpl,owner,repo,token,item:current,observedAt});if(!current||!['ui_assigned','ui_running'].includes(String(current.status||'')))current=await materialize({pool,fetchImpl,owner,repo,token});
  const b=bindings();if(current){const wid=String(current.employee_id||current.metadata?.uiWorkerId||'NV02');b[wid]={workerId:wid,state:previousJobId===current.job_id?'WORKING':'ASSIGNED',currentWorkOrder:{workItemId:'CORE-UI-'+current.job_id,jobId:current.job_id,issueRef:current.metadata?.issueUrl||null,resourceScope:current.metadata?.resourceScope||null,title:current.metadata?.currentWorkOrder||null}};}
  const blocks=Boolean(previous&&!['DONE','CANCELLED'].includes(previous.status)),same=Boolean(current&&previousJobId===current.job_id);let nextJob;
  if(current&&!blocks&&!same){const p=(await pool.query('select prompt from tigeriq_jobs where id=$1',[current.job_id])).rows[0]?.prompt;nextJob=publicJob(current,{status:'READY',executable:true,prompt:p});}
  const assignmentState=nextJob?'READY_ASSIGNED':current?'WORKING':'READY_UNASSIGNED',revision=['core-ui-v2',previous?.jobId||'none',previous?.status||'none',current?.job_id||'none',current?.status||'none',current?.objective_updated_at||'none'].join(':');
  if(!current&&!previous)return readyUnassignedCoreUiSnapshot({observedAt,revision});return{source:'CORE',authority:'CORE',observedAt,revision,assignmentState,previousJob:previous,nextJob,requiredWorkers:current?[String(current.employee_id||current.metadata?.uiWorkerId||'NV02')]:[],workerBindings:b};
}
