import http from 'node:http';
import {createPublicKey,verify as verifySignature} from 'node:crypto';

const PORT=8801;
const CORE='http://100.97.23.87:8795/api/status';
const CODING='http://100.97.23.87:8797/api/status';
const UI_HEALTH='http://127.0.0.1:8794/health';
const UI_CONTROLLER='http://127.0.0.1:8798/api/state';
const UI_HEARTBEAT_STALE_MS=15000;
const CORE_EVENT='http://100.97.23.87:8795/api/github-event';
const REPO='newsdayads/tigeriq-ai-lab';
const OIDC_ISSUER='https://token.actions.githubusercontent.com';
const OIDC_AUDIENCE='tigeriq-core-github-event-v1';
const OIDC_JWKS_URL='https://token.actions.githubusercontent.com/.well-known/jwks';
let jwksCache={at:0,keys:[]};
const labels={
  NV02:'ChatGPT Plus',NV03:'ChatGPT Go',NV04:'Gemini Pro',
  NV10:'Ollama',NV11:'Groq',NV12:'Gemini',NV13:'OpenRouter',NV14:'Mistral',
  NV15:'Cloudflare Workers AI',NV16:'Hugging Face',NV17:'Inception / Mercury 2.5',
  NV18:'IBM watsonx.ai Lite',NV19:'Cohere',NV20:'NVIDIA NIM'
};

async function getJson(url,timeout=3500){
  const c=new AbortController(); const t=setTimeout(()=>c.abort(),timeout);
  try{const r=await fetch(url,{signal:c.signal,headers:{accept:'application/json'},cache:'no-store'});if(!r.ok)throw new Error('HTTP_'+r.status);return await r.json();}
  finally{clearTimeout(t)}
}
async function health(url){
  const c=new AbortController(); const t=setTimeout(()=>c.abort(),1200);
  try{const r=await fetch(url,{signal:c.signal});return r.ok}catch{return false}finally{clearTimeout(t)}
}
function isActiveStatus(s){return ['running','working','active','assigned','in_progress','queued','reviewing'].includes(String(s||'').toLowerCase())}
function normResource(r,activeJob){
  const now=Date.now();
  const cooldown=r?.cooldown_until?Date.parse(r.cooldown_until):0;
  const raw=String(r?.work_state||r?.status||r?.health_state||'UNKNOWN').toUpperCase();
  let state='idle',status='RẢNH';
  if(activeJob||r?.current_job_id||['WORKING','RUNNING','BUSY','ACTIVE'].includes(raw)){state='working';status='ĐANG LÀM'}
  else if(raw==='RATE_LIMITED'||cooldown>now){state='waiting';status='CHỜ'}
  else if(['ERROR','OFFLINE','BLOCKED','DISABLED'].includes(raw)||['ERROR','OFFLINE'].includes(String(r?.health_state||'').toUpperCase())){state='blocked';status='BỊ CHẶN'}
  else if(['READY','ONLINE','IDLE'].includes(raw)){state='idle';status='RẢNH'}
  else{state='unknown';status='CHƯA RÕ'}
  const job=activeJob?.title||activeJob?.instruction||r?.current_job_id||(
    state==='waiting'?(r?.last_error==='rate_limit'?'Đang chờ giới hạn API':'Đang chờ tài nguyên'):
    state==='blocked'?(r?.last_error?('Lỗi: '+r.last_error):'Runtime không sẵn sàng'):
    'Không có việc đang chạy'
  );
  return {
    employeeId:r.employee_id,label:labels[r.employee_id]||r.name||r.employee_id,kind:'api',
    state,status,job:String(job||'').slice(0,220),
    detail:activeJob?.pr_number?('PR #'+activeJob.pr_number+' · '+String(activeJob.status||'').toUpperCase()):((r?.provider||r?.name||'')+(r?.model?' · '+r.model:'')),
    updatedAt:activeJob?.started_at||activeJob?.updated_at||r?.updated_at||r?.last_seen_at||null,
    heartbeatAt:r?.last_seen_at||r?.updated_at||null,currentJobId:activeJob?.id||r?.current_job_id||null,
    prNumber:activeJob?.pr_number||null,provider:r?.provider||null,model:r?.model||null,
    cooldownUntil:r?.cooldown_until||null,lastError:r?.last_error||null,source:'PC01 Core/Coding Lane'
  };
}
function latestUiJob(controller,id){
  const terminal=new Set(['DONE','ERROR','BLOCKED','CANCELLED','SUPERSEDED']);
  return (Array.isArray(controller?.jobs)?controller.jobs:[])
    .filter(j=>j?.workerId===id&&!terminal.has(String(j?.stage||'').toUpperCase()))
    .sort((a,b)=>(Date.parse(b?.lastActivityAt||b?.startedAt||b?.createdAt||0)||0)-(Date.parse(a?.lastActivityAt||a?.startedAt||a?.createdAt||0)||0))[0]||null;
}
function uiWorker(id,controller,serviceOk){
  const w=(Array.isArray(controller?.workers)?controller.workers:[]).find(x=>x?.id===id)||null;
  const hb=w?.lastHeartbeat||null;
  const heartbeatAt=typeof hb?.at==='string'?hb.at:null;
  const heartbeatMs=Date.parse(heartbeatAt||'')||0;
  const fresh=heartbeatMs>0&&(Date.now()-heartbeatMs)<=UI_HEARTBEAT_STALE_MS;
  const phase=String(hb?.uiPhase||w?.status||'').toUpperCase();
  const paused=controller?.paused===true||(Array.isArray(controller?.utilityPausedWorkers)&&controller.utilityPausedWorkers.includes(id))||String(w?.status||'').toUpperCase()==='PAUSED';
  const blocked=Boolean(w?.blocked||hb?.securityBlock||phase==='BLOCKED');
  const activeJob=latestUiJob(controller,id);
  let state='unknown',status='CHƯA XÁC MINH';
  if(fresh){
    if(paused){state='paused';status='TẠM NGƯNG'}
    else if(blocked){state='blocked';status='BỊ CHẶN'}
    else if(hb?.uiBusy===true||phase==='WORKING'){state='working';status='ĐANG LÀM'}
    else if(phase==='STALLED'){state='waiting';status='CHỜ'}
    else if(phase==='READY'||hb?.uiReady===true||String(w?.status||'').toUpperCase()==='READY'){state='idle';status='RẢNH'}
  }
  let job=activeJob?.title||activeJob?.jobId||null;
  if(!job&&state==='working'&&controller?.autopilot?.lastDispatchedWorkerId===id)job=controller?.autopilot?.lastDispatchedJobId||null;
  if(!job)job=state==='working'?'Đang xử lý trong chat hiện tại':state==='waiting'?'Đang chờ/khôi phục giao diện':state==='blocked'?(w?.lastError||hb?.securityBlock||'Giao diện bị chặn'):state==='paused'?'Đang tạm ngưng':'Không có việc đang chạy';
  const meta=[phase||null,hb?.modelName||null,hb?.reasoningEffort||null].filter(Boolean).join(' · ');
  return {
    employeeId:id,label:labels[id],kind:'ui',state,status,job:String(job).slice(0,220),
    detail:fresh?(meta||'Heartbeat giao diện hợp lệ'):(serviceOk?'Heartbeat riêng đã cũ hoặc chưa có':'UI controller không online'),
    updatedAt:heartbeatAt||w?.windowEventAt||new Date().toISOString(),heartbeatAt,
    currentJobId:activeJob?.jobId||((state==='working'&&controller?.autopilot?.lastDispatchedWorkerId===id)?controller?.autopilot?.lastDispatchedJobId:null),
    prNumber:null,provider:null,model:hb?.modelName||null,cooldownUntil:null,lastError:w?.lastError||hb?.securityBlock||null,
    source:'PC01 Chrome Controller'
  };
}

function decodeJwtPart(value){
  return JSON.parse(Buffer.from(String(value||''),'base64url').toString('utf8'));
}
async function githubOidcKeys(){
  const now=Date.now();
  if(jwksCache.keys.length&&now-jwksCache.at<60*60*1000)return jwksCache.keys;
  const r=await fetch(OIDC_JWKS_URL,{headers:{accept:'application/json'},signal:AbortSignal.timeout(5000),cache:'no-store'});
  if(!r.ok)throw new Error('OIDC_JWKS_HTTP_'+r.status);
  const body=await r.json();
  const keys=Array.isArray(body?.keys)?body.keys:[];
  if(!keys.length)throw new Error('OIDC_JWKS_EMPTY');
  jwksCache={at:now,keys};
  return keys;
}
async function verifyGithubOidc(token){
  const parts=String(token||'').split('.');
  if(parts.length!==3)throw new Error('OIDC_FORMAT_INVALID');
  const header=decodeJwtPart(parts[0]);
  const payload=decodeJwtPart(parts[1]);
  if(header?.alg!=='RS256'||!header?.kid)throw new Error('OIDC_HEADER_INVALID');
  const jwk=(await githubOidcKeys()).find((key)=>key?.kid===header.kid);
  if(!jwk)throw new Error('OIDC_KID_UNKNOWN');
  const key=createPublicKey({key:jwk,format:'jwk'});
  const ok=verifySignature('RSA-SHA256',Buffer.from(parts[0]+'.'+parts[1]),key,Buffer.from(parts[2],'base64url'));
  if(!ok)throw new Error('OIDC_SIGNATURE_INVALID');
  const now=Math.floor(Date.now()/1000);
  if(payload?.iss!==OIDC_ISSUER)throw new Error('OIDC_ISSUER_INVALID');
  const aud=Array.isArray(payload?.aud)?payload.aud:[payload?.aud];
  if(!aud.includes(OIDC_AUDIENCE))throw new Error('OIDC_AUDIENCE_INVALID');
  if(!Number.isFinite(Number(payload?.exp))||Number(payload.exp)<now-30)throw new Error('OIDC_EXPIRED');
  if(Number.isFinite(Number(payload?.nbf))&&Number(payload.nbf)>now+30)throw new Error('OIDC_NOT_YET_VALID');
  if(payload?.repository!==REPO)throw new Error('OIDC_REPOSITORY_INVALID');
  const workflowRef=String(payload?.workflow_ref||'');
  if(!workflowRef.includes(REPO+'/.github/workflows/tigeriq-github-event.yml@'))throw new Error('OIDC_WORKFLOW_INVALID');
  return payload;
}
async function readJsonBody(req){
  let raw='';
  for await(const chunk of req){
    raw+=chunk;
    if(raw.length>65536)throw new Error('BODY_TOO_LARGE');
  }
  return raw?JSON.parse(raw):{};
}
async function relayGithubEvent(req,res){
  const auth=String(req.headers.authorization||'');
  const token=auth.replace(/^Bearer\s+/i,'').trim();
  if(!token){res.writeHead(401);return res.end('missing_oidc')}
  try{
    await verifyGithubOidc(token);
    const body=await readJsonBody(req);
    if(body?.repository!==REPO)throw new Error('EVENT_REPOSITORY_INVALID');
    const payload={
      deliveryId:String(body?.deliveryId||'').slice(0,160),
      eventName:String(body?.eventName||'').slice(0,80),
      action:String(body?.action||'').slice(0,80),
      repository:REPO,
      ref:String(body?.ref||'').slice(0,240),
      sha:String(body?.sha||'').slice(0,80),
      issueNumber:Number(body?.issueNumber||0)||0,
      pullRequestNumber:Number(body?.pullRequestNumber||0)||0
    };
    if(!payload.deliveryId)throw new Error('EVENT_DELIVERY_ID_REQUIRED');
    const core=await fetch(CORE_EVENT,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(5000)});
    const text=await core.text();
    res.writeHead(core.status,{'content-type':core.headers.get('content-type')||'application/json','cache-control':'no-store'});
    return res.end(text);
  }catch(error){
    res.writeHead(401,{'content-type':'application/json','cache-control':'no-store'});
    return res.end(JSON.stringify({ok:false,error:String(error?.message||error).slice(0,160)}));
  }
}

async function snapshot(){
  const generatedAt=new Date().toISOString();
  let core=null,coding=null,coreError=null,codingError=null;
  try{core=await getJson(CORE)}catch(e){coreError=String(e?.message||e)}
  try{coding=await getJson(CODING)}catch(e){codingError=String(e?.message||e)}
  let uiController=null,uiError=null;
  try{uiController=await getJson(UI_CONTROLLER,1800)}catch(e){uiError=String(e?.message||e)}
  const uiOk=!!uiController||await health(UI_HEALTH);
  const jobs=[...(Array.isArray(coding?.jobs)?coding.jobs:[]),...(Array.isArray(core?.jobs)?core.jobs:[])];
  const activeByEmployee=new Map();
  for(const j of jobs){
    if(!j?.employee_id||!isActiveStatus(j.status))continue;
    const old=activeByEmployee.get(j.employee_id);
    const jt=Date.parse(j.started_at||j.updated_at||j.created_at||0)||0;
    const ot=Date.parse(old?.started_at||old?.updated_at||old?.created_at||0)||0;
    if(!old||jt>=ot)activeByEmployee.set(j.employee_id,j);
  }
  const workers=[];
  for(const r of (Array.isArray(core?.resources)?core.resources:[])){
    if(r?.employee_id)workers.push(normResource(r,activeByEmployee.get(r.employee_id)));
  }
  for(const id of ['NV02','NV03','NV04'])workers.push(uiWorker(id,uiController,uiOk));
  const rank={working:0,waiting:1,blocked:2,unknown:3,idle:4,paused:5};
  workers.sort((a,b)=>(rank[a.state]??9)-(rank[b.state]??9)||a.employeeId.localeCompare(b.employeeId));
  const summary={
    working:workers.filter(w=>w.state==='working').length,
    waiting:workers.filter(w=>w.state==='waiting').length,
    blocked:workers.filter(w=>w.state==='blocked').length,
    idle:workers.filter(w=>w.state==='idle').length,
    unknown:workers.filter(w=>w.state==='unknown').length,
    total:workers.length
  };
  return {ok:true,generatedAt,refreshSeconds:5,authority:'PC01 live runtime',
    source:{core:!!core,coding:!!coding,uiAutopilot:uiOk,uiController:!!uiController,coreError,codingError,uiError},summary,workers};
}
const server=http.createServer(async(req,res)=>{
  res.setHeader('cache-control','no-store');res.setHeader('x-content-type-options','nosniff');res.setHeader('access-control-allow-origin','*');
  if(req.method==='POST'&&req.url==='/github-event')return relayGithubEvent(req,res);
  if(req.method!=='GET'){res.writeHead(405);return res.end()}
  if(req.url==='/health'){res.setHeader('content-type','application/json');return res.end(JSON.stringify({ok:true,service:'tigeriq-live-status-bridge',githubEventRelay:true,time:new Date().toISOString()}))}
  if(req.url!=='/status'){res.writeHead(404);return res.end()}
  try{res.setHeader('content-type','application/json; charset=utf-8');res.end(JSON.stringify(await snapshot()))}
  catch(e){res.writeHead(503,{'content-type':'application/json'});res.end(JSON.stringify({ok:false,reason:String(e?.message||e),generatedAt:new Date().toISOString()}))}
});
server.listen(PORT,'127.0.0.1',()=>console.log('TigerIQ Live Status Bridge listening on 127.0.0.1:'+PORT));