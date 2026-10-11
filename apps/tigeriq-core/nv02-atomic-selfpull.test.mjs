import test from 'node:test';
import assert from 'node:assert/strict';
import {claimNv02WorkOrderAtomic,renewNv02WorkOrderAtomic,releaseNv02WorkOrderAtomic} from './nv02-atomic-selfpull.mjs';

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
    if(options.failComment)throw Error('GITHUB_WRITE_FAILED');
    comments.push({issue:n,body});return true;
  };
  return {db,ops,holders,comments,postComment,verifySession,
    loadCurrentIssue:async()=>options.updatedIssue||issue};
}
const args=(f)=>({db,issue,workerSessionId:session,verifySession,
  loadCurrentIssue:f.loadCurrentIssue,postComment:f.postComment,ops:f.ops});

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
    verifySession,postComment:f.postComment,ops:f.ops,terminal:'DONE'}),/DONE_EVIDENCE_REQUIRED/);
  const result=await releaseNv02WorkOrderAtomic({db,issue,lease:a,workerSessionId:session,
    verifySession,postComment:f.postComment,ops:f.ops,terminal:'DONE',evidenceVerified:true});
  assert.equal(result.released,true);
  assert.equal(f.holders.size,0);
  assert.match(f.comments.at(-1).body,/CORE_POSTGRES_ATOMIC_RELEASED/);
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
