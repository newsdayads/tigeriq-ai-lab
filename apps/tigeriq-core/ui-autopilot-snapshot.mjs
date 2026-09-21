import { createServer } from 'node:http';

const DEFAULT_OWNER='newsdayads';
const DEFAULT_REPO='tigeriq-ai-lab';
const DEFAULT_CONTROLLER_STATE_URL='http://127.0.0.1:8798/api/autopilot/state';
const DEFAULT_SAVE_LEDGER_ISSUE=788;
const SUPPORTED_WORKERS=new Set(['NV02','NV03','NV04']);
const REQUIRED_TRUE_FLAGS=[
  'TIGERIQ_EXECUTABLE','NO_DIRECT_MAIN','NO_PAID_COST','NO_CREDENTIAL_CHANGE','NO_DESTRUCTIVE','NO_PRODUCTION_RELEASE',
];
const REQUIRED_SAVE_FIELDS=[
  'TIGERIQ_SAVE_DISPATCHED_AT','TIGERIQ_SAVE_STATE','TIGERIQ_SAVE_FOCUS','TIGERIQ_SAVE_DECISIONS','TIGERIQ_SAVE_DONE',
  'TIGERIQ_SAVE_PENDING','TIGERIQ_SAVE_BLOCKERS','TIGERIQ_SAVE_NEXT','TIGERIQ_SAVE_EVIDENCE',
];

function exactValue(body,key){
  const escaped=key.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  return String(body||'').match(new RegExp(`^${escaped}=([^\\r\\n]+)$`,'m'))?.[1]?.trim();
}
function exactTrue(body,key){return exactValue(body,key)==='true';}
function meaningfulValue(value){const text=String(value||'').trim();return Boolean(text)&&!/^<.*>$/.test(text);}
function cleanTitle(value){return String(value||'').replace(/[\r\n\t]+/g,' ').replace(/\s+/g,' ').trim().slice(0,180);}
function priorityRank(value){return value==='P0'?0:value==='P1'?1:9;}
function isLoopbackUrl(value){
  try{const u=new URL(value);return u.protocol==='http:'&&['127.0.0.1','localhost','::1'].includes(u.hostname);}catch{return false;}
}

export function parseAutoUiIssue(issue,{allowClosed=false}={}){
  if(!issue||issue.pull_request)return null;
  const closed=issue.state==='closed';
  if(!allowClosed&&issue.state!=='open')return null;
  const body=String(issue.body||'');
  const workerId=exactValue(body,'PRIMARY_EMPLOYEE');
  if(!SUPPORTED_WORKERS.has(workerId))return null;
  const priority=exactValue(body,'PRIORITY');
  if(!['P0','P1'].includes(priority))return null;
  const number=Number(issue.number);
  if(!Number.isInteger(number)||number<=0)return null;
  // Historical correlation must survive later owner holds/supersession metadata changes.
  // Closed work is never executable here; only its durable identity/evidence is projected.
  if(!(allowClosed&&closed)){
    if(REQUIRED_TRUE_FLAGS.some(key=>!exactTrue(body,key)))return null;
    if(exactValue(body,'OWNER_POLICY')!=='AUTO_UI')return null;
  }
  return{number,jobId:`GH-${number}`,workerId,title:cleanTitle(issue.title),priority,url:String(issue.html_url||''),updatedAt:String(issue.updated_at||'')};
}

export function buildPrompt(spec,repoFullName=`${DEFAULT_OWNER}/${DEFAULT_REPO}`){
  return `LÀM — NO YAPPING. Nhận việc #${spec.number} - ${spec.title}. Đọc đầy đủ issue #${spec.number} trong repo ${repoFullName} và thực hiện end-to-end đúng scope. Tuân thủ toàn bộ guardrail trong issue; không MAIN/Production, không chi phí, không đổi credential, không destructive. Cập nhật GitHub bằng bằng chứng kiểm chứng được; chỉ dừng DONE có evidence hoặc BLOCKER thật.`;
}

function jobFromIssue(issue,spec,verifiedAt){
  const completed=issue.state==='closed'&&issue.state_reason==='completed';
  const cancelled=issue.state==='closed'&&!completed;
  const status=completed?'DONE':cancelled?'CANCELLED':'RUNNING';
  const job={jobId:spec.jobId,workerId:spec.workerId,status,executable:!completed&&!cancelled,priority:spec.priority,issueRef:spec.url};
  if(completed){
    const completedAt=String(issue.closed_at||issue.updated_at||'');
    const completionRevision=['github-issue-closure-v2',spec.jobId,completedAt,String(issue.updated_at||'')].join(':');
    job.completedAt=completedAt;job.completionRevision=completionRevision;
    job.evidence=[{source:'GITHUB',ref:spec.url,verifiedAt,jobId:spec.jobId,completedAt,completionRevision}];
  }
  return job;
}

async function ghJson(fetchImpl,url,token){
  const headers={accept:'application/vnd.github+json','user-agent':'TigerIQ-UI-Autopilot/1.2','x-github-api-version':'2022-11-28'};
  if(token)headers.authorization=`Bearer ${token}`;
  const response=await fetchImpl(url,{headers,signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw new Error(`GITHUB_HTTP_${response.status}`);
  return response.json();
}

export function findDurableSaveReceipt(comments,{saveToken,workerId,after}){
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(saveToken||'')))throw new Error('SAVE_TOKEN_INVALID');
  if(!['NV02','NV03'].includes(String(workerId||'')))throw new Error('SAVE_WORKER_INVALID');
  const afterText=String(after||'');
  const afterMs=Date.parse(afterText);
  if(!Number.isFinite(afterMs))throw new Error('SAVE_AFTER_INVALID');
  for(const comment of Array.isArray(comments)?[...comments].reverse():[]){
    const createdAt=String(comment?.created_at||'');
    const createdMs=Date.parse(createdAt);
    if(!Number.isFinite(createdMs)||createdMs<afterMs)continue;
    const text=String(comment?.body||'');
    if(!text.includes('TIGERIQ_SAVE_RECEIPT_V1'))continue;
    if(exactValue(text,'TIGERIQ_SAVE_TOKEN')!==saveToken)continue;
    if(exactValue(text,'TIGERIQ_SAVE_WORKER')!==workerId)continue;
    if(exactValue(text,'TIGERIQ_SAVE_STATUS')!=='DURABLE')continue;
    if(exactValue(text,'TIGERIQ_SAVE_DISPATCHED_AT')!==afterText)continue;
    const checkpointRef=exactValue(text,'TIGERIQ_SAVE_REF');
    if(!meaningfulValue(checkpointRef)||!String(checkpointRef).startsWith(`https://github.com/${DEFAULT_OWNER}/${DEFAULT_REPO}/`))continue;
    if(REQUIRED_SAVE_FIELDS.some((key)=>!meaningfulValue(exactValue(text,key))))continue;
    return{ok:true,status:'DURABLE',receiptRef:String(comment?.html_url||''),checkpointRef,verifiedAt:createdAt};
  }
  return{ok:false,status:'SAVE_NOT_DURABLE'};
}

export async function readDurableSaveReceipt({fetchImpl=fetch,token='',owner=DEFAULT_OWNER,repo=DEFAULT_REPO,ledgerIssue=DEFAULT_SAVE_LEDGER_ISSUE,saveToken,workerId,after}={}){
  const issue=await ghJson(fetchImpl,`https://api.github.com/repos/${owner}/${repo}/issues/${ledgerIssue}`,token);
  const page=Math.max(1,Math.ceil(Number(issue?.comments||0)/100));
  const comments=await ghJson(fetchImpl,`https://api.github.com/repos/${owner}/${repo}/issues/${ledgerIssue}/comments?per_page=100&page=${page}`,token);
  return findDurableSaveReceipt(comments,{saveToken,workerId,after});
}

export async function readPreviousJobIdFromController({fetchImpl=fetch,stateUrl=DEFAULT_CONTROLLER_STATE_URL}={}){
  if(!isLoopbackUrl(stateUrl))throw new Error('CONTROLLER_STATE_URL_MUST_BE_LOOPBACK');
  let response;
  try{response=await fetchImpl(stateUrl,{signal:AbortSignal.timeout(2500)});}catch{throw new Error('CONTROLLER_STATE_UNAVAILABLE');}
  if(!response.ok)throw new Error(`CONTROLLER_STATE_HTTP_${response.status}`);
  const value=await response.json();
  const id=String(value?.state?.lastDispatchedJobId||'');
  return /^GH-\d+$/.test(id)?id:undefined;
}

export async function buildUiAutopilotSnapshot({fetchImpl=fetch,token='',owner=DEFAULT_OWNER,repo=DEFAULT_REPO,previousJobId}={}){
  const observedAt=new Date().toISOString();
  let previousJob;
  let previousNumber;
  const match=String(previousJobId||'').match(/^GH-(\d+)$/);
  if(previousJobId&&!match)throw new Error('PREVIOUS_JOB_ID_INVALID');
  if(match){
    previousNumber=Number(match[1]);
    const issue=await ghJson(fetchImpl,`https://api.github.com/repos/${owner}/${repo}/issues/${previousNumber}`,token);
    const spec=parseAutoUiIssue(issue,{allowClosed:true});
    if(!spec)throw new Error('PREVIOUS_JOB_NOT_AUTHORIZED_AUTO_UI');
    previousJob=jobFromIssue(issue,spec,observedAt);
  }
  const rows=await ghJson(fetchImpl,`https://api.github.com/repos/${owner}/${repo}/issues?state=open&per_page=100&sort=created&direction=asc`,token);
  const eligible=(Array.isArray(rows)?rows:[])
    .map(issue=>({issue,spec:parseAutoUiIssue(issue)}))
    .filter(x=>x.spec&&x.spec.number!==previousNumber)
    .sort((a,b)=>priorityRank(a.spec.priority)-priorityRank(b.spec.priority)||a.spec.number-b.spec.number);
  const chosen=eligible[0];
  const nextJob=chosen?{jobId:chosen.spec.jobId,workerId:chosen.spec.workerId,status:'READY',executable:true,priority:chosen.spec.priority,prompt:buildPrompt(chosen.spec,`${owner}/${repo}`),riskFlags:[],issueRef:chosen.spec.url,coreSelected:true,workItemGroup:'CORE-SELECTED-WORKITEM'}:undefined;
  const revision=['github-ui-v3',previousJob?.jobId||'none',previousJob?.status||'none',chosen?.spec.jobId||'none',chosen?.spec.workerId||'none',chosen?.spec.updatedAt||'none'].join(':');
  return{source:'GITHUB',observedAt,revision,previousJob,nextJob,requiredWorkers:nextJob?[nextJob.workerId]:[]};
}

export function projectCoreOwnedUiSnapshot(snapshot){
  if(!snapshot||typeof snapshot!=='object')throw new Error('CORE_UI_SNAPSHOT_INVALID');
  const mapJob=job=>job?{...job,coreSelected:true,workItemId:job.workItemId||job.jobId,issueRef:job.issueRef||(/^(?:GH-)(\\d+)$/.test(String(job.jobId||''))?`https://github.com/${DEFAULT_OWNER}/${DEFAULT_REPO}/issues/${String(job.jobId).slice(3)}`:undefined)}:undefined;
  return{
    ...snapshot,
    source:'CORE',
    revision:`core-ui-v1:${String(snapshot.revision||'')}`,
    previousJob:mapJob(snapshot.previousJob),
    nextJob:mapJob(snapshot.nextJob),
  };
}

function isAllowedCoreAssignmentUrl(value){
  try{
    const u=new URL(value);
    if(u.protocol!=='http:')return false;
    const h=u.hostname;
    if(['127.0.0.1','localhost','::1'].includes(h))return true;
    const m=h.match(/^100\.(\d{1,3})\./);
    return Boolean(m&&Number(m[1])>=64&&Number(m[1])<=127);
  }catch{return false;}
}

export async function readCoreUiAssignment({fetchImpl=fetch,coreAssignmentUrl,previousJobId}={}){
  if(!coreAssignmentUrl||!isAllowedCoreAssignmentUrl(coreAssignmentUrl))throw new Error('CORE_UI_ASSIGNMENT_URL_INVALID');
  const u=new URL(coreAssignmentUrl);
  if(previousJobId)u.searchParams.set('previousJobId',String(previousJobId));
  let response;
  try{response=await fetchImpl(u.toString(),{signal:AbortSignal.timeout(5000)});}catch{throw new Error('CORE_UI_ASSIGNMENT_UNAVAILABLE');}
  if(!response.ok)throw new Error(`CORE_UI_ASSIGNMENT_HTTP_${response.status}`);
  const snapshot=await response.json();
  if(snapshot?.source!=='CORE'||!snapshot?.revision||!snapshot?.observedAt)throw new Error('CORE_UI_ASSIGNMENT_INVALID');
  return snapshot;
}

export function startUiAutopilotSnapshotServer({
  token=process.env.TIGERIQ_GITHUB_TOKEN||process.env.GITHUB_TOKEN||'',owner=process.env.TIGERIQ_GITHUB_OWNER||DEFAULT_OWNER,repo=process.env.TIGERIQ_GITHUB_REPO||DEFAULT_REPO,
  host='127.0.0.1',port=Number(process.env.TIGERIQ_UI_AUTOPILOT_PORT||8794),fetchImpl=fetch,controllerStateUrl=process.env.TIGERIQ_CHROME_CONTROLLER_STATE_URL||DEFAULT_CONTROLLER_STATE_URL,
  coreAssignmentUrl=process.env.TIGERIQ_CORE_UI_ASSIGNMENT_URL||'http://127.0.0.1:8795/api/ui-assignment',
  saveLedgerIssue=Number(process.env.TIGERIQ_SAVE_LEDGER_ISSUE||DEFAULT_SAVE_LEDGER_ISSUE),
}={}){
  if(host!=='127.0.0.1')throw new Error('UI_AUTOPILOT_HOST_MUST_BE_LOOPBACK');
  if(!isLoopbackUrl(controllerStateUrl))throw new Error('CONTROLLER_STATE_URL_MUST_BE_LOOPBACK');
  const server=createServer(async(req,res)=>{
    const url=new URL(req.url||'/','http://127.0.0.1');
    try{
      if(req.method==='GET'&&url.pathname==='/health'){
        res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});return res.end(JSON.stringify({ok:true,service:'ui-autopilot-snapshot'}));
      }
      if(req.method==='GET'&&url.pathname==='/api/ui-autopilot/snapshot'){
        const explicit=url.searchParams.get('previousJobId')||undefined;
        const previousJobId=explicit||await readPreviousJobIdFromController({fetchImpl,stateUrl:controllerStateUrl});
        const snapshot=await readCoreUiAssignment({fetchImpl,coreAssignmentUrl,previousJobId});
        res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});return res.end(JSON.stringify(snapshot));
      }
      if(req.method==='GET'&&url.pathname==='/api/ui-autopilot/save-receipt'){
        const result=await readDurableSaveReceipt({
          fetchImpl,token,owner,repo,ledgerIssue:saveLedgerIssue,
          saveToken:url.searchParams.get('token')||'',workerId:url.searchParams.get('workerId')||'',after:url.searchParams.get('after')||'',
        });
        res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});return res.end(JSON.stringify(result));
      }
      res.writeHead(404,{'content-type':'application/json'});res.end(JSON.stringify({ok:false,error:'NOT_FOUND'}));
    }catch(error){
      const message=String(error?.message||error);
      res.writeHead(502,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify({ok:false,error:message}));
    }
  });
  server.listen(port,host,()=>console.log(JSON.stringify({event:'UI_AUTOPILOT_SNAPSHOT_READY',host,port,authenticatedGithub:Boolean(token),saveLedgerIssue})));return{enabled:true,host,port,stop:()=>new Promise(resolve=>server.close(()=>resolve()))};
}