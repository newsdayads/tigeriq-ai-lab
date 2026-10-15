import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectHistoricalRun, historicalRunConfig, HistoricReadError } from './apify-historical-run-readonly.mjs';

const env = {
  APIFY_READONLY_EXECUTE: 'OWNER_APPROVED_EXISTING_RUN_READ',
  APIFY_TOKEN: 'SENSITIVE_SENTINEL_TOKEN',
  APIFY_ACTOR_ID: 'ACTOR12345',
  APIFY_RUN_ID: 'RUN1234567',
};
const clock = () => new Date('2026-10-15T12:00:00.000Z');
const actor = () => ({
  id: env.APIFY_ACTOR_ID, username:'tigeriq', name:'tigeriq-ai-lab',
  isPublic:false, actorPermissionLevel:'LIMITED_PERMISSIONS',
});
const run = () => ({
  id:env.APIFY_RUN_ID, actId:env.APIFY_ACTOR_ID, status:'SUCCEEDED',
  startedAt:'2026-10-08T03:00:00.000Z',
  finishedAt:'2026-10-08T03:00:02.000Z',
  defaultKeyValueStoreId:'STORE12345',
  stats:{computeUnits:0.002}, usageTotalUsd:0.0004,
});
const output=()=>({schemaVersion:'1.0',status:'success',requestedUrl:'https://example.com/'});
function mocked({actorData=actor(),first=run(),final=run(),result=output(),responses={}}={}){
  const calls=[];
  let seenRun=0;
  const fetchFn=async (url,options)=>{
    calls.push({url,options});
    if(options.method!=='GET'||options.redirect!=='error'||options.cache!=='no-store')
      throw Error('UNSAFE_REQUEST');
    if(url.endsWith('/actors/'+env.APIFY_ACTOR_ID))
      return responses.actor ?? Response.json({data:actorData});
    if(url.endsWith('/actor-runs/'+env.APIFY_RUN_ID))
      return responses.run ?? Response.json({data:++seenRun===1?first:final});
    if(url.endsWith('/key-value-stores/STORE12345/records/OUTPUT'))
      return responses.output ?? Response.json(result);
    throw Error('UNEXPECTED_ENDPOINT');
  };
  return {fetchFn,calls};
}
async function rejected(code,opts={},environment=env){
  const fixture=mocked(opts);
  await assert.rejects(
    inspectHistoricalRun({env:environment,fetchFn:fixture.fetchFn,now:clock}),
    err=>err instanceof HistoricReadError && err.code===code);
  return fixture.calls;
}
test('R04 authenticated existing run only: exactly 4 GET, no build/run/sync mutation',async()=>{
  const m=mocked();
  const res=await inspectHistoricalRun({env,fetchFn:m.fetchFn,now:clock});
  assert.equal(res.run.id,env.APIFY_RUN_ID);
  assert.equal(res.run.computeUnits,0.002);
  assert.equal(res.run.usageTotalUsd,0.0004);
  assert.equal(res.output.schemaVersion,'1.0');
  assert.equal(res.cost.ownerBillingConfirmed,false);
  assert.equal(res.cost.zeroCostClaim,false);
  assert.equal(res.cost.revenueVerified,false);
  assert.equal(res.acceptance.platformFinalInvoiceVerified,false);
  assert.equal(m.calls.length,4);
  assert.deepEqual(m.calls.map(x=>new URL(x.url).pathname),[
    '/v2/actors/ACTOR12345','/v2/actor-runs/RUN1234567',
    '/v2/actor-runs/RUN1234567','/v2/key-value-stores/STORE12345/records/OUTPUT'
  ]);
  for(const c of m.calls){
    assert.equal(c.options.method,'GET');
    assert.equal(c.options.headers.authorization,'Bearer '+env.APIFY_TOKEN);
    assert.equal(c.url.startsWith('https://api.apify.com/v2/'),true);
    assert.doesNotMatch(c.url,/token|run-sync|\/builds|\/runs\?/i);
  }
  assert.doesNotMatch(JSON.stringify(res),/SENSITIVE_SENTINEL_TOKEN|example\.com/);
});
test('R04 missing execute gate prevents network use even with token',async()=>{
  const c=await rejected('READONLY_GATE_REQUIRED',{}, {...env,APIFY_READONLY_EXECUTE:undefined});
  assert.equal(c.length,0);
});
test('R04 wrong explicit gate fails without any fetch',async()=>{
  const c=await rejected('READONLY_GATE_REQUIRED',{}, {...env,APIFY_READONLY_EXECUTE:'OWNER_APPROVED_PRIVATE_TEST'});
  assert.equal(c.length,0);
});
test('R04 empty scoped token fails without any fetch',async()=>{
  const c=await rejected('SCOPED_TOKEN_REQUIRED',{}, {...env,APIFY_TOKEN:''});
  assert.equal(c.length,0);
});
for(const [which,value] of [['actor','bad/../id'],['run','run?token=secret'],['runEmpty',''],['actorEmpty','']]){
  test('R04 refuses nonopaque '+which+' before HTTP',async()=>{
    const c=await rejected('EXACT_OPAQUE_IDS_REQUIRED',{}, {...env,[which.startsWith('actor')?'APIFY_ACTOR_ID':'APIFY_RUN_ID']:value});
    assert.equal(c.length,0);
  });
}
test('R04 refuses same actor and run ID',async()=>{
  assert.throws(()=>historicalRunConfig({...env,APIFY_RUN_ID:env.APIFY_ACTOR_ID}),
    e=>e.code==='ACTOR_RUN_IDS_NOT_DISTINCT');
});
test('R04 actor identity must match exact private handle',async()=>{
  await rejected('ACTOR_IDENTITY_MISMATCH',{actorData:{...actor(),username:'somebody'}});
  await rejected('ACTOR_IDENTITY_MISMATCH',{actorData:{...actor(),id:'IMPOSTOR'}});
});
test('R04 public Actor cannot be read as private evidence',async()=>{
  const calls=await rejected('ACTOR_NOT_PRIVATE',{actorData:{...actor(),isPublic:true}});
  assert.equal(calls.length,1);
});
test('R04 full Actor permission level rejected',async()=>{
  await rejected('ACTOR_PERMISSION_SCOPE_NOT_LIMITED',{actorData:{...actor(),actorPermissionLevel:'FULL_PERMISSIONS'}});
});
test('R04 wrong run ID refused',async()=>{await rejected('RUN_IDENTITY_MISMATCH',{first:{...run(),id:'ANOTHER_RUN'}})});
test('R04 wrong actId refused',async()=>{await rejected('RUN_IDENTITY_MISMATCH',{first:{...run(),actId:'OTHER_ACTOR'}})});
test('R04 non SUCCEEDED run refused',async()=>{await rejected('HISTORICAL_RUN_NOT_SUCCEEDED',{first:{...run(),status:'FAILED'}})});
test('R04 incomplete run timestamp refused',async()=>{await rejected('RUN_TIMESTAMPS_UNVERIFIED',{first:{...run(),finishedAt:null}})});
test('R04 settle gate rejects near-future finished time',async()=>{await rejected('RUN_USAGE_NOT_SETTLED',{first:{...run(),finishedAt:'2026-10-15T11:59:55.000Z'}})});
test('R04 exact Oct 8 Vietnam day enforced',async()=>{await rejected('HISTORICAL_RUN_DAY_MISMATCH',{first:{...run(),startedAt:'2026-10-07T03:00:00.000Z'}})});
test('R04 invalid default store ID never produces guessed record path',async()=>{await rejected('RUN_STORE_UNVERIFIED',{first:{...run(),defaultKeyValueStoreId:'../../secret'}})});
test('R04 immutable historical fields cannot drift between 2 GETs',async()=>{await rejected('RUN_RECHECK_DRIFT',{final:{...run(),finishedAt:'2026-10-08T03:00:05.000Z'}})});
for(const value of [null,-0.01,'0.000',NaN]){
  test('R04 refuses unset, negative, textual or NaN usage '+String(value),async()=>{
    await rejected('APIFY_USAGE_UNVERIFIED',{final:{...run(),usageTotalUsd:value}});
  });
}
test('R04 missing computeUnits is explicitly null not zero',async()=>{
  const m=mocked({final:{...run(),stats:{}}});
  const res=await inspectHistoricalRun({env,fetchFn:m.fetchFn,now:clock});
  assert.equal(res.run.computeUnits,null);
  assert.equal(res.cost.zeroCostClaim,false);
});
test('R04 output schema cannot be fabricated',async()=>{await rejected('HISTORICAL_OUTPUT_INVALID',{result:{schemaVersion:'2.0',status:'success'}})});
test('R04 output status must be success',async()=>{await rejected('HISTORICAL_OUTPUT_INVALID',{result:{schemaVersion:'1.0',status:'error'}})});
test('R04 302 with empty response is rejected as redirect before parsing',async()=>{
  const response=new Response(null,{status:302,headers:{location:'https://evil.example'}});
  await rejected('APIFY_REDIRECT_BLOCKED',{responses:{actor:response}});
});
test('R04 resource scoped 403 is not silently elevated',async()=>{
  await rejected('SCOPED_READ_DENIED',{responses:{actor:Response.json({message:'Forbidden'},{status:403})}});
});
test('R04 non JSON actor response rejected',async()=>{
  await rejected('JSON_CONTENT_TYPE_REQUIRED',{responses:{actor:new Response('<html>login</html>',{status:200,headers:{'content-type':'text/html'}})}});
});
test('R04 invalid JSON actor response rejected',async()=>{
  await rejected('APIFY_JSON_INVALID',{responses:{actor:new Response('bad-json',{status:200,headers:{'content-type':'application/json'}})}});
});
test('R04 network error including secret does not leak it in returned error',async()=>{
  await assert.rejects(inspectHistoricalRun({
    env,now:clock,fetchFn:async()=>{throw new Error('token = '+env.APIFY_TOKEN)}
  }), e=>e.code==='APIFY_FETCH_FAILED'&&!String(e.message).includes(env.APIFY_TOKEN));
});
test('R04 invalid clock fails before GET',async()=>{
  const m=mocked();
  await assert.rejects(inspectHistoricalRun({env,fetchFn:m.fetchFn,now:()=>new Date('invalid')}),e=>e.code==='CLOCK_INVALID');
  assert.equal(m.calls.length,0);
});
