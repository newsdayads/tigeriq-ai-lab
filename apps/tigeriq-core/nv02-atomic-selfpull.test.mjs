import test from 'node:test';
import assert from 'node:assert/strict';
import {claimNv02WorkOrderAtomic,renewNv02WorkOrderAtomic,releaseNv02WorkOrderAtomic,validateNv02CanonicalDoneEvidence} from './nv02-atomic-selfpull.mjs';

const session='NV02-session-20261011';
const issue={number:4653,title:'[P2] Atomic claim test',state:'open',
  body:'TIGERIQ_EXECUTABLE=true\nAUTO_QUEUE=INCLUDED\nCAPABILITY=general\nPRIORITY=P2\nRESOURCE_SCOPE=NV02_ATOMIC_TEST'};
const db={query:async()=>({rows:[]}),connect:async()=>({query:async()=>({rows:[]}),release(){}})};
const verifySession=async({workerId,workerSessionId})=>({attested:true,workerId,workerSessionId});
function fixture(options={}){
  const holders=new Map(),comments=[];
  let serial=0;
  const ops={
    async acquire(_,x){
      if(holders.has(x.resourceScope))return {acquired:false,reason:'SCOPE_HELD'};
      const row={lease_id:'00000000-0000-4000-8000-'+String(++serial).padStart(12,'0'),
        resource_scope:x.resourceScope,worker_id:x.workerId,worker_session_id:x.workerSessionId,
        issue_number:x.issueNumber,lease_until:'2026-10-12T00:00:00Z'};
      holders.set(x.resourceScope,row);return {acquired:true,lease:row};
    },
    async read(_,scope){return holders.get(scope)||null;},
    async renew(_,x){
      const h=holders.get(x.resourceScope);
      if(!h||h.lease_id!==x.leaseId||h.worker_session_id!==x.workerSessionId)return null;
      h.lease_until='2026-10-12T01:00:00Z';return {lease_until:h.lease_until};
    },
    async release(_,x){
      const h=holders.get(x.resourceScope);
      if(!h||h.lease_id!==x.leaseId||h.worker_session_id!==x.workerSessionId)return false;
      holders.delete(x.resourceScope);return true;
    }
  };
  const postComment=async(n,body)=>{
    if(options.failComment||options.failReleaseComment&&body.includes('[TIGERIQ_NV02_ATOMIC_RELEASE_V1]'))
      throw Error('GITHUB_WRITE_FAILED');
    comments.push({issue:n,body});return true;
  };
  return {db,ops,holders,comments,postComment,verifySession,
    loadCurrentIssue:async()=>options.updatedIssue||issue};
}
const args=(f)=>({db,issue,workerSessionId:session,verifySession,
  loadCurrentIssue:f.loadCurrentIssue,postComment:f.postComment,ops:f.ops});

function canonicalDoneEvidence(lease){
  const id=6101234567;
  return {id,html_url:'https://github.com/newsdayads/tigeriq-ai-lab/issues/'+issue.number+'#issuecomment-'+id,
    body:['[TIGERIQ_NV02_WORK_EVIDENCE_V1]','WORK_ORDER=#'+issue.number,'WORKER=NV02',
      'RESOURCE_SCOPE='+lease.resourceScope,'LEASE_ID='+lease.leaseId,
      'RESULT=PASS','EVIDENCE_REF=https://github.com/newsdayads/tigeriq-ai-lab/pull/4660'].join('\n')};
}

test('requires independent worker session verification before any claim',async()=>{
  const f=fixture();
  await assert.rejects(()=>claimNv02WorkOrderAtomic({...args(f),verifySession:undefined}),/ATTESTATION_REQUIRED/);
  await assert.rejects(()=>claimNv02WorkOrderAtomic({...args(f),verifySession:async()=>({attested:false})}),/NOT_ATTESTED/);
  assert.equal(f.holders.size,0);assert.equal(f.comments.length,0);
});
test('NV02 atomic claim has durable owner readback, not comment-only election',async()=>{
  const f=fixture();
  const a=await claimNv02WorkOrderAtomic(args(f));
  assert.equal(a.claimed,true);
  assert.match(f.comments[0].body,/AUTHORITY=CORE_POSTGRES_ATOMIC/);
  assert.equal((await claimNv02WorkOrderAtomic(args(f))).reason,'SCOPE_HELD');
  assert.equal(f.holders.size,1);
});
test('release is bound to session; DONE requires verified terminal evidence',async()=>{
  const f=fixture();
  const a=await claimNv02WorkOrderAtomic(args(f));
  await assert.rejects(()=>releaseNv02WorkOrderAtomic({db,issue,lease:a,
    workerSessionId:'NV02-foreign-session',verifySession,postComment:f.postComment,ops:f.ops}),/RELEASE_MISMATCH/);
  await assert.rejects(()=>releaseNv02WorkOrderAtomic({db,issue,lease:a,workerSessionId:session,
    verifySession,postComment:f.postComment,ops:f.ops,terminal:'DONE',evidenceVerified:true}),/DONE_CANONICAL_EVIDENCE_READER_REQUIRED/);
  const result=await releaseNv02WorkOrderAtomic({db,issue,lease:a,workerSessionId:session,
    verifySession,postComment:f.postComment,ops:f.ops,terminal:'DONE',
    loadCanonicalTerminalEvidence:async()=>canonicalDoneEvidence(a)});
  assert.equal(result.released,true);
  assert.equal(result.releaseAuditRecorded,true);
  assert.equal(f.holders.size,0);
  assert.match(f.comments.at(-2).body,/TIGERIQ_NV02_TERMINAL_CHECKPOINT_V1/);
  assert.match(f.comments.at(-1).body,/CORE_POSTGRES_ATOMIC_RELEASED/);
});
test('terminal checkpoint is committed while still holding the global lease',async()=>{
  const f=fixture();const a=await claimNv02WorkOrderAtomic(args(f));
  const write=async(n,body)=>{
    if(body.includes('[TIGERIQ_NV02_TERMINAL_CHECKPOINT_V1]'))assert.equal(f.holders.size,1);
    if(body.includes('[TIGERIQ_NV02_ATOMIC_RELEASE_V1]'))assert.equal(f.holders.size,0);
    return f.postComment(n,body);
  };
  const r=await releaseNv02WorkOrderAtomic({db,issue,lease:a,workerSessionId:session,
    verifySession,postComment:write,ops:f.ops,terminal:'DONE',
    loadCanonicalTerminalEvidence:async()=>canonicalDoneEvidence(a)});
  assert.equal(r.released,true);
});
test('failed terminal checkpoint retains lease, preventing duplicate claim',async()=>{
  const f=fixture();const a=await claimNv02WorkOrderAtomic(args(f));
  await assert.rejects(()=>releaseNv02WorkOrderAtomic({db,issue,lease:a,workerSessionId:session,
    verifySession,postComment:async()=>{throw Error('GITHUB_WRITE_FAILED')},ops:f.ops}),/GITHUB_WRITE_FAILED/);
  assert.equal(f.holders.size,1);
});
test('failed secondary release audit cannot falsely rollback an already released lease',async()=>{
  const f=fixture({failReleaseComment:true});const a=await claimNv02WorkOrderAtomic(args(f));
  const r=await releaseNv02WorkOrderAtomic({db,issue,lease:a,workerSessionId:session,
    verifySession,postComment:f.postComment,ops:f.ops});
  assert.equal(r.released,true);
  assert.equal(r.releaseAuditRecorded,false);
  assert.equal(r.reason,'RELEASE_AUDIT_WRITE_FAILED');
  assert.equal(f.holders.size,0);
  assert.match(f.comments.at(-1).body,/TIGERIQ_NV02_TERMINAL_CHECKPOINT_V1/);
});
test('unrecognized terminal states are rejected without releasing the scope',async()=>{
  const f=fixture();const a=await claimNv02WorkOrderAtomic(args(f));
  await assert.rejects(()=>releaseNv02WorkOrderAtomic({db,issue,lease:a,workerSessionId:session,
    verifySession,postComment:f.postComment,ops:f.ops,terminal:'APPROVED'}),/NV02_TERMINAL_INVALID/);
  assert.equal(f.holders.size,1);
});
test('caller-supplied DONE boolean cannot bypass canonical GitHub evidence readback',async()=>{
  const f=fixture();const a=await claimNv02WorkOrderAtomic(args(f));
  await assert.rejects(()=>releaseNv02WorkOrderAtomic({db,issue,lease:a,workerSessionId:session,
    verifySession,postComment:f.postComment,ops:f.ops,terminal:'DONE',evidenceVerified:true}),
    /DONE_CANONICAL_EVIDENCE_READER_REQUIRED/);
  const spoof=canonicalDoneEvidence(a);spoof.body=spoof.body.replace('RESOURCE_SCOPE='+a.resourceScope,'RESOURCE_SCOPE=WRONG_SCOPE');
  await assert.rejects(()=>releaseNv02WorkOrderAtomic({db,issue,lease:a,workerSessionId:session,
    verifySession,postComment:f.postComment,ops:f.ops,terminal:'DONE',
    loadCanonicalTerminalEvidence:async()=>spoof}),/DONE_EVIDENCE_SCOPE_OR_RESULT_INVALID/);
  assert.equal(f.holders.size,1);
});
test('DONE evidence requires canonical GitHub ID, unique fields and valid receipt URL',async()=>{
  const f=fixture();const a=await claimNv02WorkOrderAtomic(args(f));
  const bad=canonicalDoneEvidence(a);bad.html_url='https://evil.invalid/comment/'+bad.id;
  await assert.rejects(()=>releaseNv02WorkOrderAtomic({db,issue,lease:a,workerSessionId:session,
    verifySession,postComment:f.postComment,ops:f.ops,terminal:'DONE',
    loadCanonicalTerminalEvidence:async()=>bad}),/DONE_CANONICAL_SOURCE_INVALID/);
  const duplicate=canonicalDoneEvidence(a);duplicate.body+='\nRESULT=PASS';
  await assert.rejects(()=>releaseNv02WorkOrderAtomic({db,issue,lease:a,workerSessionId:session,
    verifySession,postComment:f.postComment,ops:f.ops,terminal:'DONE',
    loadCanonicalTerminalEvidence:async()=>duplicate}),/DONE_EVIDENCE_DUPLICATE_FIELD/);
  assert.equal(f.holders.size,1);
});
test('lease renew is fenced by worker session ownership',async()=>{
  const f=fixture();const a=await claimNv02WorkOrderAtomic(args(f));
  await assert.rejects(()=>renewNv02WorkOrderAtomic({db,lease:a,workerSessionId:'NV02-foreign-session',
    verifySession,ops:f.ops}),/WRONG_SESSION/);
  const renewed=await renewNv02WorkOrderAtomic({db,lease:a,workerSessionId:session,
    verifySession,ops:f.ops});
  assert.equal(renewed.expiresAt,'2026-10-12T01:00:00Z');
});
test('GitHub comment failure releases real DB lease before returning error',async()=>{
  const f=fixture({failComment:true});
  await assert.rejects(()=>claimNv02WorkOrderAtomic(args(f)),/GITHUB_WRITE_FAILED/);
  assert.equal(f.holders.size,0);
});
test('drifting canonical issue rejects atomic claim before opening a lease',async()=>{
  const f=fixture({updatedIssue:{...issue,body:issue.body.replace('NV02_ATOMIC_TEST','CHANGED_SCOPE')}});
  await assert.rejects(()=>claimNv02WorkOrderAtomic(args(f)),/SOURCE_AUTHORITY_INVALID|SOURCE_REVISION_CHANGED/);
  assert.equal(f.holders.size,0);
});

test('legacy advisory readers recognize new atomic receipt and release markers',async()=>{
  const {activeResourceClaims}=await import('./nv02-local-self-pull.mjs');
  const now=Date.parse('2026-10-11T04:00:00Z');
  const claim={id:1,body:'[TIGERIQ_NV02_ATOMIC_LEASE_V1]\nLEASE_ID=00000000-0000-4000-8000-000000000001\nWORKER=NV02\nRESOURCE_SCOPE=ATOMIC_SHARED\nLEASE_UNTIL=2026-10-12T00:00:00Z'};
  const release={id:2,body:'[TIGERIQ_NV02_ATOMIC_RELEASE_V1]\nLEASE_ID=00000000-0000-4000-8000-000000000001\nWORKER=NV02\nRESOURCE_SCOPE=ATOMIC_SHARED'};
  assert.equal(activeResourceClaims([claim],now).length,1);
  assert.equal(activeResourceClaims([claim,release],now).length,0);
});

const rawReceiptIssue={number:4653};
const rawReceiptLease={resourceScope:'NV02_ATOMIC_TEST',leaseId:'00000000-0000-4000-8000-000000000001'};
const rawReceiptId=6101234567;
const rawReceiptUrl='https://github.com/newsdayads/tigeriq-ai-lab/issues/4653#issuecomment-'+rawReceiptId;
const rawReceiptLines=['[TIGERIQ_NV02_WORK_EVIDENCE_V1]','WORK_ORDER=#4653','WORKER=NV02',
  'RESOURCE_SCOPE=NV02_ATOMIC_TEST','LEASE_ID='+rawReceiptLease.leaseId,'RESULT=PASS',
  'EVIDENCE_REF=https://github.com/newsdayads/tigeriq-ai-lab/pull/4660'];
const rawReceipt=body=>({id:rawReceiptId,html_url:rawReceiptUrl,body});

test('real GitHub REST LF comments are parsed at byte level',()=>{
  const body=rawReceiptLines.join(String.fromCharCode(10));
  assert.equal(Buffer.from(body).includes(10),true);
  assert.equal(validateNv02CanonicalDoneEvidence(rawReceipt(body),rawReceiptIssue,rawReceiptLease).commentId,rawReceiptId);
});
test('real GitHub REST CRLF comments are parsed at byte level',()=>{
  const body=rawReceiptLines.join(String.fromCharCode(13,10));
  assert.equal(Buffer.from(body).includes(13),true);
  assert.equal(validateNv02CanonicalDoneEvidence(rawReceipt(body),rawReceiptIssue,rawReceiptLease).commentId,rawReceiptId);
});
test('escaped literal backslash-n is NOT accepted as canonical line breaks',()=>{
  const body=rawReceiptLines.join(String.fromCharCode(92,110));
  assert.equal(Buffer.from(body).includes(10),false);
  assert.throws(()=>validateNv02CanonicalDoneEvidence(rawReceipt(body),rawReceiptIssue,rawReceiptLease),/EVIDENCE_SCOPE_OR_RESULT_INVALID/);
});
test('duplicate raw GitHub fields reject DONE receipt',()=>{
  assert.throws(()=>validateNv02CanonicalDoneEvidence(rawReceipt([...rawReceiptLines,'RESULT=PASS'].join(String.fromCharCode(10))),
    rawReceiptIssue,rawReceiptLease),/EVIDENCE_DUPLICATE_FIELD/);
});
test('wrong scope, lease and evidence host reject DONE receipt',()=>{
  for(const variant of [
    rawReceiptLines.map(x=>x.startsWith('RESOURCE_SCOPE=')?'RESOURCE_SCOPE=WRONG':x),
    rawReceiptLines.map(x=>x.startsWith('LEASE_ID=')?'LEASE_ID=00000000-0000-4000-8000-000000000099':x),
    rawReceiptLines.map(x=>x.startsWith('EVIDENCE_REF=')?'EVIDENCE_REF=https://evil.invalid/no':x),
  ])assert.throws(()=>validateNv02CanonicalDoneEvidence(rawReceipt(variant.join(String.fromCharCode(10))),
    rawReceiptIssue,rawReceiptLease),/INVALID/);
});
test('wrong canonical GitHub URL or comment ID rejects DONE receipt',()=>{
  const body=rawReceiptLines.join(String.fromCharCode(10));
  assert.throws(()=>validateNv02CanonicalDoneEvidence({...rawReceipt(body),html_url:'https://evil.invalid'},rawReceiptIssue,rawReceiptLease),/CANONICAL_SOURCE_INVALID/);
  assert.throws(()=>validateNv02CanonicalDoneEvidence({...rawReceipt(body),id:0},rawReceiptIssue,rawReceiptLease),/CANONICAL_SOURCE_INVALID/);
});
