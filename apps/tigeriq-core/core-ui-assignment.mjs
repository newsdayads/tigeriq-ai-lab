import {createHash} from 'node:crypto';
import {PRIORITY_RANK,bodyValue,effectiveBacklogPriority,exactBodyFlag} from './github-backlog-policy.mjs';
import {activeRoleClaim,classifyWorkOrder} from './work-routing-policy.mjs';
import { localizeOwnerFacingText, ownerStatusIcon, ownerStatusLabel } from './owner-facing-vietnamese.mjs';

const OWNER='newsdayads',REPO='tigeriq-ai-lab';
const DEFAULT_TARGET_REPOSITORY=OWNER+'/'+REPO;
const ALLOWED_TARGET_REPOSITORIES=new Set([DEFAULT_TARGET_REPOSITORY.toLowerCase(),'newsdayads/tigeriq-media']);
const ALL_WORKERS=['NV02','NV03','NV04'];
const WORKERS=['NV03','NV04'];
const REQUIRED=['NO_PC01_SHELL','NO_DIRECT_MAIN','NO_PAID_COST','NO_CREDENTIAL_CHANGE','NO_DESTRUCTIVE','NO_PRODUCTION_RELEASE'];

function value(body,key){return bodyValue(body,key);}
function yes(body,key){return exactBodyFlag(body,key,'true');}
function clean(v){return String(v||'').replace(/[\r\n\t]+/g,' ').replace(/\s+/g,' ').trim().slice(0,180);}
function safeResult(v){return String(v||'').replace(/\0/g,'').trim().slice(0,4000);}
const VI_TERMINAL_TO_CODE=new Map([
  ['HOÀN TẤT','DONE'],
  ['BỊ CHẶN','BLOCKED'],
  ['CHỜ BÊN NGOÀI','EXTERNAL_WAIT'],
]);
export function coreUiTerminalStateFromComment(body=''){
  const text=String(body||'');
  const legacy=String(text.match(/^STATE=(DONE|BLOCKED|EXTERNAL_WAIT)$/m)?.[1]||'');
  if(legacy)return legacy;
  const vi=String(text.match(/^TRẠNG_THÁI=(.+)$/m)?.[1]||'').trim().toUpperCase();
  return VI_TERMINAL_TO_CODE.get(vi)||'';
}
export function formatCoreUiTerminalComment({jobId,workerId,state,result=''}) {
  const normalized=String(state||'').toUpperCase();
  const status=ownerStatusLabel(normalized);
  const ownerResult=localizeOwnerFacingText(safeResult(result||normalized));
  return [
    ownerStatusIcon(normalized)+' [KẾT QUẢ] TigerIQ Core đã nhận kết quả từ '+String(workerId||'')+'.',
    'Trạng thái: '+status,
    '',
    'TIGERIQ_CORE_UI_TERMINAL_V1',
    'TIGERIQ_CORE_UI_TERMINAL_KEY='+String(jobId||''),
    'JOB_ID='+String(jobId||''),
    'WORKER='+String(workerId||''),
    'TRẠNG_THÁI='+status,
    'SOURCE=APP_CHROME_UI_TRANSPORT',
    'RESULT_BEGIN',
    ownerResult,
    'RESULT_END',
  ].join('\n');
}
function rank(p){return PRIORITY_RANK[String(p||'P5')]??PRIORITY_RANK.P5;}
function issueNo(jobId){const m=String(jobId||'').match(/^GH-(\d+)(?:-R[a-f0-9]{12})?$/i);return m?Number(m[1]):null;}
function resourceId(workerId){return 'res:ui:'+String(workerId).toLowerCase()+':subscription:chrome';}
export function coreUiSourceRevision(issue={}){
  return createHash('sha256').update(String(issue?.title||'')).update('\n').update(String(issue?.body||'')).digest('hex').slice(0,12);
}
function coreUiRearmEpoch(body=''){
  let latest=0;
  for(const match of String(body||'').matchAll(/^(?:REARMED_AT|QUEUE_REARMED_AT|EPOCH_STARTED_AT)=(.+)$/gmi)){
    const ts=Date.parse(String(match[1]||'').trim());
    if(Number.isFinite(ts)&&ts>latest)latest=ts;
  }
  return latest;
}
const MAX_EXACT_CONTEXT_FILES=20;
const MAX_EXACT_CONTEXT_PATCH_CHARS=24000;
function targetPrNumber(body=''){
  const raw=String(value(body,'TARGET_PR')||'').trim();
  const match=raw.match(/#?(\d{1,8})/);
  return match?Number(match[1]):null;
}
function targetHeadSha(body=''){
  const raw=String(value(body,'TARGET_HEAD')||'').trim();
  return /^[a-f0-9]{40}$/i.test(raw)?raw.toLowerCase():'';
}

function resolveCoreUiTargetRepository(body=''){
  const raw=String(value(body,'TARGET_REPOSITORY')||'').trim();
  const selected=raw||DEFAULT_TARGET_REPOSITORY;
  const match=selected.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if(!match)return {valid:false,reason:'TARGET_REPOSITORY_INVALID',fullName:null,owner:null,repo:null};
  if(!ALLOWED_TARGET_REPOSITORIES.has(selected.toLowerCase()))return {valid:false,reason:'TARGET_REPOSITORY_NOT_ALLOWED',fullName:null,owner:null,repo:null};
  return {valid:true,reason:null,fullName:selected,owner:match[1],repo:match[2]};
}
function boundedPatchFiles(files=[]){
  let remaining=MAX_EXACT_CONTEXT_PATCH_CHARS;
  const out=[];
  for(const file of (Array.isArray(files)?files:[]).slice(0,MAX_EXACT_CONTEXT_FILES)){
    const filename=clean(file?.filename||'unknown');
    const status=clean(file?.status||'modified');
    const raw=String(file?.patch||'');
    const patch=raw.slice(0,Math.max(0,remaining));
    remaining-=patch.length;
    out.push(['FILE='+filename,'STATUS='+status,'PATCH_BEGIN',patch||'[PATCH_UNAVAILABLE]','PATCH_END'].join('\n'));
    if(remaining<=0)break;
  }
  return out;
}
export async function loadCoreUiExactHeadContext({fetchImpl=fetch,owner=OWNER,repo=REPO,token='',spec}={}){
  const body=String(spec?.body||'');
  const targetRepository=spec?.targetRepository?.valid?spec.targetRepository:resolveCoreUiTargetRepository(body);
  if(!targetRepository.valid)return {required:true,ok:false,reason:targetRepository.reason,targetPr:null,targetHead:null,targetRepository:null};
  const targetPr=targetPrNumber(body);
  const rawTargetHead=String(value(body,'TARGET_HEAD')||'').trim();
  const targetHead=targetHeadSha(body);
  if(!targetPr&&!rawTargetHead)return {required:false,ok:true,bundle:'',targetPr:null,targetHead:null,targetRepository:targetRepository.fullName};
  if(!targetPr)return {required:true,ok:false,reason:'TARGET_PR_REQUIRED',targetPr:null,targetHead:rawTargetHead||null,targetRepository:targetRepository.fullName};
  if(!targetHead)return {required:true,ok:false,reason:'TARGET_HEAD_REQUIRED_OR_INVALID',targetPr,targetHead:rawTargetHead||null,targetRepository:targetRepository.fullName};
  let pr,files;
  try{
    pr=await gh(fetchImpl,'https://api.github.com/repos/'+targetRepository.owner+'/'+targetRepository.repo+'/pulls/'+targetPr,token);
    const actualHead=String(pr?.head?.sha||'').toLowerCase();
    if(actualHead!==targetHead)return {required:true,ok:false,reason:'TARGET_HEAD_MISMATCH',targetPr,targetHead,actualHead};
    files=await gh(fetchImpl,'https://api.github.com/repos/'+targetRepository.owner+'/'+targetRepository.repo+'/pulls/'+targetPr+'/files?per_page=100',token);
  }catch(error){
    return {required:true,ok:false,reason:'EXACT_CONTEXT_LOAD_FAILED',targetPr,targetHead,error:String(error?.message||error)};
  }
  const patches=boundedPatchFiles(files);
  const bundle=[
    'EXACT_HEAD_CONTEXT_BEGIN',
    'REPOSITORY='+targetRepository.fullName,
    'TARGET_PR=#'+targetPr,
    'TARGET_HEAD='+targetHead,
    'PR_TITLE='+clean(pr?.title||''),
    'PR_STATE='+clean(pr?.state||''),
    'PR_BASE_SHA='+String(pr?.base?.sha||''),
    'PR_HEAD_SHA='+String(pr?.head?.sha||''),
    'PR_CHANGED_FILES='+String(pr?.changed_files??''),
    'PR_ADDITIONS='+String(pr?.additions??''),
    'PR_DELETIONS='+String(pr?.deletions??''),
    'CONTEXT_FILE_LIMIT='+MAX_EXACT_CONTEXT_FILES,
    'CONTEXT_PATCH_CHAR_LIMIT='+MAX_EXACT_CONTEXT_PATCH_CHARS,
    ...patches,
    'EXACT_HEAD_CONTEXT_END',
  ].join('\n');
  return {required:true,ok:true,targetPr,targetHead,targetRepository:targetRepository.fullName,bundle,fileCount:patches.length,truncated:Number(pr?.changed_files||0)>patches.length||String(bundle).length>=MAX_EXACT_CONTEXT_PATCH_CHARS};
}

export function selectCoreUiWorker(capability='general'){
  const cap=String(capability||'general').toLowerCase();
  return cap==='review'?'NV03':(cap==='research'||cap==='deep_research')?'NV04':null;
}

export function parseCoreUiIssue(issue){
  if(!issue||issue.pull_request||issue.state!=='open')return null;
  const body=String(issue.body||'');
  if(!yes(body,'TIGERIQ_EXECUTABLE')||value(body,'OWNER_POLICY')!=='AUTO')return null;
  const targetRepository=resolveCoreUiTargetRepository(body);
  if(!targetRepository.valid)return null;
  if(REQUIRED.some(k=>!yes(body,k)))return null;
  const readOnly=yes(body,'NO_CODE_CHANGE');
  const autonomousCode=yes(body,'AUTONOMOUS_CODE');
  if(!readOnly&&!autonomousCode)return null;
  const classification=classifyWorkOrder(body);
  if(classification.route!=='UI'||!WORKERS.includes(String(classification.workerId||'')))return null;
  const resourceScope=String(value(body,'RESOURCE_SCOPE')||'').trim();if(!resourceScope)return null;
  if(/^APP_CHROME_/i.test(resourceScope)||/\[APP-CHROME\]/i.test(String(issue.title||''))||/apps\/chrome-controller\//i.test(body))return null;
  const number=Number(issue.number);if(!Number.isInteger(number)||number<=0)return null;
  return {
    number,jobId:'GH-'+number,workItemId:'CORE-UI-GH-'+number,sourceRevision:coreUiSourceRevision(issue),title:clean(issue.title),url:String(issue.html_url||''),
    priority:classification.priority,sourcePriority:classification.sourcePriority,legacyP0Autonomous:classification.legacyP0Autonomous,
    ownerControlled:classification.ownerControlled,capability:classification.capability,resourceScope,workerId:classification.workerId,targetRepository,
    readOnly,autonomousCode,body:String(issue.body||'').slice(0,12000),updatedAt:String(issue.updated_at||''),commentCount:Math.max(0,Number(issue.comments||0)),
  };
}

export function buildCoreUiPrompt(spec,repo=OWNER+'/'+REPO,exactContext=''){
  const guard='LÀM — NO YAPPING. Đây là Core assignment duy nhất đang hiệu lực. Không tự đổi việc/P0. Không MAIN/Production, không chi phí, không credential/security, không destructive.';
  const body='WORK_ORDER_BODY_BEGIN\n'+String(spec.body||'').slice(0,12000)+'\nWORK_ORDER_BODY_END';
  const context=String(exactContext||'').trim();
  if(spec.workerId==='NV04'){
    const role=String(spec.capability||'').toLowerCase()==='review'?'INDEPENDENT_REVIEW':'DEEP_RESEARCH';
    return [
      guard,
      'NV04_ROLE='+role,
      'CURRENT_WORK_ORDER=#'+spec.number+' - '+spec.title,
      'EXACT_INPUT='+spec.url,
      'RESOURCE_SCOPE='+spec.resourceScope,
      'CHECKLIST=Thực hiện đúng Work Order/body bên dưới; kiểm chứng kết quả; không mutation source/runtime nếu Work Order không cho phép.',
      'OUTPUT=Trả kết quả ngắn gọn kèm evidence cần thiết; dòng cuối bắt buộc DONE hoặc BLOCKED hoặc EXTERNAL_WAIT.',
      'EVIDENCE_DESTINATION='+spec.url,
      'REVIEW_ONLY='+(role==='INDEPENDENT_REVIEW'?'true':'false'),
      'MUTATION_ALLOWED=false',
      body,
      context,
    ].filter(Boolean).join('\n');
  }
  return [
    guard,
    'CURRENT_WORK_ORDER=#'+spec.number+' - '+spec.title,
    'JOB_ID='+spec.jobId,
    'ROLE=INDEPENDENT_REVIEW_QA',
    'RESOURCE_SCOPE='+spec.resourceScope,
    'YÊU CẦU: làm đúng Work Order/body bên dưới; không tự quét backlog; dòng cuối bắt buộc DONE hoặc BLOCKED hoặc EXTERNAL_WAIT.',
    body,
    context,
  ].filter(Boolean).join('\n');
}

function bindings(){return Object.fromEntries(ALL_WORKERS.map(workerId=>[workerId,{workerId,state:WORKERS.includes(workerId)?'READY_UNASSIGNED':'EXTERNAL_TO_CORE',currentWorkOrder:null}]));}
export function readyUnassignedCoreUiSnapshot({observedAt=new Date().toISOString(),revision='core-ui-v3:ready-unassigned',previousJob,reason='NO_CURRENT_UI_ASSIGNMENT'}={}){
  return {source:'CORE',authority:'CORE',observedAt,revision,assignmentState:'READY_UNASSIGNED',previousJob,nextJobs:[],requiredWorkers:[],workerBindings:bindings(),reason};
}
function completion({jobId,workerId,priority,issueRef,closedAt,updatedAt,verifiedAt}){
  const completedAt=String(closedAt||updatedAt||verifiedAt),completionRevision=['core-ui-completion-v1',jobId,completedAt,String(updatedAt||'')].join(':');
  return {jobId,workItemId:'CORE-UI-'+jobId,workerId,status:'DONE',executable:false,priority,issueRef,coreSelected:true,completedAt,completionRevision,evidence:[{source:'GITHUB',ref:issueRef,verifiedAt,jobId,completedAt,completionRevision}]};
}
async function gh(fetchImpl,url,token=''){const headers={accept:'application/vnd.github+json','user-agent':'TigerIQ-Core-UI-Assignment/3.0','x-github-api-version':'2022-11-28'};if(token)headers.authorization='Bearer '+token;const r=await fetchImpl(url,{headers,signal:AbortSignal.timeout(12000)});if(!r.ok)throw new Error('GITHUB_HTTP_'+r.status);return r.json();}
const CORE_UI_OPEN_ISSUE_PAGE_SIZE=100;
const CORE_UI_OPEN_ISSUE_MAX_PAGES=20;
async function readOpenIssues(fetchImpl,owner,repo,token){
  const out=[];
  for(let page=1;page<=CORE_UI_OPEN_ISSUE_MAX_PAGES;page++){
    const rows=await gh(fetchImpl,'https://api.github.com/repos/'+owner+'/'+repo+'/issues?state=open&per_page='+CORE_UI_OPEN_ISSUE_PAGE_SIZE+'&sort=created&direction=asc&page='+page,token);
    if(!Array.isArray(rows))throw new Error('CORE_UI_GITHUB_ISSUES_INVALID');
    out.push(...rows);
    if(rows.length<CORE_UI_OPEN_ISSUE_PAGE_SIZE)return out;
  }
  throw new Error('CORE_UI_GITHUB_ISSUES_PAGE_LIMIT');
}
async function ghWrite(fetchImpl,url,token,method,payload){if(!token)throw new Error('GITHUB_TOKEN_REQUIRED');const headers={accept:'application/vnd.github+json','content-type':'application/json','user-agent':'TigerIQ-Core-UI-Assignment/3.0','x-github-api-version':'2022-11-28',authorization:'Bearer '+token};const r=await fetchImpl(url,{method,headers,body:JSON.stringify(payload),signal:AbortSignal.timeout(12000)});if(!r.ok)throw new Error('GITHUB_WRITE_HTTP_'+r.status);return r.status===204?{}:r.json();}
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

async function latestCoreUiObjective(pool,spec){
  const q=await pool.query("select id,status,metadata,updated_at from tigeriq_objectives where metadata->>'source'='github_ui' and metadata->>'issueNumber'=$1 order by updated_at desc limit 1",[String(spec.number)]);
  return q.rows[0]||null;
}
function sameCoreUiRevision(prior,spec){
  if(!prior)return false;
  const priorScope=String(prior.metadata?.resourceScope||'');
  if(priorScope!==String(spec.resourceScope||''))return false;
  const priorRevision=String(prior.metadata?.sourceRevision||'');
  if(priorRevision)return priorRevision===String(spec.sourceRevision||'');
  const rearmEpoch=coreUiRearmEpoch(spec.body);
  const priorUpdated=Date.parse(String(prior.updated_at||''));
  return !(rearmEpoch>0&&Number.isFinite(priorUpdated)&&rearmEpoch>priorUpdated);
}
function materializedCoreUiIds(spec,prior){
  if(!prior)return {objectiveId:'OBJ-UI-GH-'+spec.number,jobId:'GH-'+spec.number};
  const revision=String(spec.sourceRevision||'').toLowerCase();
  return {objectiveId:'OBJ-UI-GH-'+spec.number+'-R'+revision,jobId:'GH-'+spec.number+'-R'+revision};
}

async function insertObjectiveIfScopeFree(pool,spec,metadata,objectiveId){
  const oid=objectiveId;
  const q=await pool.query(
    "with locked as materialized (select pg_advisory_xact_lock(hashtext($1)) as guard), inserted as ("+
    "insert into tigeriq_objectives(id,objective,priority,status,summary,metadata) "+
    "select $2,$3,$4,'active',$5,$6 from locked "+
    "where not exists (select 1 from tigeriq_objectives where status='active' and metadata->>'resourceScope'=$1) "+
    "on conflict(id) do nothing returning id) select id from inserted",
    [spec.resourceScope,oid,'Core-selected UI Work Order #'+spec.number+' - '+spec.title,spec.priority,'CURRENT_WORK_ORDER=#'+spec.number+' - '+spec.title+'; worker='+spec.workerId,JSON.stringify(metadata)]
  );
  return q.rowCount>0;
}

async function materializeForWorker({pool,fetchImpl,owner,repo,token,workerId,rows}){
  if(await row(pool,{workerId}))return null;
  const specs=(Array.isArray(rows)?rows:[]).map(parseCoreUiIssue).filter(x=>x&&x.workerId===workerId).sort((a,b)=>rank(a.priority)-rank(b.priority)||a.number-b.number);
  for(const spec of specs){
    const prior=await latestCoreUiObjective(pool,spec);
    if(sameCoreUiRevision(prior,spec))continue;
    const ids=materializedCoreUiIds(spec,prior);
    if((await pool.query('select 1 from tigeriq_objectives where id=$1',[ids.objectiveId])).rowCount)continue;
    const exactContext=await loadCoreUiExactHeadContext({fetchImpl,owner,repo,token,spec});
    if(!exactContext.ok)continue;
    const comments=await readComments(fetchImpl,owner,repo,token,spec.number,spec.commentCount);
    if(activeRoleClaim(comments))continue;
    const metadata={source:'github_ui',issueNumber:spec.number,issueUrl:spec.url,capability:spec.capability,resourceScope:spec.resourceScope,executionSurface:'CORE_UI',uiWorkerId:spec.workerId,currentWorkOrder:'#'+spec.number+' - '+spec.title,assignmentAuthority:'CORE',readOnly:spec.readOnly,autonomousCode:spec.autonomousCode,sourcePriority:spec.sourcePriority,legacyP0Autonomous:spec.legacyP0Autonomous,ownerControlled:spec.ownerControlled,sourceRevision:spec.sourceRevision,rearmedFromObjectiveId:prior?.id||null,exactContextRequired:exactContext.required===true,targetRepository:exactContext.targetRepository||spec.targetRepository?.fullName||DEFAULT_TARGET_REPOSITORY,targetPr:exactContext.targetPr||null,targetHead:exactContext.targetHead||null,exactContextFileCount:exactContext.fileCount||0,exactContextTruncated:exactContext.truncated===true};
    if(!await insertObjectiveIfScopeFree(pool,spec,metadata,ids.objectiveId))continue;
    const materializedSpec={...spec,jobId:ids.jobId};
    await pool.query("insert into tigeriq_jobs(id,objective_id,title,prompt,capability,kind,status,employee_id,resource_id,provider,routing_profile,routing_decision,max_attempts) values($1,$2,$3,$4,$5,'ui','ui_assigned',$6,$7,'ui','UI',$8,1) on conflict(id) do nothing",[ids.jobId,ids.objectiveId,'#'+spec.number+' - '+spec.title,buildCoreUiPrompt(materializedSpec,owner+'/'+repo,exactContext.bundle),spec.capability,spec.workerId,resourceId(spec.workerId),JSON.stringify({authority:'CORE',workerId:spec.workerId,capability:spec.capability,resourceScope:spec.resourceScope,sourceRevision:spec.sourceRevision,targetPr:exactContext.targetPr||null,targetHead:exactContext.targetHead||null})]);
    await pool.query("insert into tigeriq_events(type,objective_id,job_id,employee_id,resource_id,task_kind,data) values('CORE_UI_ASSIGNMENT_CREATED',$1,$2,$3,$4,'ui',$5)",[ids.objectiveId,ids.jobId,spec.workerId,resourceId(spec.workerId),JSON.stringify({issueNumber:spec.number,issueUrl:spec.url,resourceScope:spec.resourceScope,capability:spec.capability,priority:spec.priority,sourceRevision:spec.sourceRevision,rearmedFromObjectiveId:prior?.id||null})]);
    return row(pool,{jobId:ids.jobId});
  }
  return null;
}

function publicJob(item,{status='READY',executable=true,prompt}={}){
  const m=item.metadata||{},out={jobId:String(item.job_id),workItemId:'CORE-UI-'+String(item.job_id),workerId:String(item.employee_id||m.uiWorkerId||'NV03'),status,executable,priority:String(item.priority||'P3'),issueRef:String(m.issueUrl||''),coreSelected:true,riskFlags:[],resourceScope:String(m.resourceScope||''),currentWorkOrder:String(m.currentWorkOrder||'')};
  if(prompt!==undefined)out.prompt=String(prompt||'');return out;
}

export async function buildCoreUiAssignmentSnapshot({pool,fetchImpl=fetch,token='',owner=OWNER,repo=REPO,previousJobId}={}){
  if(!pool)throw new Error('CORE_UI_POOL_REQUIRED');
  const observedAt=new Date().toISOString();let previous;
  let prev=previousJobId?await row(pool,{jobId:previousJobId}):null;
  if(prev){
    prev=await reconcile({pool,fetchImpl,owner,repo,token,item:prev,observedAt});
    const m=prev.metadata||{},n=Number(m.issueNumber||issueNo(prev.job_id));let issue=prev.issue;if(!issue&&n)try{issue=await readIssue(fetchImpl,owner,repo,token,n);}catch{}
    if(prev.status==='done'&&issue)previous=completion({jobId:prev.job_id,workerId:prev.employee_id||m.uiWorkerId||'NV03',priority:prev.priority||'P3',issueRef:m.issueUrl||issue.html_url,closedAt:issue.closed_at||prev.completed_at,updatedAt:issue.updated_at,verifiedAt:observedAt});
    else if(prev.status==='cancelled')previous=publicJob(prev,{status:'CANCELLED',executable:false});
    else{previous=publicJob(prev,{status:'RUNNING',executable:true});if(prev.status==='ui_assigned')await pool.query("update tigeriq_jobs set status='ui_running',started_at=coalesce(started_at,now()) where id=$1",[prev.job_id]);}
  }
  const current=[],missingWorkers=[];
  for(const workerId of WORKERS){
    let item=await row(pool,{workerId});
    if(item)item=await reconcile({pool,fetchImpl,owner,repo,token,item,observedAt});
    if(item&&['ui_assigned','ui_running'].includes(String(item.status||'')))current.push(item);
    else missingWorkers.push(workerId);
  }
  if(missingWorkers.length){
    let issues,sourceError;
    try{issues=await readOpenIssues(fetchImpl,owner,repo,token);}
    catch(error){sourceError=error;}
    if(Array.isArray(issues)){
      for(const workerId of missingWorkers){
        const item=await materializeForWorker({pool,fetchImpl,owner,repo,token,workerId,rows:issues});
        if(item&&['ui_assigned','ui_running'].includes(String(item.status||'')))current.push(item);
      }
    }else if(!current.length){
      throw sourceError||new Error('CORE_UI_GITHUB_SOURCE_UNAVAILABLE');
    }
  }
  const b=bindings(),nextJobs=[];
  for(const item of current){
    const wid=String(item.employee_id||item.metadata?.uiWorkerId||'NV03');
    const isPrevious=Boolean(previousJobId&&previousJobId===item.job_id);
    b[wid]={workerId:wid,state:isPrevious?'WORKING':'ASSIGNED',currentWorkOrder:{workItemId:'CORE-UI-'+item.job_id,jobId:item.job_id,issueRef:item.metadata?.issueUrl||null,resourceScope:item.metadata?.resourceScope||null,title:item.metadata?.currentWorkOrder||null}};
    if(!isPrevious&&item.status==='ui_assigned'){const p=(await pool.query('select prompt from tigeriq_jobs where id=$1',[item.job_id])).rows[0]?.prompt;nextJobs.push(publicJob(item,{status:'READY',executable:true,prompt:p}));}
  }
  nextJobs.sort((a,b2)=>rank(a.priority)-rank(b2.priority)||WORKERS.indexOf(a.workerId)-WORKERS.indexOf(b2.workerId));
  const nextJob=nextJobs[0];
  const requiredWorkers=current.map(x=>String(x.employee_id||x.metadata?.uiWorkerId||'NV03'));
  const assignmentState=nextJobs.length?'READY_ASSIGNED':current.length?'WORKING':'READY_UNASSIGNED';
  const revision=['core-ui-v3',previous?.jobId||'none',previous?.status||'none',...current.map(x=>x.job_id+':'+x.status)].join(':');
  if(!current.length&&!previous)return readyUnassignedCoreUiSnapshot({observedAt,revision});
  return{source:'CORE',authority:'CORE',observedAt,revision,assignmentState,previousJob:previous,nextJob,nextJobs,requiredWorkers,workerBindings:b};
}


export async function completeCoreUiAssignment({pool,fetchImpl=fetch,token='',owner=OWNER,repo=REPO,jobId,workerId,terminal,result=''}={}){
  if(!pool)throw new Error('CORE_UI_POOL_REQUIRED');
  if(typeof pool.connect!=='function')throw new Error('CORE_UI_POOL_CONNECT_REQUIRED');
  if(!WORKERS.includes(String(workerId||'')))throw new Error('CORE_UI_WORKER_INVALID');
  const n=issueNo(jobId);if(!n)throw new Error('CORE_UI_JOB_ID_INVALID');
  const requestedState=String(terminal||'').toUpperCase();
  if(!['DONE','BLOCKED','EXTERNAL_WAIT'].includes(requestedState))throw new Error('CORE_UI_TERMINAL_INVALID');
  const terminalResult=safeResult(result||requestedState);
  const terminalKey='TIGERIQ_CORE_UI_TERMINAL_KEY='+jobId;
  const client=await pool.connect();
  try{
    await client.query('begin');
    await client.query('select pg_advisory_xact_lock(hashtext($1))',[terminalKey]);
    const item=await row(client,{jobId});
    if(!item)throw new Error('CORE_UI_JOB_NOT_FOUND');
    if(String(item.employee_id)!==String(workerId))throw new Error('CORE_UI_JOB_WORKER_MISMATCH');
    if(!['ui_assigned','ui_running'].includes(String(item.status||''))){
      await client.query('commit');
      return {ok:true,alreadyTerminal:true,jobId,workerId,terminal:String(item?.result?.terminal||requestedState),evidenceRef:String(item?.result?.evidenceRef||item?.metadata?.issueUrl||''),issueRef:String(item?.metadata?.issueUrl||'')};
    }

    const issue=await readIssue(fetchImpl,owner,repo,token,n);
    const comments=await gh(fetchImpl,'https://api.github.com/repos/'+owner+'/'+repo+'/issues/'+n+'/comments?per_page=100',token).catch(()=>[]);
    const prior=(Array.isArray(comments)?comments:[]).find((comment)=>String(comment?.body||'').includes(terminalKey));
    const priorText=String(prior?.body||'');
    const priorState=coreUiTerminalStateFromComment(priorText);
    const state=priorState||requestedState;
    const evidenceBody=formatCoreUiTerminalComment({jobId,workerId,state,result:terminalResult});
    const comment=prior||await ghWrite(fetchImpl,'https://api.github.com/repos/'+owner+'/'+repo+'/issues/'+n+'/comments',token,'POST',{body:evidenceBody});
    if(state==='DONE'&&issue.state!=='closed')await ghWrite(fetchImpl,'https://api.github.com/repos/'+owner+'/'+repo+'/issues/'+n,token,'PATCH',{state:'closed',state_reason:'completed'});
    const jobStatus=state==='DONE'?'done':'failed';
    const objectiveStatus=state==='DONE'?'completed':'blocked';
    const evidenceRef=String(comment?.html_url||issue.html_url||'');
    await client.query("update tigeriq_jobs set status=$2,lease_until=null,completed_at=coalesce(completed_at,now()),result=coalesce(result,'{}'::jsonb)||$3::jsonb where id=$1 and status in ('ui_assigned','ui_running')",[jobId,jobStatus,JSON.stringify({source:'app_chrome_ui',terminal:state,evidenceRef,result:terminalResult,terminalKey})]);
    await client.query("update tigeriq_objectives set status=$2,summary=$3,updated_at=now() where id=$1 and status='active'",[item.objective_id,objectiveStatus,'Core UI terminal '+state+' from '+workerId]);
    await client.query("insert into tigeriq_events(type,objective_id,job_id,employee_id,resource_id,task_kind,data) values('CORE_UI_ASSIGNMENT_TERMINAL',$1,$2,$3,$4,'ui',$5)",[item.objective_id,jobId,workerId,item.resource_id,JSON.stringify({terminal:state,evidenceRef,issueNumber:n,terminalKey,recoveredExistingEvidence:Boolean(prior)})]);
    await client.query('commit');
    return {ok:true,jobId,workerId,terminal:state,evidenceRef,issueRef:String(issue.html_url||''),recoveredExistingEvidence:Boolean(prior)};
  }catch(error){
    try{await client.query('rollback')}catch{}
    throw error;
  }finally{
    client.release();
  }
}
