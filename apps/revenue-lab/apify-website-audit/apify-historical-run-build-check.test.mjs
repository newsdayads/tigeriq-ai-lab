import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectHistoricalRun, HistoricReadError } from './apify-historical-run-readonly.mjs';

const env = Object.freeze({
  APIFY_READONLY_EXECUTE: 'OWNER_APPROVED_EXISTING_RUN_READ',
  APIFY_TOKEN: 'SYNTHETIC_TOKEN_DO_NOT_TREAT_AS_SECRET',
  APIFY_ACTOR_ID: 'ACTOR12345', APIFY_RUN_ID: 'RUN1234567',
});
const actor={id:env.APIFY_ACTOR_ID,username:'tigeriq',name:'tigeriq-ai-lab',isPublic:false,actorPermissionLevel:'LIMITED_PERMISSIONS'};
const canonical={id:env.APIFY_RUN_ID,actId:env.APIFY_ACTOR_ID,status:'SUCCEEDED',
  startedAt:'2026-10-08T03:00:00.000Z',finishedAt:'2026-10-08T03:00:02.000Z',
  defaultKeyValueStoreId:'STORE12345',stats:{computeUnits:0.002},usageTotalUsd:0.0004,
  buildNumber:'0.0.4',buildId:'BUILD12345'};
const now=()=>new Date('2026-10-15T12:00:00.000Z');
function mock(first=canonical,second=first){
 let getRun=0;const calls=[];
 const fetchFn=async (url,opts)=>{
  calls.push({url,method:opts.method});
  assert.equal(opts.method,'GET');assert.equal(opts.redirect,'error');
  assert.equal(opts.cache,'no-store');
  assert.ok(url.startsWith('https://api.apify.com/v2/'));
  assert.doesNotMatch(url,/run-sync|\/builds|\/runs\?/);
  if(url.endsWith('/actors/ACTOR12345'))return Response.json({data:actor});
  if(url.endsWith('/actor-runs/RUN1234567'))return Response.json({data:++getRun===1?first:second});
  if(url.endsWith('/key-value-stores/STORE12345/records/OUTPUT'))return Response.json({schemaVersion:'1.0',status:'success',requestedUrl:'https://example.com/',pages:[{url:'https://example.com/',statusCode:200}],metrics:{pagesAudited:1,errorCount:0},errors:[],summary:{titlePresent:true}});
  throw Error('OTHER_ENDPOINT_NOT_ALLOWED');
 };
 return {calls,fetchFn};
}
async function expects(code,first,second=first,expectedCalls=2){
 const m=mock(first,second);
 await assert.rejects(inspectHistoricalRun({env,fetchFn:m.fetchFn,now}),
 e=>e instanceof HistoricReadError&&e.code===code);
 assert.equal(m.calls.length,expectedCalls);
}
test('R04 build identity: exact Owner UI build 0.0.4 accepted; 4 GET, no mutation',async()=>{
 const m=mock();const out=await inspectHistoricalRun({env,fetchFn:m.fetchFn,now});
 assert.equal(out.run.buildNumber,'0.0.4');assert.equal(out.run.id,'RUN1234567');
 assert.equal(out.acceptance.historicalRunMatched,true);
 assert.equal(out.cost.ownerBillingConfirmed,false);
 assert.equal(out.action.newRuns,0);assert.equal(m.calls.length,4);
 assert.doesNotMatch(JSON.stringify(out),/SYNTHETIC_TOKEN_DO_NOT_TREAT_AS_SECRET|example\.com/);
});
test('R04 build identity: wrong build same day is not Owner canary',async()=>expects('HISTORICAL_BUILD_MISMATCH',{...canonical,buildNumber:'0.0.3'}));
test('R04 build identity: null build cannot claim match',async()=>expects('HISTORICAL_BUILD_UNVERIFIED',{...canonical,buildNumber:null}));
test('R04 build identity: absent build cannot claim match',async()=>{
 const row={...canonical};delete row.buildNumber;await expects('HISTORICAL_BUILD_UNVERIFIED',row);
});
test('R04 build identity: nonstring build rejected',async()=>expects('HISTORICAL_BUILD_UNVERIFIED',{...canonical,buildNumber:{value:'0.0.4'}}));
test('R04 build identity: build changes on second GET',async()=>expects('HISTORICAL_BUILD_MISMATCH',canonical,{...canonical,buildNumber:'0.0.5'},3));
test('R04 build identity: first GET mismatches although second would pass',async()=>expects('HISTORICAL_BUILD_MISMATCH',{...canonical,buildNumber:'0.0.2'},canonical));
test('R04 build identity: date gate preserved',async()=>expects('HISTORICAL_RUN_DAY_MISMATCH',{...canonical,startedAt:'2026-10-07T03:00:00Z'}));
test('R04 build identity: invalid read gate causes zero network calls',async()=>{
 const m=mock();
 await assert.rejects(inspectHistoricalRun({env:{...env,APIFY_READONLY_EXECUTE:'INVALID'},fetchFn:m.fetchFn,now}),e=>e.code==='READONLY_GATE_REQUIRED');
 assert.equal(m.calls.length,0);
});
