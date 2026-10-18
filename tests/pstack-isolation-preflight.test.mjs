import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyRuntimeIsolation,runSandboxVerification,sandboxBaseUrl,doctorAndSelectWork} from '../scripts/verify-core-ui-sandbox.mjs';

import {existsSync} from 'node:fs';
import {rm} from 'node:fs/promises';
import {resolve} from 'node:path';

const baseUrl='http://127.0.0.1:4315/';
const now=Date.parse('2026-10-18T14:55:00.000Z');
const proof=()=>({
  source:'AUTHORIZED_NATIVE_OPERATOR_READBACK',
  evidenceRef:'local-operator:isolated-instance/123',
  observedAt:new Date(now).toISOString(),
  core:{pid:4567,port:4315,networkNamespace:'netns-pstack-test-123',buildSha:'a'.repeat(40),dbFingerprint:'isolated-db-123'},
  bridge:{pid:4568,port:8801,networkNamespace:'netns-pstack-test-123'},
  host:{networkNamespace:'netns-live-567',dbFingerprint:'production-db-567',corePort:8795},
  browser:{profileId:'isolated-profile-abc',sharedProfileId:'pc01-main-profile'},
});
test('T04: no native authorized inspector must fail before any HTTP or browser access',async()=>{
 let calls=0;
 await assert.rejects(runSandboxVerification({baseUrl,issueNumber:5012,
   outputDir:'artifacts/pstack-verification/not-allowed',
   fetchImpl:async()=>{calls++;throw Error('HTTP_CALLED');},
   browserFactory:async()=>{calls++;throw Error('BROWSER_CALLED');},
   now}),{code:'SANDBOX_NATIVE_READBACK_REQUIRED'});
 assert.equal(calls,0);
});
test('T04: source-only assertion cannot substitute for native operator readback',async()=>{
 await assert.rejects(verifyRuntimeIsolation({baseUrl,nativeIsolationInspector:async()=>({...proof(),source:'SOURCE_ONLY'}),now}),
  {code:'SANDBOX_ISOLATION_NOT_VERIFIED'});
});
test('T04: reject shared or stale resources even if a report claims sandbox',async()=>{
 const invalid=[
  [{core:{...proof().core,dbFingerprint:proof().host.dbFingerprint}},'SANDBOX_DATABASE_NOT_ISOLATED'],
  [{bridge:{...proof().bridge,networkNamespace:proof().host.networkNamespace}},'SANDBOX_BRIDGE_NOT_ISOLATED'],
  [{core:{...proof().core,networkNamespace:proof().host.networkNamespace}},'SANDBOX_CORE_NOT_ISOLATED'],
  [{browser:{profileId:'same',sharedProfileId:'same'}},'SANDBOX_BROWSER_PROFILE_SHARED'],
  [{core:{...proof().core,port:8795}},'SANDBOX_ISOLATION_NOT_VERIFIED'],
  [{observedAt:new Date(now-300000).toISOString()},'SANDBOX_NATIVE_READBACK_STALE'],
  [{evidenceRef:'   '},'SANDBOX_ISOLATION_NOT_VERIFIED'],
 ];
 for(const [part,code] of invalid)
  await assert.rejects(verifyRuntimeIsolation({baseUrl,nativeIsolationInspector:async()=>({...proof(),...part}),now}),{code});
});
test('T04: block a live Core port even when its reported port matches the destination',async()=>{
 await assert.rejects(verifyRuntimeIsolation({
   baseUrl:'http://127.0.0.1:8795/',
   nativeIsolationInspector:async()=>({...proof(),core:{...proof().core,port:8795}}),now
 }),{code:'SHARED_RUNTIME_PORT_FORBIDDEN'});
});
test('T04: reject a bridge outside the isolated Core network namespace',async()=>{
 await assert.rejects(verifyRuntimeIsolation({baseUrl,nativeIsolationInspector:async()=>({...proof(),
  bridge:{...proof().bridge,networkNamespace:'third-party-netns'}}),now}),
  {code:'SANDBOX_BRIDGE_NOT_ISOLATED'});
});
test('T04: structured source gate is NOT product acceptance',async()=>{
 const r=await verifyRuntimeIsolation({baseUrl,nativeIsolationInspector:async()=>proof(),now});
 assert.equal(r.isolationSource,'OPERATOR_READBACK_STRUCTURALLY_CHECKED');
 assert.equal(r.runtimeAcceptanceVerified,false);
 assert.equal(r.nativeReadbackEvidenceRef,'local-operator:isolated-instance/123');
});

test('T04: known live web and coding-lane service ports never qualify as sandbox URLs',async()=>{
 let networkCalls=0;
 for(const port of [8796,8797]){
   const liveUrl='http://127.0.0.1:'+port+'/';
   assert.throws(()=>sandboxBaseUrl(liveUrl),{code:'SHARED_RUNTIME_PORT_FORBIDDEN'});
   await assert.rejects(doctorAndSelectWork({
     baseUrl:liveUrl,issueNumber:5012,now,
     fetchImpl:async()=>{networkCalls++;throw Error('LIVE_SERVICE_CONTACT_FORBIDDEN');}
   }),{code:'SHARED_RUNTIME_PORT_FORBIDDEN'});
 }
 assert.equal(networkCalls,0);
});

test('T04: direct Doctor and base URL must deny known production and bridge ports without network I/O', async()=>{
  let networkCalls=0;
  for(const port of [3150,3210,8795,8801]){
    const u='http://127.0.0.1:'+port+'/';
    assert.throws(()=>sandboxBaseUrl(u),{code:'SHARED_RUNTIME_PORT_FORBIDDEN'});
    await assert.rejects(doctorAndSelectWork({
      baseUrl:u,issueNumber:5012,now,
      fetchImpl:async()=>{networkCalls++;throw Error('MUST_NOT_CONTACT_KNOWN_LIVE_PORT')}
    }),{code:'SHARED_RUNTIME_PORT_FORBIDDEN'});
  }
  assert.equal(networkCalls,0);
});
test('T04: aborted UI verification removes its fresh evidence directory and no false PASS',async()=>{
 const outputDir='artifacts/pstack-verification/t04-rollback-'+process.pid+'-'+Date.now();
 const target=resolve(outputDir);
 const fetchImpl=async url=>{
   const path=new URL(url).pathname;
   const value=path==='/api/status'?{ok:true,core:{time:new Date(now).toISOString()}}:
    {ok:true,projection:{generatedAt:new Date(now).toISOString(),stale:false,
      openWork:[{number:5012,title:'PSTACK T04 sandbox',status:'READY',url:'https://github.com/newsdayads/tigeriq-ai-lab/issues/5012'}]}};
   return {ok:true,headers:{get:()=> 'application/json'},json:async()=>value};
 };
 assert.equal(existsSync(target),false);
 try{
   await assert.rejects(runSandboxVerification({
     baseUrl,issueNumber:5012,outputDir,fetchImpl,
     nativeIsolationInspector:async()=>proof(),now,
     browserFactory:async()=>{throw Error('CONTROLLED_BROWSER_LAUNCH_FAILURE');}
   }),/CONTROLLED_BROWSER_LAUNCH_FAILURE/);
   assert.equal(existsSync(target),false,
     'failed verification must not leave its own empty evidence dir or suggest success');
 }finally{await rm(target,{recursive:true,force:true})}
});

test('T04: malformed or thrown inspector fails closed without leaking details',async()=>{
 await assert.rejects(verifyRuntimeIsolation({baseUrl,nativeIsolationInspector:async()=>{throw Error('SECRET_STUFF');},now}),
  {code:'SANDBOX_NATIVE_READBACK_UNAVAILABLE'});
 await assert.rejects(verifyRuntimeIsolation({baseUrl,nativeIsolationInspector:async()=>null,now}),
  {code:'SANDBOX_ISOLATION_NOT_VERIFIED'});
});

test('T04: attested Core PID must match the live Core /api/status PID before any browser access',async()=>{
  let browserCalls=0;
  const outputDir='artifacts/pstack-verification/t04-pid-mismatch-'+process.pid+'-'+Date.now();
  const fetchImpl=async url=>{
    const pathname=new URL(url).pathname;
    const payload=pathname==='/api/status'
      ?{ok:true,core:{pid:4569,time:new Date(now).toISOString()}}
      :{ok:true,projection:{generatedAt:new Date(now).toISOString(),stale:false,
          openWork:[{number:5012,title:'PSTACK isolated pilot'}]}};
    return {ok:true,headers:{get:()=> 'application/json'},json:async()=>payload};
  };
  await assert.rejects(runSandboxVerification({
    baseUrl,issueNumber:5012,outputDir,now,fetchImpl,
    nativeIsolationInspector:async()=>proof(),
    browserFactory:async()=>{browserCalls++;throw Error('BROWSER_MUST_NOT_RUN_FOR_PID_MISMATCH');}
  }),{code:'SANDBOX_CORE_PID_MISMATCH'});
  assert.equal(browserCalls,0);
  assert.equal(existsSync(resolve(outputDir)),false);
});
