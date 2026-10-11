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
// A model-supplied evidenceVerified boolean is NOT an acceptance gate.
// The trusted host must fetch the canonical GitHub comment and pass its raw
// response through this verifier; this module checks the immutable receipt ID,
// scope, lease, worker and explicit acceptance evidence.
export function validateNv02CanonicalDoneEvidence(record,issue,lease){
  const n=Number(issue?.number),id=Number(record?.id);
  const expected='https://github.com/newsdayads/tigeriq-ai-lab/issues/'+n+'#issuecomment-'+id;
  if(!Number.isSafeInteger(n)||n<=0||!Number.isSafeInteger(id)||id<=0||
     String(record?.html_url||'')!==expected)throw Error('NV02_DONE_CANONICAL_SOURCE_INVALID');
  // GitHub metadata must come from the authenticated host's GitHub API readback.
  // A matching marker/lease in text alone is never an authorship attestation.
  if(String(record?.user?.login||'').toLowerCase()!=='newsdayads')
    throw Error('NV02_DONE_PRODUCER_UNVERIFIED');
  const body=String(record?.body||'');
  if(!body.includes('[TIGERIQ_NV02_WORK_EVIDENCE_V1]'))throw Error('NV02_DONE_EVIDENCE_MARKER_MISSING');
  const fields=new Map();
  for(const line of body.split(/\r?\n/)){
    const m=line.trim().match(/^([A-Z_]+)=(.*)$/);
    if(!m)continue;
    if(fields.has(m[1]))throw Error('NV02_DONE_EVIDENCE_DUPLICATE_FIELD');
    fields.set(m[1],m[2].trim());
  }
  const valid=fields.get('WORK_ORDER')==='#'+n&&fields.get('WORKER')==='NV02'&&
    fields.get('RESOURCE_SCOPE')===lease.resourceScope&&fields.get('LEASE_ID')===lease.leaseId&&
    fields.get('RESULT')==='PASS';
  if(!valid)throw Error('NV02_DONE_EVIDENCE_SCOPE_OR_RESULT_INVALID');
  const ref=String(fields.get('EVIDENCE_REF')||'');
  if(!/^https:\/\/github\.com\/newsdayads\/tigeriq-ai-lab\/(pull|issues|commit)\//.test(ref))
    throw Error('NV02_DONE_EVIDENCE_REF_INVALID');
  return{commentId:id,url:expected,evidenceRef:ref,sourceActor:'newsdayads'};
}

export async function releaseNv02WorkOrderAtomic({
  db,issue,lease,workerSessionId,verifySession,postComment,loadCanonicalTerminalEvidence,
  verifyCanonicalAcceptance,terminal='BLOCKED',ops=defaultOps
}={}){
  if(!db?.query||!issue||!lease?.claimed||typeof postComment!=='function')
    throw Error('NV02_RELEASE_INPUT_REQUIRED');
  await attest(verifySession,workerSessionId);
  if(lease.workerSessionId!==workerSessionId||Number(issue.number)!==Number(lease.workOrder.slice(1)))
    throw Error('NV02_RELEASE_MISMATCH');
  let doneEvidence=null;
  if(terminal==='DONE'){
    // This function must be supplied by the authenticated host (GitHub API
    // reader), never from a ChatGPT/GitHub Issue payload.
    if(typeof loadCanonicalTerminalEvidence!=='function')
      throw Error('NV02_DONE_CANONICAL_EVIDENCE_READER_REQUIRED');
    const raw=await loadCanonicalTerminalEvidence({
      issueNumber:Number(issue.number),resourceScope:lease.resourceScope,
      leaseId:lease.leaseId,workerId:'NV02',workerSessionId
    });
    doneEvidence=validateNv02CanonicalDoneEvidence(raw,issue,lease);
    // Separately verify the REAL outcome target and that the authenticated
    // session was the authorized evidence producer. This must be a trusted
    // host-side verifier backed by canonical GitHub + session provenance,
    // NEVER a model-provided evidenceVerified/accepted boolean or Issue field.
    if(typeof verifyCanonicalAcceptance!=='function')
      throw Error('NV02_DONE_TRUSTED_ACCEPTANCE_VERIFIER_REQUIRED');
    const proof=await verifyCanonicalAcceptance({
      canonicalComment:raw,commentId:doneEvidence.commentId,
      evidenceRef:doneEvidence.evidenceRef,issueNumber:Number(issue.number),
      resourceScope:lease.resourceScope,leaseId:lease.leaseId,
      workerId:'NV02',workerSessionId,
    });
    if(proof?.authority!=='TRUSTED_HOST_GITHUB_AND_WORKER_SESSION'||
       proof?.verdict!=='PASS'||proof?.commentId!==doneEvidence.commentId||
       proof?.evidenceRef!==doneEvidence.evidenceRef||
       proof?.issueNumber!==Number(issue.number)||
       proof?.resourceScope!==lease.resourceScope||proof?.leaseId!==lease.leaseId||
       proof?.workerId!=='NV02'||proof?.workerSessionId!==workerSessionId)
      throw Error('NV02_DONE_SOURCE_ACCEPTANCE_UNVERIFIED');
  }
  if(!['DONE','BLOCKED','EXTERNAL_WAIT'].includes(terminal))
    throw Error('NV02_TERMINAL_INVALID');
  const holder={resourceScope:lease.resourceScope,workerId:'NV02',
    workerSessionId,leaseId:lease.leaseId};
  if(!same(await ops.read(db,lease.resourceScope),lease.leaseId,workerSessionId,issue.number))
    throw Error('NV02_RELEASE_FENCED');
  // Renew BEFORE the GitHub write. Until a durable terminal checkpoint exists,
  // never free the global scope for another worker to claim.
  const extended=await ops.renew(db,{...holder,ttlMs:120000});
  if(!extended||!same(await ops.read(db,lease.resourceScope),lease.leaseId,workerSessionId,issue.number))
    throw Error('NV02_TERMINAL_CHECKPOINT_LEASE_LOST');
  await postComment(Number(issue.number),[
    '[TIGERIQ_NV02_TERMINAL_CHECKPOINT_V1]','WORK_ORDER=#'+issue.number,'WORKER=NV02',
    'RESOURCE_SCOPE='+lease.resourceScope,'LEASE_ID='+lease.leaseId,
    'STATE='+terminal,'AUTHORITY=CORE_POSTGRES_ATOMIC_TERMINAL_CHECKPOINT',
    ...(doneEvidence?['EVIDENCE_COMMENT_ID='+doneEvidence.commentId,'EVIDENCE_REF='+doneEvidence.evidenceRef]:[])
  ].join('\n'));
  if(!same(await ops.read(db,lease.resourceScope),lease.leaseId,workerSessionId,issue.number))
    throw Error('NV02_RELEASE_LOST_AFTER_TERMINAL_CHECKPOINT');
  if(await ops.release(db,holder)!==true)throw Error('NV02_RELEASE_FAILED');
  // This second comment is audit-only; if it fails, DB ownership was released
  // but the terminal checkpoint is already durable. Never claim false rollback.
  try{
    await postComment(Number(issue.number),[
      '[TIGERIQ_NV02_ATOMIC_RELEASE_V1]','WORK_ORDER=#'+issue.number,'WORKER=NV02',
      'RESOURCE_SCOPE='+lease.resourceScope,'LEASE_ID='+lease.leaseId,
      'STATE='+terminal,'AUTHORITY=CORE_POSTGRES_ATOMIC_RELEASED'
    ].join('\n'));
    return {released:true,resourceScope:lease.resourceScope,terminal,releaseAuditRecorded:true};
  }catch{
    return {released:true,resourceScope:lease.resourceScope,terminal,
      releaseAuditRecorded:false,reason:'RELEASE_AUDIT_WRITE_FAILED'};
  }
}
