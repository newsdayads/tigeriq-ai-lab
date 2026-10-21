import test from 'node:test';
import assert from 'node:assert/strict';
import { locateOwnerCanaryRun, inspectDiscoveredOwnerCanary, RunLocatorError } from './apify-existing-run-locator.mjs';

const env = { APIFY_TOKEN:'SYNTHETIC_SECRET_NO_LOG', APIFY_READONLY_EXECUTE:'OWNER_APPROVED_EXISTING_RUN_READ' };
const actor={id:'ACTOR12345',username:'tigeriq',name:'tigeriq-ai-lab',isPublic:false,actorPermissionLevel:'LIMITED_PERMISSIONS'};
const row=(opts={})=>({id:'RUN1234567',actId:actor.id,status:'SUCCEEDED',startedAt:'2026-10-08T03:00:00.000Z',finishedAt:'2026-10-08T03:00:02.000Z',buildNumber:'0.0.4',buildId:'BUILD12345',defaultKeyValueStoreId:'STORE12345',stats:{computeUnits:0.002},usageTotalUsd:0.0004,...opts});
const list=(items=[row()],opts={})=>({total:items.length,offset:0,count:items.length,items,...opts});
const output={
  schemaVersion:'1.0',status:'success',requestedUrl:'https://example.com/',
  pages:[{url:'https://example.com/',statusCode:200}],
  metrics:{pagesAudited:1,errorCount:0},errors:[],
  summary:{titlePresent:true},
};
function mock({actorData=actor,runList=list(),run=row(),storeOutput=output,responses={}}={}){
  const calls=[];
  const fetchFn=async (url,opts)=>{
    calls.push({url,opts});
    assert.equal(opts.method,'GET');assert.equal(opts.redirect,'error');
    assert.equal(opts.cache,'no-store');
    assert.equal(opts.headers.authorization,'Bearer '+env.APIFY_TOKEN);
    assert.equal(url.startsWith('https://api.apify.com/v2/'),true);
    if (url.endsWith('/actors/tigeriq~tigeriq-ai-lab')) return responses.actor??Response.json({data:actorData});
    if(url.includes('/actors/ACTOR12345/runs?'))return responses.list??Response.json({data:runList});
    if(url.endsWith('/actors/ACTOR12345'))return Response.json({data:actorData});
    if(url.endsWith('/actor-runs/RUN1234567'))return Response.json({data:run});
    if(url.endsWith('/key-value-stores/STORE12345/records/OUTPUT'))return Response.json(storeOutput);
    throw Error('UNEXPECTED_ENDPOINT');
  };
  return { calls, fetchFn };
}
async function refuses(code,opts={},override=env){
  const m=mock(opts);
  await assert.rejects(locateOwnerCanaryRun({env:override,fetchFn:m.fetchFn}),e=>e instanceof RunLocatorError&&e.code===code);
  return m.calls;
}

test('R04 locator performs only two bounded GET requests, exact date window and opaque run',async()=>{
 const m=mock();const p=await locateOwnerCanaryRun({env,fetchFn:m.fetchFn});
 assert.equal(p.actorId,actor.id);assert.equal(p.runId,'RUN1234567');assert.equal(p.requests,2);
 assert.equal(m.calls.length,2);
 const u=new URL(m.calls[1].url);
 assert.equal(u.pathname,'/v2/actors/ACTOR12345/runs');
 assert.equal(u.searchParams.get('startedAfter'),'2026-10-07T17:00:00.000Z');
 assert.equal(u.searchParams.get('startedBefore'),'2026-10-08T16:59:59.999Z');
 assert.equal(u.searchParams.get('limit'),'50');assert.equal(u.searchParams.get('offset'),'0');
 assert.doesNotMatch(m.calls.map(c=>c.url).join(' '),/token|run-sync|builds|\/runs\?token/i);
});
test('R04 locator refuses missing execute gate before network',async()=>{assert.equal((await refuses('READONLY_GATE_REQUIRED',{}, {...env,APIFY_READONLY_EXECUTE:undefined})).length,0)});
test('R04 locator refuses missing token before network',async()=>{assert.equal((await refuses('SCOPED_TOKEN_REQUIRED',{}, {...env,APIFY_TOKEN:''})).length,0)});
test('R04 locator rejects unrelated Actor handle and wrong private permission',async()=>{
 assert.equal((await refuses('ACTOR_IDENTITY_MISMATCH',{actorData:{...actor,name:'other'}})).length,1);
 assert.equal((await refuses('ACTOR_NOT_PRIVATE',{actorData:{...actor,isPublic:true}})).length,1);
 assert.equal((await refuses('ACTOR_PERMISSION_SCOPE_NOT_LIMITED',{actorData:{...actor,actorPermissionLevel:'FULL_PERMISSIONS'}})).length,1);
});
test('R04 locator refuses more than 50 rows and truncated result, no misleading acceptance',async()=>{
 assert.equal((await refuses('RUN_LIST_INCOMPLETE',{runList:list([row()],{total:51})})).length,2);
 assert.equal((await refuses('RUN_LIST_INCOMPLETE',{runList:list([row()],{total:2})})).length,2);
});
test('R04 locator refuses missing, wrong-date, wrong-Actor or malformed run rows',async()=>{
 assert.equal((await refuses('OCT08_CANARY_NOT_FOUND',{runList:list([])})).length,2);
 assert.equal((await refuses('RUN_LIST_DATE_MISMATCH',{runList:list([row({startedAt:'2026-10-09T03:00:00Z'})])})).length,2);
 assert.equal((await refuses('RUN_LIST_IDENTITY_UNVERIFIED',{runList:list([row({actId:'SOMEOTHER'})])})).length,2);
 assert.equal((await refuses('RUN_LIST_IDENTITY_UNVERIFIED',{runList:list([row({id:'not/opaque'})])})).length,2);
});
test('R04 locator rejects timezone-less and date-only run list rows',async()=>{
 for (const startedAt of ['2026-10-08', '2026-10-08T03:00:00', '2026-10-08T03:00:00+99:00']) {
  const calls=await refuses('RUN_LIST_IDENTITY_UNVERIFIED',{runList:list([row({startedAt})])});
  assert.equal(calls.length,2,startedAt);
 }
});
test('R04 locator accepts the same absolute instant with explicit Vietnam offset',async()=>{
 const m=mock({runList:list([row({startedAt:'2026-10-08T10:00:00+07:00'})])});
 const x=await locateOwnerCanaryRun({env,fetchFn:m.fetchFn});
 assert.equal(x.runId,'RUN1234567');assert.equal(m.calls.length,2);
});
test('R04 locator refuses wrong build instead of guessing latest',async()=>{
 assert.equal((await refuses('OCT08_CANARY_NOT_FOUND',{runList:list([row({buildNumber:'0.0.5'})])})).length,2);
});
test('R04 locator rejects absent or nonopaque candidate build IDs before detail GET',async()=>{
 for(const buildId of [undefined,null,{},'','bad/build']){
  const calls=await refuses('RUN_BUILD_ID_UNVERIFIED',{runList:list([row({buildId})])});
  assert.equal(calls.length,2);
 }
});
test('R04 locator rejects two Oct-08 candidate runs as ambiguous',async()=>{
 assert.equal((await refuses('OCT08_CANARY_AMBIGUOUS',{runList:list([row(),row({id:'RUN5555555'})])})).length,2);
});
test('R04 locator permits one matching Oct-08 run among other builds',async()=>{
 const m=mock({runList:list([row(),row({id:'RUN5555555',buildNumber:'0.0.5'})])});
 const r=await locateOwnerCanaryRun({env,fetchFn:m.fetchFn});
 assert.equal(r.runId,'RUN1234567');assert.equal(m.calls.length,2);
});
test('R04 locator rejects redirects and unauthorized private Actor reads',async()=>{
 assert.equal((await refuses('APIFY_REDIRECT_BLOCKED',{responses:{actor:new Response(null,{status:302,headers:{location:'https://bad.example/'}})}})).length,1);
 assert.equal((await refuses('SCOPED_READ_DENIED',{responses:{actor:Response.json({error:'forbidden'},{status:403})}})).length,1);
});
test('R04 locator rejects non-JSON response',async()=>{
 assert.equal((await refuses('JSON_CONTENT_TYPE_REQUIRED',{responses:{actor:new Response('<html>',{headers:{'content-type':'text/html'}})}})).length,1);
});
test('R04 locator rejects network exceptions without leaking credentials',async()=>{
 await assert.rejects(locateOwnerCanaryRun({env,fetchFn:async()=>{throw Error(env.APIFY_TOKEN)}}),e=>e.code==='APIFY_FETCH_FAILED'&&!String(e).includes(env.APIFY_TOKEN));
});

test('R04 full locator runs the already-merged exact-ID, output and cost guards: six GET',async()=>{
 const m=mock();const e=await inspectDiscoveredOwnerCanary({env,fetchFn:m.fetchFn,now:()=>new Date('2026-10-16T03:00:00Z')});
 assert.equal(e.actor.handle,'tigeriq/tigeriq-ai-lab');
 assert.equal(e.run.buildNumber,'0.0.4');
 assert.equal(e.run.computeUnits,0.002);assert.equal(e.run.usageTotalUsd,0.0004);
 assert.equal(e.discovery.discoveryGetRequests,2);assert.equal(e.action.requests,6);
 assert.equal(e.acceptance.platformFinalInvoiceVerified,false);
 assert.equal(e.cost.zeroCostClaim,false);assert.equal(m.calls.length,6);
 for(const {url,opts} of m.calls){assert.equal(opts.method,'GET');assert.equal(opts.redirect,'error');assert.doesNotMatch(url,/run-sync|\/builds|token=/)}
 assert.doesNotMatch(JSON.stringify(e),/SYNTHETIC_SECRET_NO_LOG|example\.com/);
});
test('R04 accepts Apify nullable usage cost for run identity, but never verifies R05',async()=>{
 const m=mock({run:{...row(),usageTotalUsd:null}});
 const e=await inspectDiscoveredOwnerCanary({env,fetchFn:m.fetchFn,now:()=>new Date('2026-10-16T03:00:00Z')});
 assert.equal(e.acceptance.historicalRunMatched,true);
 assert.equal(e.run.status,'SUCCEEDED');
 assert.equal(e.output.schemaVersion,'1.0');
 assert.equal(e.run.computeUnits,0.002);
 assert.equal(e.run.usageTotalUsd,null);
 assert.equal(e.cost.source,'APIFY_API_USAGE_MISSING_NOT_FINAL_INVOICE');
 assert.equal(e.cost.ownerBillingConfirmed,false);
 assert.equal(e.cost.zeroCostClaim,false);
 assert.equal(e.acceptance.platformFinalInvoiceVerified,false);
 assert.equal(m.calls.length,6);
 assert.ok(m.calls.every(call=>call.opts.method==='GET'));
});
test('R04 nullable usage exception never accepts invalid negative cost',async()=>{
 const m=mock({run:{...row(),usageTotalUsd:-1}});
 await assert.rejects(inspectDiscoveredOwnerCanary({env,fetchFn:m.fetchFn,now:()=>new Date('2026-10-16T03:00:00Z')}),
  e=>e.code==='APIFY_USAGE_UNVERIFIED');
 assert.equal(m.calls.length,4);
});

test('R04 locator detail must preserve exact candidate build ID even with identical build number',async()=>{
 const m=mock({run:{...row(),buildId:'BUILDDETAIL999'}});
 await assert.rejects(inspectDiscoveredOwnerCanary({env,fetchFn:m.fetchFn,now:()=>new Date('2026-10-16T03:00:00Z')}),
  e=>e.code==='RUN_LIST_DETAIL_BUILD_ID_MISMATCH');
 assert.equal(m.calls.length,5);
});
test('R04 rejects same-day list/detail startedAt or finishedAt drift before accepting canary',async()=>{
 for (const change of [
  {startedAt:'2026-10-08T02:59:00.000Z'},
  {finishedAt:'2026-10-08T03:00:03.000Z'},
 ]) {
  const m=mock({runList:list([row(change)])});
  await assert.rejects(inspectDiscoveredOwnerCanary({
   env,fetchFn:m.fetchFn,now:()=>new Date('2026-10-16T03:00:00Z'),
  }),e=>e instanceof RunLocatorError&&e.code==='RUN_LIST_DETAIL_TIMESTAMP_DRIFT');
  assert.equal(m.calls.length,6,'only the existing six read-only GETs');
 }
});
test('R04 compares list/detail instants, accepting equivalent Vietnam offset timestamps',async()=>{
 const m=mock({runList:list([row({
  startedAt:'2026-10-08T10:00:00+07:00',
  finishedAt:'2026-10-08T10:00:02+07:00',
 })])});
 const e=await inspectDiscoveredOwnerCanary({
  env,fetchFn:m.fetchFn,now:()=>new Date('2026-10-16T03:00:00Z'),
 });
 assert.equal(e.acceptance.historicalRunMatched,true);
 assert.equal(m.calls.length,6);
});
test('R04 rejects missing, malformed or reversed candidate finishedAt before detail requests',async()=>{
 for(const finishedAt of [undefined,null,'not-an-instant','2026-10-08T02:59:59.000Z']){
  const m=mock({runList:list([row({finishedAt})])});
  await assert.rejects(locateOwnerCanaryRun({env,fetchFn:m.fetchFn}),
   e=>e instanceof RunLocatorError&&e.code==='RUN_LIST_TIMESTAMPS_UNVERIFIED');
  assert.equal(m.calls.length,2);
 }
});

test('R04 full locator reuses exact output URL check; rejects wrong output in last GET',async()=>{
 const m=mock({storeOutput:{...output,requestedUrl:'https://wrong.example/'}});
 await assert.rejects(inspectDiscoveredOwnerCanary({env,fetchFn:m.fetchFn,now:()=>new Date('2026-10-16T03:00:00Z')}),e=>e.code==='HISTORICAL_REQUESTED_URL_MISMATCH');
 assert.equal(m.calls.length,6);
});
test('R04 full locator refuses actor/run confusion on exact recheck',async()=>{
 const m=mock({run:{...row(),actId:'OTHER_ACTOR'}});
 await assert.rejects(inspectDiscoveredOwnerCanary({env,fetchFn:m.fetchFn,now:()=>new Date('2026-10-16T03:00:00Z')}),e=>e.code==='RUN_IDENTITY_MISMATCH');
 assert.equal(m.calls.length,4);
});

test('R04 locator aborts streaming oversized Actor JSON before full buffering',async()=>{
  let chunks=0,cancelled=0;
  const stream=new ReadableStream({
    pull(controller){chunks++;controller.enqueue(new Uint8Array(65536).fill(120));},
    cancel(){cancelled++;}
  });
  const calls=await refuses('RESPONSE_TOO_LARGE',{
    responses:{actor:new Response(stream,{headers:{'content-type':'application/json'}})}
  });
  assert.equal(calls.length,1);
  assert.equal(cancelled,1);
  assert.ok(chunks<=5,'locator response must stop reading at 128KiB');
});


test('R04 run locator rejects application/jsonp and media-type lookalikes on first GET',async()=>{
  for(const contentType of ['application/jsonp','application/json-seq','text/application/json','application/jsonxyz']){
    const response=new Response(JSON.stringify({data:actor}),{headers:{'content-type':contentType}});
    const calls=await refuses('JSON_CONTENT_TYPE_REQUIRED',{responses:{actor:response}});
    assert.equal(calls.length,1,contentType+': never follow up on wrong media type');
  }
});
test('R04 run locator permits JSON Content-Type with charset parameters',async()=>{
  const m=mock({responses:{actor:new Response(JSON.stringify({data:actor}),{
    headers:{'content-type':'Application/JSON; charset=UTF-8'}
  })}});
  const result=await locateOwnerCanaryRun({env,fetchFn:m.fetchFn});
  assert.equal(result.runId,'RUN1234567');
  assert.equal(m.calls.length,2);
});
