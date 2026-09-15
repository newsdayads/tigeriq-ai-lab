import { createServer } from 'node:http';

const DEFAULT_OWNER='newsdayads';
const DEFAULT_REPO='tigeriq-ai-lab';
const DEFAULT_CONTROLLER_STATE_URL='http://127.0.0.1:8798/api/autopilot/state';
const REQUIRED_TRUE_FLAGS=[
  'TIGERIQ_EXECUTABLE','NO_DIRECT_MAIN','NO_PAID_COST','NO_CREDENTIAL_CHANGE','NO_DESTRUCTIVE','NO_PRODUCTION_RELEASE',
];

function exactValue(body,key){
  const escaped=key.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  return String(body||'').match(new RegExp(`^${escaped}=([^\\r\\n]+)$`,'m'))?.[1]?.trim();
}
function exactTrue(body,key){return exactValue(body,key)==='true';}
function cleanTitle(value){return String(value||'').replace(/[\r\n\t]+/g,' ').replace(/\s+/g,' ').trim().slice(0,180);}
function priorityRank(value){return value==='P0'?0:value==='P1'?1:9;}
function isLoopbackUrl(value){
  try{const u=new URL(value);return u.protocol==='http:'&&['127.0.0.1','localhost','::1'].includes(u.hostname);}catch{return false;}
}

export function parseAutoUiIssue(issue,{allowClosed=false}={}){
  if(!issue||issue.pull_request)return null;
  if(!allowClosed&&issue.state!=='open')return null;
  const body=String(issue.body||'');
  if(REQUIRED_TRUE_FLAGS.some(key=>!exactTrue(body,key)))return null;
  if(exactValue(body,'OWNER_POLICY')!=='AUTO_UI')return null;
  if(exactValue(body,'PRIMARY_EMPLOYEE')!=='NV02')return null;
  const priority=exactValue(body,'PRIORITY');
  if(!['P0','P1'].includes(priority))return null;
  const number=Number(issue.number);
  if(!Number.isInteger(number)||number<=0)return null;
  return{number,jobId:`GH-${number}`,title:cleanTitle(issue.title),priority,url:String(issue.html_url||''),updatedAt:String(issue.updated_at||'')};
}

export function buildPrompt(spec,repoFullName=`${DEFAULT_OWNER}/${DEFAULT_REPO}`){
  return `LÀM — NO YAPPING. Nhận việc #${spec.number} - ${spec.title}. Đọc đầy đủ issue #${spec.number} trong repo ${repoFullName} và thực hiện end-to-end đúng scope. Tuân thủ toàn bộ guardrail trong issue; không MAIN/Production, không chi phí, không đổi credential, không destructive. Cập nhật GitHub bằng bằng chứng kiểm chứng được; chỉ dừng DONE có evidence hoặc BLOCKER thật.`;
}

function jobFromIssue(issue,spec){
  const completed=issue.state==='closed'&&issue.state_reason==='completed';
  const cancelled=issue.state==='closed'&&!completed;
  const status=completed?'DONE':cancelled?'CANCELLED':'RUNNING';
  const job={jobId:spec.jobId,workerId:'NV02',status,executable:true,priority:spec.priority};
  if(completed){job.evidence=[{source:'GITHUB',ref:spec.url,verifiedAt:String(issue.closed_at||issue.updated_at||new Date().toISOString())}];}
  return job;
}

async function ghJson(fetchImpl,url,token){
  const headers={accept:'application/vnd.github+json','user-agent':'TigerIQ-UI-Autopilot/1.1','x-github-api-version':'2022-11-28'};
  if(token)headers.authorization=`Bearer ${token}`;
  const response=await fetchImpl(url,{headers,signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw new Error(`GITHUB_HTTP_${response.status}`);
  return response.json();
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
    previousJob=jobFromIssue(issue,spec);
  }
  const rows=await ghJson(fetchImpl,`https://api.github.com/repos/${owner}/${repo}/issues?state=open&per_page=100&sort=created&direction=asc`,token);
  const eligible=(Array.isArray(rows)?rows:[])
    .map(issue=>({issue,spec:parseAutoUiIssue(issue)}))
    .filter(x=>x.spec&&x.spec.number!==previousNumber)
    .sort((a,b)=>priorityRank(a.spec.priority)-priorityRank(b.spec.priority)||a.spec.number-b.spec.number);
  const chosen=eligible[0];
  const nextJob=chosen?{jobId:chosen.spec.jobId,workerId:'NV02',status:'READY',executable:true,priority:chosen.spec.priority,prompt:buildPrompt(chosen.spec,`${owner}/${repo}`),riskFlags:[]}:undefined;
  const revision=['github-ui-v1',previousJob?.jobId||'none',previousJob?.status||'none',chosen?.spec.jobId||'none',chosen?.spec.updatedAt||'none'].join(':');
  return{source:'GITHUB',observedAt,revision,previousJob,nextJob,requiredWorkers:[]};
}

export function startUiAutopilotSnapshotServer({
  token=process.env.TIGERIQ_GITHUB_TOKEN||process.env.GITHUB_TOKEN||'',owner=process.env.TIGERIQ_GITHUB_OWNER||DEFAULT_OWNER,repo=process.env.TIGERIQ_GITHUB_REPO||DEFAULT_REPO,
  host='127.0.0.1',port=Number(process.env.TIGERIQ_UI_AUTOPILOT_PORT||8794),fetchImpl=fetch,controllerStateUrl=process.env.TIGERIQ_CHROME_CONTROLLER_STATE_URL||DEFAULT_CONTROLLER_STATE_URL,
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
        const snapshot=await buildUiAutopilotSnapshot({fetchImpl,token,owner,repo,previousJobId});
        res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});return res.end(JSON.stringify(snapshot));
      }
      res.writeHead(404,{'content-type':'application/json'});res.end(JSON.stringify({ok:false,error:'NOT_FOUND'}));
    }catch(error){
      const message=String(error?.message||error);
      res.writeHead(502,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify({ok:false,error:message}));
    }
  });
  server.listen(port,host,()=>console.log(JSON.stringify({event:'UI_AUTOPILOT_SNAPSHOT_READY',host,port,authenticatedGithub:Boolean(token)})));return{enabled:true,host,port,stop:()=>new Promise(resolve=>server.close(()=>resolve()))};
}
