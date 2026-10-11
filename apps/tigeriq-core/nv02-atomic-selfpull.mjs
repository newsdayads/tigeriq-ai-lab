import {claimGithubScopeLease,readGithubScopeLease,renewGithubScopeLease,releaseGithubScopeLease} from './github-scope-lease.mjs';
import {nv02AuthorityRevision,nv02LeaseAuthority,nv02EligibleWorkOrder} from './nv02-local-self-pull.mjs';

// This adapter requires a genuine, independently authenticated worker session
// and fresh GitHub Issue read; it is not a permission grant to UI automation.
function deps({db,workerSessionId,verifySession,loadCurrentIssue,postComment}){
  if(!db?.query||!db?.connect)throw Error('ATOMIC_LEASE_DB_REQUIRED');
  if(!/^[A-Za-z0-9:_-]{8,128}$/.test(String(workerSessionId||'')))throw Error('NV02_SESSION_REQUIRED');
  if(typeof verifySession!=='function')throw Error('NV02_IDENTITY_ATTESTATION_REQUIRED');
  if(typeof loadCurrentIssue!=='function')throw Error('NV02_FRESH_GITHUB_READ_REQUIRED');
  if(typeof postComment!=='function')throw Error('NV02_GITHUB_WRITE_REQUIRED');
}
async function attest(verifySession,session){
  const v=await verifySession({workerId:'NV02',workerSessionId:session});
  if(v?.attested!==true||v?.workerId!=='NV02'||v?.workerSessionId!==session)throw Error('NV02_SESSION_NOT_ATTESTED');
}
function currentScope(current,original){
  if(Number(current?.number)!==Number(original?.number)||String(current?.state||'open')!=='open')
    throw Error('NV02_CANONICAL_ISSUE_MISMATCH');
  const scope=String(original?.body||'').match(/^RESOURCE_SCOPE=([^\r\n]+)/m)?.[1]?.trim()||'';
  const authority=nv02LeaseAuthority(current,{workOrder:'#'+current.number,resourceScope:scope});
  if(!authority.valid)throw Error('NV02_SOURCE_AUTHORITY_INVALID:'+authority.reason);
  if(nv02AuthorityRevision(current)!==nv02AuthorityRevision(original))throw Error('NV02_SOURCE_REVISION_CHANGED');
  if(nv02EligibleWorkOrder(current)?.eligible!==true)throw Error('NV02_WORK_NOT_EXECUTABLE');
  return scope;
}
function same(holder,lease,session,n){
  return holder?.lease_id===lease&&holder?.worker_id==='NV02'&&
    holder?.worker_session_id===session&&Number(holder?.issue_number)===Number(n);
}
const defaultOps={
  acquire:claimGithubScopeLease,read:readGithubScopeLease,renew:renewGithubScopeLease,release:releaseGithubScopeLease
};
export async function claimNv02WorkOrderAtomic({
  db,issue,workerSessionId,verifySession,loadCurrentIssue,postComment,ttlMs=120000,ops=defaultOps
}={}){
  deps({db,workerSessionId,verifySession,loadCurrentIssue,postComment});
  await attest(verifySession,workerSessionId);
  if(!Number.isSafeInteger(Number(issue?.number))||Number(issue.number)<=0)throw Error('NV02_WORK_ORDER_REQUIRED');
  const scope=currentScope(await loadCurrentIssue(Number(issue.number)),issue);
  const result=await ops.acquire(db,{resourceScope:scope,workerId:'NV02',workerSessionId,
    issueNumber:Number(issue.number),ttlMs});
  if(result?.acquired!==true)return {claimed:false,reason:result?.reason||'SCOPE_HELD'};
  const id=String(result.lease.lease_id);
  const holder={resourceScope:scope,workerId:'NV02',workerSessionId,leaseId:id};
  try{
    const read=await ops.read(db,scope);
    if(!same(read,id,workerSessionId,issue.number))throw Error('NV02_CLAIM_READBACK_MISMATCH');
    currentScope(await loadCurrentIssue(Number(issue.number)),issue);
    await postComment(Number(issue.number),[
      '[TIGERIQ_NV02_ATOMIC_LEASE_V1]','WORK_ORDER=#'+issue.number,'WORKER=NV02',
      'RESOURCE_SCOPE='+scope,'LEASE_ID='+id,
      'SOURCE_REVISION='+nv02AuthorityRevision(issue),'LEASE_UNTIL='+read.lease_until,
      'AUTHORITY=CORE_POSTGRES_ATOMIC'
    ].join('\n'));
    if(!same(await ops.read(db,scope),id,workerSessionId,issue.number))throw Error('NV02_CLAIM_LOST_AFTER_COMMENT');
    return {claimed:true,workOrder:'#'+issue.number,leaseId:id,resourceScope:scope,
      workerId:'NV02',workerSessionId,expiresAt:read.lease_until};
  }catch(error){
    await ops.release(db,holder).catch(()=>{});
    throw error;
  }
}
export async function renewNv02WorkOrderAtomic({
  db,lease,workerSessionId,verifySession,ttlMs=120000,ops=defaultOps
}={}){
  if(!db?.query||!lease?.claimed)throw Error('NV02_RENEW_INPUT_REQUIRED');
  await attest(verifySession,workerSessionId);
  if(lease.workerSessionId!==workerSessionId)throw Error('NV02_RENEW_WRONG_SESSION');
  const q=await ops.renew(db,{resourceScope:lease.resourceScope,workerId:'NV02',
    workerSessionId,leaseId:lease.leaseId,ttlMs});
  if(!q||!same(await ops.read(db,lease.resourceScope),lease.leaseId,
    workerSessionId,Number(lease.workOrder.slice(1))))throw Error('NV02_RENEW_FENCED');
  return {...lease,expiresAt:q.lease_until};
}
export async function releaseNv02WorkOrderAtomic({
  db,issue,lease,workerSessionId,verifySession,postComment,evidenceVerified,
  terminal='BLOCKED',ops=defaultOps
}={}){
  if(!db?.query||!issue||!lease?.claimed||typeof postComment!=='function')
    throw Error('NV02_RELEASE_INPUT_REQUIRED');
  await attest(verifySession,workerSessionId);
  if(lease.workerSessionId!==workerSessionId||Number(issue.number)!==Number(lease.workOrder.slice(1)))
    throw Error('NV02_RELEASE_MISMATCH');
  if(terminal==='DONE'&&evidenceVerified!==true)throw Error('NV02_DONE_EVIDENCE_REQUIRED');
  if(!same(await ops.read(db,lease.resourceScope),lease.leaseId,workerSessionId,issue.number))
    throw Error('NV02_RELEASE_FENCED');
  if(await ops.release(db,{resourceScope:lease.resourceScope,workerId:'NV02',
    workerSessionId,leaseId:lease.leaseId})!==true)throw Error('NV02_RELEASE_FAILED');
  // GitHub comment is audit-only AFTER successful database release.
  await postComment(Number(issue.number),[
    '[TIGERIQ_NV02_ATOMIC_RELEASE_V1]','WORK_ORDER=#'+issue.number,'WORKER=NV02',
    'RESOURCE_SCOPE='+lease.resourceScope,'LEASE_ID='+lease.leaseId,
    'STATE='+terminal,'AUTHORITY=CORE_POSTGRES_ATOMIC_RELEASED'
  ].join('\n'));
  return {released:true,resourceScope:lease.resourceScope,terminal};
}
