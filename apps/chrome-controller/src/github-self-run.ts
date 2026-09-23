import { randomUUID } from 'node:crypto';
import type { WorkerId } from './model.js';

export interface GithubIssue {
  number:number;
  title:string;
  body:string|null;
  html_url:string;
  state:string;
  state_reason?:string|null;
  updated_at?:string|null;
  pull_request?:unknown;
}
export interface GithubComment {
  id:number;
  body:string|null;
  created_at?:string|null;
  updated_at?:string|null;
}
export interface AppChromeClaim {
  claimId:string;
  workerId:WorkerId;
  scope:string;
  issueNumber:number;
  expiresAt:string;
  createdAt:string;
}
export interface SelfRunRuntimeState {
  enabled:boolean;
  lastTickAt:string|null;
  lastError:string|null;
  lastClaimAt:string|null;
  lastClaimIssue:number|null;
  lastClaimWorker:WorkerId|null;
}

const PRIORITY:Record<string,number>={P0:0,P1:1,P2:2,P3:3};
const TERMINAL_OR_HOLD_STATE_RE=/(DONE|COMPLETED|SUPERSEDED|CANCELLED|CANCELED|MANUAL_HOLD|FROZEN|WAIT_DEPENDENCY|EXTERNAL_WAIT|BLOCKED)/i;
const SAFE_FALSE_KEYS=['NO_DIRECT_MAIN','NO_PRODUCTION_RELEASE','NO_PAID_COST','NO_CREDENTIAL_CHANGE','NO_DESTRUCTIVE'];
const CLAIM_HEADER='[APP_CHROME_CLAIM]';
const RELEASE_HEADER='[APP_CHROME_RELEASE]';

export function parseWorkOrderMetadata(body:string|null|undefined):Record<string,string>{
  const out:Record<string,string>={};
  for(const raw of String(body??'').split(/\r?\n/)){
    const m=raw.trim().match(/^([A-Z][A-Z0-9_]{1,80})\s*=\s*(.+)$/);
    if(m)out[m[1]]=m[2].trim();
  }
  return out;
}
export function resourceScopeOf(issue:GithubIssue):string{
  return parseWorkOrderMetadata(issue.body).RESOURCE_SCOPE||`ISSUE_${issue.number}`;
}
export function priorityOf(issue:GithubIssue):number{
  const meta=parseWorkOrderMetadata(issue.body);
  const base=PRIORITY[String(meta.PRIORITY||'P3').toUpperCase()]??PRIORITY.P3;
  return meta.OWNER_DIRECT==='true'?base-10:base;
}
export function isSelfRunSafe(issue:GithubIssue):boolean{
  if(issue.pull_request||issue.state!=='open')return false;
  const meta=parseWorkOrderMetadata(issue.body);
  if(meta.TIGERIQ_EXECUTABLE!=='true')return false;
  if(meta.AUTO_QUEUE==='EXCLUDED')return false;
  if(meta.STATE&&TERMINAL_OR_HOLD_STATE_RE.test(meta.STATE))return false;
  const zeroCost=meta.ZERO_COST==='true'||meta.NO_PAID_COST==='true';
  if(!zeroCost)return false;
  for(const key of SAFE_FALSE_KEYS){
    if(meta[key]!=='true')return false;
  }
  return true;
}
function isReview(issue:GithubIssue,meta:Record<string,string>){
  return meta.REVIEW_ONLY==='true'||String(meta.CAPABILITY||'').toLowerCase()==='review'||/^\[REVIEW\]/i.test(issue.title);
}
function isResearch(issue:GithubIssue,meta:Record<string,string>){
  return meta.RESEARCH_ONLY==='true'||String(meta.CAPABILITY||'').toLowerCase()==='research'||/^\[RESEARCH\]/i.test(issue.title);
}
function isCodingMutation(meta:Record<string,string>){
  return meta.AUTONOMOUS_CODE==='true'||String(meta.CAPABILITY||'').toLowerCase()==='code'||Boolean(meta.ALLOW_PATH_PREFIX);
}
export function workerEligibleForIssue(workerId:WorkerId,issue:GithubIssue):boolean{
  if(!isSelfRunSafe(issue))return false;
  const meta=parseWorkOrderMetadata(issue.body);
  const review=isReview(issue,meta);
  const research=isResearch(issue,meta);
  const coding=isCodingMutation(meta);
  if(workerId==='NV03')return review&&!coding;
  if(workerId==='NV04')return (research||review)&&!coding;
  return !review&&!research&&!coding;
}
export function eligibleIssuesForWorker(workerId:WorkerId,issues:GithubIssue[],blockedScopes:Set<string>,excludedIssues:Set<number>=new Set()):GithubIssue[]{
  return issues
    .filter((issue)=>!excludedIssues.has(issue.number))
    .filter((issue)=>workerEligibleForIssue(workerId,issue))
    .filter((issue)=>!blockedScopes.has(resourceScopeOf(issue)))
    .sort((a,b)=>priorityOf(a)-priorityOf(b)||(Date.parse(String(a.updated_at||''))||0)-(Date.parse(String(b.updated_at||''))||0)||a.number-b.number);
}
function parseKeyValueBlock(body:string|null|undefined,header:string):Record<string,string>|null{
  const text=String(body??'');
  const i=text.indexOf(header);
  if(i<0)return null;
  const out:Record<string,string>={};
  for(const line of text.slice(i+header.length).split(/\r?\n/)){
    const trimmed=line.trim();
    if(!trimmed)continue;
    const m=trimmed.match(/^([a-z_]+)=(.*)$/i);
    if(!m)break;
    out[m[1].toLowerCase()]=m[2].trim();
  }
  return out;
}
export function activeAppChromeClaims(comments:GithubComment[],nowMs=Date.now()):AppChromeClaim[]{
  const released=new Set<string>();
  const claims:AppChromeClaim[]=[];
  for(const comment of [...comments].sort((a,b)=>Number(a.id)-Number(b.id))){
    const release=parseKeyValueBlock(comment.body,RELEASE_HEADER);
    if(release?.claim_id)released.add(release.claim_id);
    const claim=parseKeyValueBlock(comment.body,CLAIM_HEADER);
    if(!claim?.claim_id||!claim.worker||!claim.expires_at||!claim.issue)continue;
    const workerId=claim.worker as WorkerId;
    if(!['NV02','NV03','NV04'].includes(workerId))continue;
    claims.push({
      claimId:claim.claim_id,
      workerId,
      scope:claim.scope||'',
      issueNumber:Number(claim.issue),
      expiresAt:claim.expires_at,
      createdAt:String(comment.created_at||''),
    });
  }
  return claims.filter((x)=>!released.has(x.claimId)&&Date.parse(x.expiresAt)>nowMs);
}
async function githubJson(fetchImpl:typeof fetch,url:string,token:string,init:RequestInit={}):Promise<any>{
  const headers:Record<string,string>={
    accept:'application/vnd.github+json',
    'user-agent':'TigerIQ-AppChrome-SelfRun/1.0',
    'x-github-api-version':'2022-11-28',
    ...((init.headers as Record<string,string>|undefined)??{}),
  };
  if(token)headers.authorization=`Bearer ${token}`;
  const response=await fetchImpl(url,{...init,headers,signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw new Error(`GITHUB_HTTP_${response.status}`);
  if(response.status===204)return {};
  return response.json();
}
export async function listOpenGithubIssues({
  fetchImpl=fetch,owner='newsdayads',repo='tigeriq-ai-lab',token='',
}:{fetchImpl?:typeof fetch;owner?:string;repo?:string;token?:string}={}):Promise<GithubIssue[]>{
  if(!token)throw new Error('APP_CHROME_GITHUB_TOKEN_REQUIRED');
  const data=await githubJson(fetchImpl,`https://api.github.com/repos/${owner}/${repo}/issues?state=open&per_page=100&sort=updated&direction=asc`,token);
  return (Array.isArray(data)?data:[]).filter((x)=>!x.pull_request) as GithubIssue[];
}
export async function fetchIssueComments({
  issueNumber,fetchImpl=fetch,owner='newsdayads',repo='tigeriq-ai-lab',token='',
}:{issueNumber:number;fetchImpl?:typeof fetch;owner?:string;repo?:string;token?:string}):Promise<GithubComment[]>{
  const data=await githubJson(fetchImpl,`https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/comments?per_page=100`,token);
  return Array.isArray(data)?data as GithubComment[]:[];
}
export async function fetchGithubIssue({
  issueNumber,fetchImpl=fetch,owner='newsdayads',repo='tigeriq-ai-lab',token='',
}:{issueNumber:number;fetchImpl?:typeof fetch;owner?:string;repo?:string;token?:string}):Promise<GithubIssue>{
  return githubJson(fetchImpl,`https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}`,token) as Promise<GithubIssue>;
}
async function postIssueComment({
  issueNumber,text,fetchImpl=fetch,owner='newsdayads',repo='tigeriq-ai-lab',token='',
}:{issueNumber:number;text:string;fetchImpl?:typeof fetch;owner?:string;repo?:string;token?:string}){
  if(!token)throw new Error('APP_CHROME_GITHUB_TOKEN_REQUIRED');
  return githubJson(fetchImpl,`https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/comments`,token,{
    method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({body:text}),
  });
}
export async function claimGithubIssue({
  workerId,issue,claimId:requestedClaimId,ttlMs=2*60*60*1000,fetchImpl=fetch,owner='newsdayads',repo='tigeriq-ai-lab',token='',
}:{workerId:WorkerId;issue:GithubIssue;claimId?:string;ttlMs?:number;fetchImpl?:typeof fetch;owner?:string;repo?:string;token?:string}):Promise<AppChromeClaim|null>{
  const before=await fetchIssueComments({issueNumber:issue.number,fetchImpl,owner,repo,token});
  if(activeAppChromeClaims(before).length)return null;
  const claimId=requestedClaimId||randomUUID();
  const expiresAt=new Date(Date.now()+ttlMs).toISOString();
  const scope=resourceScopeOf(issue);
  await postIssueComment({
    issueNumber:issue.number,fetchImpl,owner,repo,token,
    text:`${CLAIM_HEADER}\nclaim_id=${claimId}\nworker=${workerId}\nissue=${issue.number}\nscope=${scope}\nexpires_at=${expiresAt}\nsource=APP_CHROME_SELF_RUN`,
  });
  const after=await fetchIssueComments({issueNumber:issue.number,fetchImpl,owner,repo,token});
  const active=activeAppChromeClaims(after);
  const winner=active.sort((a,b)=>Date.parse(a.createdAt)-Date.parse(b.createdAt)||a.claimId.localeCompare(b.claimId))[0];
  if(!winner||winner.claimId!==claimId){
    await releaseGithubClaim({claimId,workerId,issueNumber:issue.number,state:'CLAIM_LOST',fetchImpl,owner,repo,token});
    return null;
  }
  return winner;
}
export async function releaseGithubClaim({
  claimId,workerId,issueNumber,state,fetchImpl=fetch,owner='newsdayads',repo='tigeriq-ai-lab',token='',
}:{claimId:string;workerId:WorkerId;issueNumber:number;state:string;fetchImpl?:typeof fetch;owner?:string;repo?:string;token?:string}){
  await postIssueComment({
    issueNumber,fetchImpl,owner,repo,token,
    text:`${RELEASE_HEADER}\nclaim_id=${claimId}\nworker=${workerId}\nissue=${issueNumber}\nstate=${state}\nreleased_at=${new Date().toISOString()}`,
  });
}
export async function closeGithubIssueCompleted({
  issueNumber,fetchImpl=fetch,owner='newsdayads',repo='tigeriq-ai-lab',token='',
}:{issueNumber:number;fetchImpl?:typeof fetch;owner?:string;repo?:string;token?:string}){
  return githubJson(fetchImpl,`https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}`,token,{
    method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({state:'closed',state_reason:'completed'}),
  });
}
function terminalMarkerFromBody(body:string):'DONE'|'BLOCKED'|'EXTERNAL_WAIT'|null{
  if(/(?:^|\n)(?:STATE|RESULT)\s*=\s*(?:DONE|COMPLETED)(?:\n|$)/i.test(body)||/(?:^|\n)REVIEW\s*=\s*PASS(?:\n|$)/i.test(body))return 'DONE';
  if(/(?:^|\n)(?:STATE|RESULT)\s*=\s*EXTERNAL_WAIT(?:\n|$)/i.test(body))return 'EXTERNAL_WAIT';
  if(/(?:^|\n)(?:STATE|RESULT)\s*=\s*BLOCKED(?:\n|$)/i.test(body)||/(?:^|\n)REVIEW\s*=\s*BLOCKED(?:\n|$)/i.test(body))return 'BLOCKED';
  return null;
}
export function terminalMarkerFromComments(comments:GithubComment[],claimId=''):'DONE'|'BLOCKED'|'EXTERNAL_WAIT'|null{
  const ordered=[...comments].sort((a,b)=>Number(a.id)-Number(b.id));
  let relevant=ordered.filter((comment)=>{
    const body=String(comment.body??'');
    return !body.includes(CLAIM_HEADER)&&!body.includes(RELEASE_HEADER);
  });
  if(claimId){
    const claimComment=ordered.find((comment)=>parseKeyValueBlock(comment.body,CLAIM_HEADER)?.claim_id===claimId);
    if(!claimComment)return null;
    relevant=relevant.filter((comment)=>Number(comment.id)>Number(claimComment.id));
  }
  const latest=relevant.at(-1);
  if(!latest)return null;
  const body=String(latest.body??'');
  if(claimId){
    const evidenceClaimId=body.split(/\r?\n/).map((line)=>line.trim()).find((line)=>/^CLAIM_ID\s*=/i.test(line))?.split('=').slice(1).join('=').trim()??'';
    if(evidenceClaimId!==claimId)return null;
  }
  return terminalMarkerFromBody(body);
}
export function buildSelfRunPrompt(workerId:WorkerId,issue:GithubIssue,comments:GithubComment[],claim:AppChromeClaim):string{
  const recent=comments.slice(-12).map((x)=>String(x.body??'').trim()).filter(Boolean).join('\n\n--- COMMENT ---\n\n');
  return [
    'LÀM — NO YAPPING.',
    `APP_CHROME_SELF_RUN=true | WORKER=${workerId} | CLAIM_ID=${claim.claimId}`,
    `CURRENT_WORK_ORDER=#${issue.number} - ${issue.title}`,
    `SOURCE=${issue.html_url}`,
    '',
    'Đây là việc App Chrome tự lấy từ GitHub. Chỉ làm đúng Work Order này; không tự chuyển sang việc khác trong chat.',
    'Tuân thủ guardrail trong issue. Không MAIN/Production, không chi phí, không đổi credential/security, không destructive/irreversible.',
    'Làm liên tục đến DONE có evidence, BLOCKED thật, EXTERNAL_WAIT hoặc hard gate.',
    `Terminal evidence bắt buộc là COMMENT MỚI NHẤT của worker và phải có dòng CLAIM_ID=${claim.claimId}.`,
    `Khi DONE: comment CLAIM_ID=${claim.claimId} + STATE=DONE (hoặc REVIEW=PASS nếu review) cùng evidence, sau đó đóng chính issue này với state_reason=completed.`,
    `Khi BLOCKED/EXTERNAL_WAIT: comment CLAIM_ID=${claim.claimId} + STATE=BLOCKED hoặc STATE=EXTERNAL_WAIT cùng evidence/blocker.`,
    '',
    '--- FULL ISSUE ---',
    String(issue.body??''),
    recent?'\n--- RECENT COMMENTS ---\n'+recent:'',
  ].join('\n').slice(0,60000);
}
