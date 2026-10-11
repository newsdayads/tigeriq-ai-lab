import test from 'node:test';
import assert from 'node:assert/strict';
import {createGithubScopeWorkerApi,validateGithubWorkerIssue} from './github-scope-worker-api.mjs';
const canary={number:4653,state:'open',title:'[P5][NV03] Canary',
  body:'TIGERIQ_EXECUTABLE=true\nAUTO_QUEUE=INCLUDED\nPRIORITY=P5\nCAPABILITY=review\nTARGET_EMPLOYEE=NV03\nRESOURCE_SCOPE=NV03_GITHUB_CLAIM_ACCEPTANCE_20261010\nOWNER_POLICY=AUTO\nNO_DIRECT_MAIN=true\nNO_PAID_COST=true\nNO_CREDENTIAL_CHANGE=true\nNO_SECURITY_BOUNDARY_CHANGE=true\nNO_DESTRUCTIVE=true\nNO_PRODUCTION_RELEASE=true'};
const scope='NV03_GITHUB_CLAIM_ACCEPTANCE_20261010',session='NV03-SESSION-CANARY-20261011';
const secret='S'.repeat(48),secret2='K'.repeat(48);
const db={query:async()=>({}),connect:async()=>({})};
function makeMock(){
  const holder=new Map();
  const ops={
    claim:async(_,x)=>{
      if(holder.has(x.resourceScope))return {acquired:false,reason:'SCOPE_HELD'};
      const lease={lease_id:'00000000-0000-4000-8000-000000000001',lease_until:'2026-10-12T00:00:00Z',
        worker_id:x.workerId,worker_session_id:x.workerSessionId};
      holder.set(x.resourceScope,lease);return {acquired:true,lease};
    },
    read:async(_,scope)=>holder.get(scope)||null,
    renew:async(_,x)=>{
      const l=holder.get(x.resourceScope);
      return l&&l.lease_id===x.leaseId&&l.worker_id===x.workerId&&l.worker_session_id===x.workerSessionId
        ?{lease_until:l.lease_until}:null;
    },
    release:async(_,x)=>{
      const l=holder.get(x.resourceScope);
      if(!l||l.lease_id!==x.leaseId||l.worker_id!==x.workerId||l.worker_session_id!==x.workerSessionId)return false;
      holder.delete(x.resourceScope);return true;
    },
  };
  return {holder,ops};
}
async function request(handler,{
  action='claim',method='POST',workerId='NV03',workerSessionId=session,
  token=secret,remoteAddress='127.0.0.1',data={resourceScope:scope,issueNumber:4653},urlSearch=''
}={}){
  const req={method,socket:{remoteAddress},headers:{
    'x-tigeriq-worker-id':workerId,'x-tigeriq-worker-session-id':workerSessionId,
    authorization:'Bearer '+token},
    async *[Symbol.asyncIterator](){yield Buffer.from(JSON.stringify(data));}};
  let status=null,parsed=null;
  const res={writeHead(code){status=code;},end(text){parsed=JSON.parse(text);}};
  await handler(req,res,new URL('http://127.0.0.1/api/github-scope-worker/'+action+urlSearch));
  return {status,body:parsed};
}
const build=(mock,config={})=>createGithubScopeWorkerApi({pool:db,
  configByWorker:config,
  fetchCanonicalIssue:async()=>canary,ops:mock.ops});
const profiles={NV03:{secret,sessionId:session},NV02:{secret:secret2,sessionId:'NV02-SESSION-CANARY-20261011'}};
test('claim endpoint disabled with missing per-worker identity',async()=>{
  const api=build(makeMock());
  const r=await request(api);
  assert.equal(r.status,503);assert.equal(r.body.error,'WORKER_SESSION_NOT_PROVISIONED');
});
test('rejects requests from nonloopback hosts, incorrect token and wrong session',async()=>{
  const api=build(makeMock(),profiles);
  assert.equal((await request(api,{remoteAddress:'10.1.2.3'})).status,403);
  assert.equal((await request(api,{token:'wrong'})).status,401);
  assert.equal((await request(api,{workerSessionId:'ANOTHER-SESSION-20261011'})).status,401);
});
test('rejects P0, owner hold and unauthorized NV03 review',()=>{
  assert.throws(()=>validateGithubWorkerIssue({...canary,title:'[P0] Forbidden'},'NV03',scope),/P0_OR_PRIORITY_UNVERIFIED/);
  assert.throws(()=>validateGithubWorkerIssue({...canary,body:canary.body+'\nOWNER_HOLD=true'},'NV03',scope),/OWNER_OR_SECURITY_HOLD/);
  assert.throws(()=>validateGithubWorkerIssue({...canary,body:canary.body.replace('NO_PRODUCTION_RELEASE=true','')},'NV03',scope),/ISSUE_HARD_GATE_MISSING/);
  assert.throws(()=>validateGithubWorkerIssue({...canary,body:canary.body.replace('TARGET_EMPLOYEE=NV03','TARGET_EMPLOYEE=NV04')},'NV03',scope),/TARGET_DENIED/);
});
test('authenticated claim yields one winner; foreign release fails and real owner can release',async()=>{
  const mock=makeMock(),api=build(mock,profiles);
  let r=await request(api);
  assert.equal(r.status,200);assert.equal(r.body.acquired,true);
  r=await request(api);assert.equal(r.status,409);
  r=await request(api,{action:'release',workerId:'NV02',workerSessionId:profiles.NV02.sessionId,
    token:secret2,data:{resourceScope:scope,leaseId:'00000000-0000-4000-8000-000000000001'}});
  assert.equal(r.status,409);
  r=await request(api,{action:'read',method:'GET',urlSearch:'?resourceScope='+encodeURIComponent(scope)});
  assert.equal(r.status,200);assert.equal(r.body.mine,true);
  r=await request(api,{action:'release',data:{resourceScope:scope,leaseId:'00000000-0000-4000-8000-000000000001'}});
  assert.equal(r.status,200);assert.equal(mock.holder.size,0);
});
test('failed canonical source verification cannot mint lease',async()=>{
  const mock=makeMock();const api=createGithubScopeWorkerApi({pool:db,configByWorker:profiles,
    fetchCanonicalIssue:async()=>({...canary,state:'closed'}),ops:mock.ops});
  const r=await request(api);assert.equal(r.status,409);assert.equal(mock.holder.size,0);
});
