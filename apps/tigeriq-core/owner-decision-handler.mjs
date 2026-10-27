// Owner decision inbox for the existing TigerIQ Web Control.
// Records an authenticated, scoped Owner decision. NEVER treats the note as
// a signed PC01 release, a new provider permission, or completed execution.
import {isOwnerAuthorized} from '../../api/owner-auth.mjs';
import {projectOwnerApprovalIssue} from '../shared/owner-one-tap-approval.mjs';

const REPO='newsdayads/tigeriq-ai-lab';
const TOKEN=String(process.env.TIGERIQ_GITHUB_TOKEN||'').trim();
const CANONICAL_ORIGIN='https://tigeriq-ai-lab.vercel.app';
const MARKER='TIGERIQ_OWNER_DECISION_V1';
const ID=/^GH-([1-9]\d{0,7})-[A-Za-z0-9._:-]{1,100}$/;
const MAX_BODY=4096;
const timeout=()=>AbortSignal.timeout(12000);
function reply(res,status,body){
  res.statusCode=status;
  res.setHeader('content-type','application/json; charset=utf-8');
  res.setHeader('cache-control','no-store');
  res.setHeader('x-content-type-options','nosniff');
  res.setHeader('x-frame-options','DENY');
  res.setHeader('referrer-policy','no-referrer');
  res.end(JSON.stringify(body));
}
function denied(code,status=403){const e=new Error(code);e.status=status;throw e}
export function ownerDecisionOriginAllowed(headers={}){
  return headers.host==='tigeriq-ai-lab.vercel.app' &&
    headers.origin===CANONICAL_ORIGIN &&
    (!headers['sec-fetch-site']||headers['sec-fetch-site']==='same-origin');
}
export function validateOwnerDecisionInput(body){
  const issueNumber=Number(body?.issueNumber);
  if(!Number.isSafeInteger(issueNumber)||issueNumber<1||issueNumber>99999999)throw new Error('ISSUE_NUMBER_INVALID');
  const requestId=String(body?.requestId||'');
  if(!ID.test(requestId)||!requestId.startsWith('GH-'+issueNumber+'-'))throw new Error('REQUEST_ID_INVALID');
  if(!['APPROVE','REJECT'].includes(body?.decision))throw new Error('DECISION_INVALID');
  const updatedAt=String(body?.expectedUpdatedAt||'');
  if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(updatedAt))throw new Error('ISSUE_REVISION_INVALID');
  return {issueNumber,requestId,decision:body.decision,expectedUpdatedAt:updatedAt};
}
export function ownerDecisionReceipt(input,card){
  const action=String(card?.action||'').replace(/[\r\n]/g,' ').slice(0,300);
  const scope=String(card?.scope||'').replace(/[\r\n]/g,' ').slice(0,600);
  // This is an auditable choice, not a credential grant or target receipt.
  return [
    MARKER,
    'REQUEST_ID='+input.requestId,
    'DECISION='+input.decision,
    'ISSUE='+input.issueNumber,
    'ACTION='+action,
    'SCOPE='+scope,
    'AUTHENTICATION=GOOGLE_OWNER_SESSION_VERCEL',
    'TARGET_PERMISSION_GRANTED=NO',
    'CORE_EXECUTION_ACCEPTED=NO',
    'NEXT=VERIFY_TARGET_GATE_AND_RECORD_REAL_RECEIPT'
  ].join('\n');
}
async function github(path,init={}){
  if(!TOKEN)denied('GITHUB_SERVER_TOKEN_NOT_CONFIGURED',503);
  const response=await fetch('https://api.github.com/repos/'+REPO+path,{
    ...init,signal:timeout(),headers:{
      accept:'application/vnd.github+json',
      'x-github-api-version':'2022-11-28',
      'user-agent':'tigeriq-owner-decision',
      authorization:'Bearer '+TOKEN,
      ...(init.headers||{})
    }
  });
  if(!response.ok)denied('GITHUB_HTTP_'+response.status,502);
  return response.json();
}
async function issueAndCard(issueNumber){
  const issue=await github('/issues/'+issueNumber);
  const result=projectOwnerApprovalIssue(issue,{verified:true,fresh:true});
  if(!result.ok)denied('NO_VERIFIED_OWNER_GATE',409);
  return {issue,card:result.card};
}
async function existingDecision(issueNumber,requestId){
  // Stop, rather than guess, if the history exceeds one complete page.
  const rows=await github('/issues/'+issueNumber+'/comments?per_page=100&page=1');
  if(!Array.isArray(rows)||rows.length>=100)denied('DECISION_HISTORY_NEEDS_RECONCILIATION',409);
  return rows.find(x=>String(x.body||'').startsWith(MARKER+'\nREQUEST_ID='+requestId+'\n'))||null;
}
async function readBody(req){
  let raw='';
  for await(const chunk of req){raw+=chunk;if(raw.length>MAX_BODY)denied('BODY_TOO_LARGE',413)}
  try{return JSON.parse(raw)}catch{denied('INVALID_JSON',400)}
}
export default async function handler(req,res,payload=null){
  try{
    if(!['GET','POST'].includes(req.method))return reply(res,405,{ok:false,error:'METHOD_NOT_ALLOWED'});
    if(!isOwnerAuthorized(req))return reply(res,401,{ok:false,error:'OWNER_LOGIN_REQUIRED'});
    const url=new URL(req.url||'/',CANONICAL_ORIGIN);
    if(req.method==='GET'){
      const issueNumber=Number(url.searchParams.get('issue'));
      if(!Number.isSafeInteger(issueNumber)||issueNumber<1||issueNumber>99999999)denied('ISSUE_NUMBER_INVALID',400);
      const {issue,card}=await issueAndCard(issueNumber);
      const previous=await existingDecision(issueNumber,card.requestId);
      return reply(res,200,{ok:true,pending:!previous,card,updatedAt:issue.updated_at,
        actionCapability:'SCOPED_DECISION_ONLY',executionAccepted:false,
        previousDecision:previous?String(previous.body||'').match(/^DECISION=(APPROVE|REJECT)$/m)?.[1]||'RECORDED':null});
    }
    if(!ownerDecisionOriginAllowed(req.headers)||
       !/^application\/json(?:;|$)/i.test(String(req.headers['content-type']||'')))
      return reply(res,403,{ok:false,error:'SAME_ORIGIN_JSON_REQUIRED'});
    const input=validateOwnerDecisionInput(payload ?? await readBody(req));
    const {issue,card}=await issueAndCard(input.issueNumber);
    if(card.requestId!==input.requestId||issue.updated_at!==input.expectedUpdatedAt)
      denied('ISSUE_CHANGED_RELOAD_REQUIRED',409);
    const prior=await existingDecision(input.issueNumber,input.requestId);
    if(prior)return reply(res,409,{ok:false,error:'DECISION_ALREADY_RECORDED',evidenceUrl:prior.html_url});
    // Never call a release/dispatch/permission API from this browser decision.
    const comment=await github('/issues/'+input.issueNumber+'/comments',{
      method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({body:ownerDecisionReceipt(input,card)})
    });
    return reply(res,201,{ok:true,decisionRecorded:true,targetPermissionGranted:false,
      actionCapability:'SCOPED_DECISION_ONLY',executionAccepted:false,evidenceUrl:comment.html_url,requestId:input.requestId,
      next:'TARGET_GATE_REQUIRES_INDEPENDENT_VERIFICATION'});
  }catch(error){
    return reply(res,error?.status||400,{ok:false,error:String(error?.message||error).slice(0,120)});
  }
}
