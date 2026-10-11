import {timingSafeEqual} from 'node:crypto';
import {claimGithubScopeLease,readGithubScopeLease,renewGithubScopeLease,releaseGithubScopeLease} from './github-scope-lease.mjs';
import {nv02EligibleWorkOrder} from './nv02-local-self-pull.mjs';

// #4649. A worker session identity must be attested using an independently
// provisioned per-worker capability (never the shared GitHub login).
// This endpoint is loopback-only, disabled unless BOTH secret and session are
// explicitly provisioned. It is not a public cloud or ChatGPT connector.
const prefix='/api/github-scope-worker/';
const operations=new Set(['claim','read','renew','release']);
const loopback=new Set(['127.0.0.1','::1','::ffff:127.0.0.1']);
const raw=(v)=>String(v||'').trim();
const field=(body,key)=>raw(String(body||'').match(new RegExp('^'+key+'=([^\r\n]+)','m'))?.[1]);
function secureEqual(a,b){
  const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''));
  return x.length===y.length&&x.length>0&&timingSafeEqual(x,y);
}
function send(res,code,data){
  res.writeHead(code,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});
  res.end(JSON.stringify(data));
}
async function bodyJson(req){
  let body='';
  for await(const part of req){
    body+=String(part);
    if(Buffer.byteLength(body)>8192)throw Error('REQUEST_TOO_LARGE');
  }
  const value=JSON.parse(body||'{}');
  if(value===null||typeof value!=='object'||Array.isArray(value))throw Error('BODY_INVALID');
  return value;
}
export function validateGithubWorkerIssue(issue,workerId,scope){
  if(!Number.isSafeInteger(Number(issue?.number))||Number(issue.number)<=0||issue?.state!=='open')
    throw Error('ISSUE_NOT_OPEN');
  if(!/^\[P[1-5]\]/i.test(String(issue.title||'')))throw Error('P0_OR_PRIORITY_UNVERIFIED');
  const body=String(issue.body||'');
  if(field(body,'TIGERIQ_EXECUTABLE')!=='true'||field(body,'AUTO_QUEUE')!=='INCLUDED')
    throw Error('ISSUE_NOT_EXECUTABLE');
  if(field(body,'OWNER_HOLD')==='true'||field(body,'NO_SECURITY_BOUNDARY_CHANGE')==='false')
    throw Error('OWNER_OR_SECURITY_HOLD');
  if(field(body,'RESOURCE_SCOPE')!==scope)throw Error('SOURCE_SCOPE_MISMATCH');
  if(workerId==='NV02'&&nv02EligibleWorkOrder(issue)?.eligible!==true)
    throw Error('NV02_NOT_ELIGIBLE');
  if(workerId==='NV03'){
    const capability=field(body,'CAPABILITY').toLowerCase();
    if(!['review','research','general'].includes(capability))throw Error('NV03_CAPABILITY_DENIED');
    const target=field(body,'TARGET_EMPLOYEE').toUpperCase();
    if(target&&target!=='AUTO'&&target!=='NV03')throw Error('NV03_TARGET_DENIED');
    if(field(body,'IMPLEMENTER')==='NV03'&&capability==='review')throw Error('NV03_SELF_REVIEW_DENIED');
  }
  return true;
}
export function createGithubScopeWorkerApi({
  pool,configByWorker={},fetchCanonicalIssue,ops={
    claim:claimGithubScopeLease,read:readGithubScopeLease,
    renew:renewGithubScopeLease,release:releaseGithubScopeLease,
  },
}={}){
  return async(req,res,url)=>{
    const path=url?.pathname||'';
    if(!path.startsWith(prefix))return false;
    const action=path.slice(prefix.length);
    if(!operations.has(action)){send(res,404,{ok:false,error:'NOT_FOUND'});return true;}
    if(!loopback.has(String(req.socket?.remoteAddress||''))){
      send(res,403,{ok:false,error:'LOOPBACK_REQUIRED'});return true;
    }
    const workerId=raw(req.headers['x-tigeriq-worker-id']).toUpperCase();
    if(!['NV02','NV03'].includes(workerId)){
      send(res,403,{ok:false,error:'WORKER_NOT_ALLOWED'});return true;
    }
    const configured=configByWorker[workerId]||{};
    if(raw(configured.secret).length<32||raw(configured.sessionId).length<8){
      send(res,503,{ok:false,error:'WORKER_SESSION_NOT_PROVISIONED'});return true;
    }
    const session=raw(req.headers['x-tigeriq-worker-session-id']);
    const match=session===configured.sessionId&&secureEqual(
      String(req.headers.authorization||'').replace(/^Bearer\s+/i,''),configured.secret);
    if(!match){send(res,401,{ok:false,error:'WORKER_SESSION_UNAUTHENTICATED'});return true;}
    if(action==='read'&&req.method!=='GET'||action!=='read'&&req.method!=='POST'){
      send(res,405,{ok:false,error:'METHOD_NOT_ALLOWED'});return true;
    }
    try{
      const payload=action==='read'?{resourceScope:url.searchParams.get('resourceScope')}:await bodyJson(req);
      const resourceScope=raw(payload.resourceScope);
      if(!/^[A-Za-z0-9][A-Za-z0-9._:/-]{5,199}$/.test(resourceScope))throw Error('SCOPE_INVALID');
      if(action==='read'){
        const lease=await ops.read(pool,resourceScope);
        const mine=lease?.worker_id===workerId&&lease?.worker_session_id===session;
        send(res,200,{ok:true,held:Boolean(lease),mine,leaseId:mine?lease.lease_id:null,
          leaseUntil:mine?lease.lease_until:null});return true;
      }
      if(action==='claim'){
        if(typeof fetchCanonicalIssue!=='function')throw Error('CANONICAL_GITHUB_SOURCE_UNAVAILABLE');
        const issueNumber=Number(payload.issueNumber);
        if(!Number.isSafeInteger(issueNumber)||issueNumber<=0)throw Error('ISSUE_INVALID');
        const current=await fetchCanonicalIssue(issueNumber);
        validateGithubWorkerIssue(current,workerId,resourceScope);
        const result=await ops.claim(pool,{resourceScope,workerId,
          workerSessionId:session,issueNumber,ttlMs:Number(payload.ttlMs||120000)});
        send(res,result.acquired?200:409,{ok:result.acquired===true,...result});return true;
      }
      const ownership={resourceScope,workerId,workerSessionId:session,leaseId:raw(payload.leaseId)};
      if(action==='renew'){
        const renewed=await ops.renew(pool,{...ownership,ttlMs:Number(payload.ttlMs||120000)});
        send(res,renewed?200:409,{ok:Boolean(renewed),lease:renewed||null});return true;
      }
      const released=await ops.release(pool,ownership);
      send(res,released?200:409,{ok:released===true,released:released===true});
      return true;
    }catch(error){
      const kind=String(error?.message||error);
      // No token or request body in error messages.
      send(res,409,{ok:false,error:kind.slice(0,110)});return true;
    }
  };
}
