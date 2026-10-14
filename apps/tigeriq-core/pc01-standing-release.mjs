// PC01 bounded standing-release authorization. NEVER activated by a code merge.
// The grant is created only from an immutable Owner GitHub comment received via verified
// GitHub Actions OIDC, then stored in the existing SYSTEM/Admin-only protected root.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { impactForPc01SignedSnapshotV2, PC01_RELEASE_ROOT, PC01_INSTALLED_STATE, PC01_APPROVAL_PATH, PC01_ATTEMPT_PATH } from './pc01-release-approval.mjs';

const OWNER='newsdayads', REPO='newsdayads/tigeriq-ai-lab';
const SHA=/^[a-f0-9]{40}$/;
export const STANDING_POLICY_PATH=path.win32.join(PC01_RELEASE_ROOT,'core-runtime-standing-policy.json');
const LOCK_PATH=path.win32.join(PC01_RELEASE_ROOT,'core-runtime-standing-release.lock');
const SCHEMA='TIGERIQ_PC01_STANDING_POLICY_V1';
const REQUIRED_CHECKS=Object.freeze(['CI Verify','Queue Hygiene Verify','Vercel Online Verify']);
// Permanent delegation never applies itself, OIDC/CI policy, shell controls, credentials,
// broad UI, App Chrome, Android, or updater's own protected release control plane.
const SAFE_CORE=new Set([
  'apps/tigeriq-core/backlog-hygiene.mjs',
  'apps/tigeriq-core/github-backlog-policy.mjs',
  'apps/tigeriq-core/manager-batch-policy.mjs',
  'apps/tigeriq-core/manager-cycle-policy.mjs',
  'apps/tigeriq-core/manager-job-policy.mjs',
  'apps/tigeriq-core/job-recovery-policy.mjs',
  'apps/tigeriq-core/context-gateway.mjs',
  'apps/tigeriq-core/objective-local-routing.mjs',
  'apps/tigeriq-core/work-routing-policy.mjs',
  'apps/tigeriq-core/work-order-lifecycle-v2.mjs',
]);
const SAFE_CODING=new Set([
  'apps/tigeriq-coding-lane/ai-json-transport.mjs',
  'apps/tigeriq-coding-lane/nonblocking-manager-tick.mjs',
]);
// Updater changes can only be covered by individually PINNED future Git blobs in an
// separately signed activation policy; this initial policy has NO updater blob pins.
const SAFE_UPDATER_PINS=Object.freeze({});
const SAFE_TEST=/^tests\/[A-Za-z0-9_.\/-]+\.(?:mjs|js|ts|tsx)$/;
const DENIED=/(?:app.?chrome|android|secret|credential|\.env|production|security|permissions|release-guard|release-approval|standing-release|github-actions-oidc|core\.mjs|coding-lane\.mjs|coding-entry\.mjs|update-core-runtime\.ps1|\.github\/|^api\/|^public\/)/i;

function deny(code){throw new Error('PC01_STANDING_'+code);}
function exactKeys(x,keys){return x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).sort().join(',')===keys.slice().sort().join(',');}
function parseJson(t,code){try{return JSON.parse(String(t));}catch{deny(code)}}
function validateComment(body){
  const lines=String(body||'').replace(/\r\n/g,'\n').trim().split('\n');
  if(lines.length!==3||lines[0]!=='TIGERIQ_PC01_STANDING_ENABLE_V1'||
     !/^BASELINE_SHA=[a-f0-9]{40}$/.test(lines[1])||
     lines[2]!=='POLICY=SAFE_CORE_CODING_V1')deny('OWNER_COMMENT_FORMAT');
  return lines[1].slice('BASELINE_SHA='.length);
}
function checkRoot(root,platform){if(root!==PC01_RELEASE_ROOT||platform!=='win32')deny('PROTECTED_RUNTIME_REQUIRED');}
async function assertRoot(io,root,platform){
  checkRoot(root,platform);
  const st=await io.lstat(root);
  if(!st.isDirectory()||st.isSymbolicLink()||path.win32.normalize(await io.realpath(root)).toLowerCase()!==path.win32.normalize(root).toLowerCase())deny('ROOT_UNTRUSTED');
}
async function gh(relative,{token,fetchImpl}){
  if(!token)deny('GITHUB_READ_AUTH_MISSING');
  const r=await fetchImpl('https://api.github.com/repos/'+REPO+relative,{
    headers:{authorization:'Bearer '+token,accept:'application/vnd.github+json','user-agent':'TigerIQ-Standing-Release'},
    signal:AbortSignal.timeout(6500)});
  if(!r.ok)deny('GITHUB_READ_'+r.status);
  return r.json();
}
export function validateStandingActivation({identity,eventName,payload,comment,installedSha,mainSha,nowMs=Date.now()}){
  const c=identity?.claims||{};
  if(eventName!=='issue_comment'||c.event_name!=='issue_comment'||c.actor!==OWNER||
     identity?.actor!==OWNER||c.ref!=='refs/heads/main'||
     !/^\d{3,20}$/.test(String(identity?.runId||''))||String(c.run_attempt)!=='1')deny('OWNER_OIDC_REQUIRED');
  if(payload?.action!=='created'||payload?.repository?.full_name!==REPO||payload?.issue?.number!==4725||
     payload?.sender?.login!==OWNER||payload?.comment?.user?.login!==OWNER||!Number.isSafeInteger(payload?.comment?.id))deny('OWNER_EVENT_INVALID');
  if(comment?.id!==payload.comment.id||comment?.body!==payload.comment.body||comment?.user?.login!==OWNER||
     !String(comment.issue_url||'').endsWith('/issues/4725')||comment.created_at!==comment.updated_at)deny('COMMENT_READBACK_INVALID');
  const created=Date.parse(comment.created_at);
  if(!Number.isFinite(created)||created>nowMs+30000||nowMs-created>15*60000)deny('COMMENT_EXPIRED');
  const baseline=validateComment(comment.body);
  if(baseline!==installedSha||mainSha!==installedSha||!SHA.test(installedSha))deny('BASELINE_NOT_INSTALLED');
  return {schema:SCHEMA,enabled:true,repo:REPO,policy:'SAFE_CORE_CODING_V1',
    activatedBy:'GH-'+identity.runId+'-'+comment.id,installedAtActivation:baseline,
    issuedAtUtc:new Date(nowMs).toISOString(),expiresAtUtc:new Date(nowMs+30*86400000).toISOString(),
    maxReleases:12,releasesUsed:0,allowedComponents:['coding','core'],updaterBlobs:SAFE_UPDATER_PINS};
}
export function classifyStandingReleaseFiles(files){
  if(!Array.isArray(files)||files.length<1||files.length>30)deny('FILES_INVALID');
  const components=new Set(), seen=new Set();
  for(const f of files){
    const p=f?.filename;
    if(typeof p!=='string'||! /^[a-zA-Z0-9_.\/-]+$/.test(p)||p.startsWith('/')||
       p.split('/').some(x=>!x||x==='.'||x==='..')||seen.has(p)||
       !SHA.test(String(f?.sha||''))||!['added','modified','changed'].includes(f?.status))deny('FILE_PROVENANCE');
    seen.add(p);
    if(DENIED.test(p))deny('PATH_PROTECTED');
    if(SAFE_TEST.test(p))continue;
    if(SAFE_CORE.has(p)){components.add('core');continue;}
    if(SAFE_CODING.has(p)){components.add('coding');continue;}
    if(Object.hasOwn(SAFE_UPDATER_PINS,p)&&SAFE_UPDATER_PINS[p]===f.sha){components.add('updater');continue;}
    deny('PATH_NOT_ALLOWLISTED');
  }
  if(!components.size)deny('NO_RUNTIME_CHANGE');
  return [...components].sort();
}
export function validateStandingReleaseEvidence({identity,eventName,payload,verifiedRun,checks,policy,
  installedSha,mainSha,compare,nowMs=Date.now()}){
  const c=identity?.claims||{};
  if(eventName!=='workflow_run'||c.event_name!=='workflow_run'||c.ref!=='refs/heads/main'||
     !/^\d{3,20}$/.test(String(identity?.runId||''))||String(c.run_attempt)!=='1')deny('WORKFLOW_OIDC_REQUIRED');
  if(payload?.action!=='completed'||payload?.repository?.full_name!==REPO)deny('WORKFLOW_EVENT_INVALID');
  const event=payload.workflow_run,run=verifiedRun;
  if(!event||!run||run.id!==event.id||!Number.isSafeInteger(run.id)||
     run.name!==event.name||!['CI','WO-014 Queue Hygiene','WO-012/013 Vercel Online Verify'].includes(run.name)||
     run.status!=='completed'||run.conclusion!=='success'||run.event!=='push'||run.head_branch!=='main'||
     run.head_sha!==event.head_sha||run.head_sha!==mainSha||!SHA.test(mainSha))deny('WORKFLOW_READBACK_INVALID');
  if(!Array.isArray(checks)||!REQUIRED_CHECKS.every(name=>checks.some(x=>x.name===name&&
     x.head_sha===mainSha&&x.status==='completed'&&x.conclusion==='success'&&x.app?.slug==='github-actions')))
       deny('THREE_CI_CHECKS_REQUIRED');
  if(!policy||!exactKeys(policy,['schema','enabled','repo','policy','activatedBy','installedAtActivation',
      'issuedAtUtc','expiresAtUtc','maxReleases','releasesUsed','allowedComponents','updaterBlobs'])||
     policy.schema!==SCHEMA||policy.enabled!==true||policy.repo!==REPO||policy.policy!=='SAFE_CORE_CODING_V1'||
     !/^GH-\d{3,20}-\d{1,20}$/.test(policy.activatedBy)||!SHA.test(policy.installedAtActivation)||
     !exactKeys(policy.updaterBlobs,[])||
     JSON.stringify(policy.allowedComponents)!=='["coding","core"]'||policy.maxReleases!==12||
     !Number.isInteger(policy.releasesUsed)||policy.releasesUsed<0||policy.releasesUsed>=12)deny('STANDING_POLICY_INVALID');
  const from=Date.parse(policy.issuedAtUtc),expires=Date.parse(policy.expiresAtUtc);
  if(!Number.isFinite(from)||!Number.isFinite(expires)||expires-from!==30*86400000||
     nowMs<from||nowMs>=expires)deny('STANDING_EXPIRED');
  if(!SHA.test(installedSha)||installedSha===mainSha||!compare||compare.status!=='ahead'||
     compare.behind_by!==0||compare.ahead_by<1||compare.ahead_by>20||
     compare.total_commits>20)deny('ANCESTRY_INVALID');
  const allowed=classifyStandingReleaseFiles(compare.files);
  // Existing signed release guard independently validates all original V2 file classes.
  const covered=impactForPc01SignedSnapshotV2(compare.files);
  if(covered.join(',')!==allowed.join(',')||allowed.some(x=>!policy.allowedComponents.includes(x)))deny('IMPACT_INVALID');
  return {
    schema:'TIGERIQ_PC01_RELEASE_APPROVAL_V2',releasePolicy:'SCOPED_SNAPSHOT_V2',
    scope:'TIGERIQ_PC01_GATED_RELEASE_NO_RDC_PHASE1',
    requestId:'AUTO-'+identity.runId+'-'+mainSha.slice(0,16),
    targetSha:mainSha,expectedInstalledSha:installedSha,rollbackSha:installedSha,
    approved:true,components:allowed,expiresAtUtc:new Date(nowMs+10*60000).toISOString(),
  };
}
async function readMaybe(io,p){
  try{return parseJson(await io.readFile(p,'utf8'),'FILE_JSON_INVALID');}
  catch(e){if(e?.code==='ENOENT')return null;throw e;}
}
async function withLock(io,fn){
  let h;
  try{h=await io.open(LOCK_PATH,'wx',0o600);}catch{deny('ANOTHER_WRITER_OR_STALE_LOCK');}
  try{return await fn();}finally{await h.close();await io.unlink(LOCK_PATH);}
}
async function rotateConsumed(io){
  const ticket=await readMaybe(io,PC01_APPROVAL_PATH);
  if(!ticket)return;
  const attempt=await readMaybe(io,PC01_ATTEMPT_PATH);
  if(!attempt||!['COMMITTED','ROLLED_BACK'].includes(attempt.result)||
     attempt.targetSha!==ticket.targetSha||attempt.requestId!==ticket.requestId)deny('ACTIVE_APPROVAL_UNCONSUMED');
  const archive=path.win32.join(PC01_RELEASE_ROOT,'Backup','release-ticket-'+ticket.targetSha+'-'+attempt.result+'.json');
  if(await readMaybe(io,archive))deny('ARCHIVE_COLLISION');
  await io.rename(PC01_APPROVAL_PATH,archive);
}
export async function enablePc01StandingRelease({identity,eventName,payload,githubToken,fetchImpl=fetch,
    io=fs,platform=process.platform,root=PC01_RELEASE_ROOT,nowMs=Date.now()}={}){
  checkRoot(root,platform);
  const comment=await gh('/issues/comments/'+payload?.comment?.id,{token:githubToken,fetchImpl});
  const installed=parseJson(await io.readFile(PC01_INSTALLED_STATE,'utf8'),'STATE_INVALID');
  const main=await gh('/git/ref/heads/main',{token:githubToken,fetchImpl});
  const policy=validateStandingActivation({identity,eventName,payload,comment,
    installedSha:installed.currentSha,mainSha:main.object?.sha,nowMs});
  await assertRoot(io,root,platform);
  return withLock(io,async()=>{
    if(await readMaybe(io,STANDING_POLICY_PATH))deny('ALREADY_ENABLED_OR_REVOKE_REQUIRED');
    const h=await io.open(STANDING_POLICY_PATH,'wx',0o600);
    try{await h.writeFile(JSON.stringify(policy,null,2)+'\n','utf8');await h.sync();}
    finally{await h.close();}
    return {enabled:true,expiresAtUtc:policy.expiresAtUtc,maxReleases:policy.maxReleases,
      activation:policy.activatedBy,source:'VERIFIED_OWNER_OIDC',deviceWrites:['protected-policy']};
  });
}
export async function acceptPc01StandingWorkflowRelease({identity,eventName,payload,githubToken,
  fetchImpl=fetch,io=fs,platform=process.platform,root=PC01_RELEASE_ROOT,nowMs=Date.now()}={}){
  checkRoot(root,platform);
  // Early fail before Github/network calls if no trusted Owner-enabled local policy.
  const policy=await readMaybe(io,STANDING_POLICY_PATH);
  if(!policy)deny('NOT_ACTIVATED');
  const installed=parseJson(await io.readFile(PC01_INSTALLED_STATE,'utf8'),'STATE_INVALID');
  const main=await gh('/git/ref/heads/main',{token:githubToken,fetchImpl});
  const mainSha=String(main.object?.sha||'');
  const runId=payload?.workflow_run?.id;
  if(!Number.isSafeInteger(runId)||runId<=0)deny('WORKFLOW_ID_INVALID');
  const [run,checksData,compare]=await Promise.all([
    gh('/actions/runs/'+runId,{token:githubToken,fetchImpl}),
    gh('/commits/'+mainSha+'/check-runs?per_page=100',{token:githubToken,fetchImpl}),
    gh('/compare/'+installed.currentSha+'...'+mainSha,{token:githubToken,fetchImpl}),
  ]);
  const ticket=validateStandingReleaseEvidence({identity,eventName,payload,verifiedRun:run,
    checks:checksData.check_runs,policy,installedSha:installed.currentSha,mainSha,compare,nowMs});
  await assertRoot(io,root,platform);
  return withLock(io,async()=>{
    const policyNow=await readMaybe(io,STANDING_POLICY_PATH);
    if(JSON.stringify(policyNow)!==JSON.stringify(policy))deny('POLICY_CHANGED_DURING_GATE');
    const installedNow=parseJson(await io.readFile(PC01_INSTALLED_STATE,'utf8'),'STATE_INVALID');
    if(installedNow.currentSha!==ticket.expectedInstalledSha)deny('BASELINE_CHANGED');
    const attempt=await readMaybe(io,PC01_ATTEMPT_PATH);
    if(attempt?.targetSha===ticket.targetSha||attempt?.requestId===ticket.requestId)deny('REPLAY');
    await rotateConsumed(io);
    // Burn the grant counter BEFORE issuing the ticket; a crash cannot grant extra releases.
    const next={...policy,releasesUsed:policy.releasesUsed+1};
    const pending=STANDING_POLICY_PATH+'.pending';
    const p=await io.open(pending,'wx',0o600);
    try{await p.writeFile(JSON.stringify(next,null,2)+'\n');await p.sync();}
    finally{await p.close();}
    await io.rename(pending,STANDING_POLICY_PATH);
    const h=await io.open(PC01_APPROVAL_PATH,'wx',0o600);
    try{await h.writeFile(JSON.stringify(ticket,null,2)+'\n');await h.sync();}
    finally{await h.close();}
    return {accepted:true,ticketWritten:true,targetSha:ticket.targetSha,
      components:ticket.components,requestId:ticket.requestId,
      grantRemaining:next.maxReleases-next.releasesUsed,provenance:'OWNER_ACTIVATED_POLICY_AND_GITHUB_ACTIONS_OIDC'};
  });
}
