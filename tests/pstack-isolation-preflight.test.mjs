import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyRuntimeIsolation,runSandboxVerification,sandboxBaseUrl,doctorAndSelectWork} from '../scripts/verify-core-ui-sandbox.mjs';

import {existsSync,readlinkSync} from 'node:fs';
import {spawn,spawnSync} from 'node:child_process';
import {readLinuxProcessIdentity,readLinuxIsolatedProcessPair,LinuxNativeReadbackBlocked} from '../scripts/pstack-linux-native-readback.mjs';
import {rm} from 'node:fs/promises';
import {resolve} from 'node:path';

test('T04: Linux /proc reader observes current process without leaking command line',{
  skip:process.platform!=='linux'
},async()=>{
  const packet=await readLinuxProcessIdentity(process.pid);
  assert.equal(packet.pid,process.pid);
  assert.match(packet.networkNamespace,/^net:\[\d+\]$/);
  assert.match(packet.processStartTicks,/^\d+$/);
  assert.deepEqual(Object.keys(packet).sort(),[
    'networkNamespace','pid','processStartTicks'
  ]);
});

test('T04: native Linux inspector rejects invalid and absent PIDs before any acceptance',{
  skip:process.platform!=='linux'
},async()=>{
  await assert.rejects(readLinuxProcessIdentity(0),{code:'NATIVE_PID_INVALID'});
  await assert.rejects(readLinuxProcessIdentity(-1),{code:'NATIVE_PID_INVALID'});
  await assert.rejects(readLinuxProcessIdentity(1.25),{code:'NATIVE_PID_INVALID'});
  await assert.rejects(readLinuxProcessIdentity(2147483647),
    {code:'NATIVE_PROCESS_READBACK_UNAVAILABLE'});
});

test('T04: native pair rejects same PID or a Core in the host namespace',{
  skip:process.platform!=='linux'
},async()=>{
  await assert.rejects(readLinuxIsolatedProcessPair({
    corePid:process.pid,bridgePid:process.pid
  }),{code:'NATIVE_CORE_BRIDGE_SAME_PID'});
  assert.ok(process.ppid>0);
  await assert.rejects(readLinuxIsolatedProcessPair({
    corePid:process.pid,bridgePid:process.ppid
  }),{code:'NATIVE_CORE_HOST_NAMESPACE_SHARED'});
});


test('T04: real ephemeral native Linux process pair has private network namespace and teardown',{
  skip:!(process.platform==='linux'&&process.env.GITHUB_ACTIONS==='true'&&
    process.env.RUNNER_ENVIRONMENT==='github-hosted'&&
    process.env.GITHUB_REPOSITORY==='newsdayads/tigeriq-ai-lab'),
  timeout:25000
},async()=>{
  // Only two disposable /bin/sleep processes. No Core, DB, bridge,
  // browser, credentials, network requests or host service modifications.
  // Drop privileges to runner after unshare; avoid /proc readback denial on root PIDs.
  // The shell cleans up ONLY the two PIDs it spawned on all exit paths.
  const shell=String.raw`
    set -eu
    core=; bridge=
    cleanup() {
      if [ -n "$core" ]; then kill "$core" 2>/dev/null || :; fi
      if [ -n "$bridge" ]; then kill "$bridge" 2>/dev/null || :; fi
      if [ -n "$core" ]; then wait "$core" 2>/dev/null || :; fi
      if [ -n "$bridge" ]; then wait "$bridge" 2>/dev/null || :; fi
    }
    trap cleanup EXIT HUP INT TERM
    sleep 15 & core=$!
    sleep 15 & bridge=$!
    printf 'PSTACK_T04_PAIR %s %s\n' "$core" "$bridge"
    answer=
    IFS= read -r -t 10 answer || :
    [ "$answer" = TEARDOWN ]
  `;
  const subprocess=spawn('sudo',['-n','unshare','--net','--','runuser','-u','runner','--','bash','-c',shell],{
    stdio:['pipe','pipe','pipe'],shell:false
  });
  let textOut='',textErr='',closed=false,exitCode=null;
  const completion=new Promise((resolve,reject)=>{
    subprocess.once('error',reject);
    subprocess.once('close',code=>{closed=true;exitCode=code;resolve(code);});
  });
  const ready=new Promise((resolve,reject)=>{
    subprocess.stdout.on('data',chunk=>{
      textOut+=chunk.toString('utf8');
      if(textOut.length>1024)return reject(Error('T04_PAIR_OUTPUT_INVALID'));
      const match=/^PSTACK_T04_PAIR (\d+) (\d+)\r?\n/.exec(textOut);
      if(match)return resolve([Number(match[1]),Number(match[2])]);
    });
    subprocess.stderr.on('data',chunk=>{
      textErr=(textErr+chunk.toString('utf8')).slice(-700);
    });
    completion.then(code=>reject(Error(
      code===0?'T04_PAIR_TERMINATED_EARLY':'T04_PRIVATE_NETNS_UNAVAILABLE'
    ))).catch(reject);
  });
  let original=null,observed=null,pids=null;
  try{
    pids=await ready;
    const [corePid,bridgePid]=pids;
    assert.ok(corePid>0&&bridgePid>0&&corePid!==bridgePid);
    original=await readLinuxProcessIdentity(corePid);
    observed=await readLinuxIsolatedProcessPair({corePid,bridgePid});
    assert.equal(observed.source,'LINUX_PROC_READ_ONLY');
    assert.notEqual(observed.host.networkNamespace,observed.core.networkNamespace);
    assert.equal(observed.bridge.networkNamespace,observed.core.networkNamespace);
    assert.equal(observed.createdResources,false);
    assert.equal(observed.nativeFullStackAccepted,false);
  }finally{
    // Never target a PID outside the child shell; only signal its stdin.
    if(!subprocess.stdin.destroyed){
      subprocess.stdin.write('TEARDOWN\n');
      subprocess.stdin.end();
    }
    await completion;
  }
  assert.equal(closed,true);
  assert.equal(exitCode,0,'T04_PRIVATE_NETNS_CLEANUP_FAILED');
  await assert.rejects(readLinuxProcessIdentity(pids[0]),{
    code:'NATIVE_PROCESS_READBACK_UNAVAILABLE'
  });
  await assert.rejects(readLinuxProcessIdentity(pids[1]),{
    code:'NATIVE_PROCESS_READBACK_UNAVAILABLE'
  });
  console.log('T04_EPHEMERAL_NETNS_LIVE_TEARDOWN '+JSON.stringify({
    hostNamespace:observed.host.networkNamespace,
    sandboxNamespace:observed.core.networkNamespace,
    corePid:pids[0],bridgePid:pids[1],
    sourceProcessStartTicks:original.processStartTicks,
    childProcessesExited:true,scope:'TWO_SLEEP_PLACEHOLDERS_NOT_REAL_CORE_OR_BRIDGE',
    nativeFullStackAccepted:false
  }));
});

test('T04: actual Core entrypoint must reject unsafe boot before autonomy in isolated netns',{
  skip:!(process.platform==='linux'&&process.env.GITHUB_ACTIONS==='true'&&
    process.env.RUNNER_ENVIRONMENT==='github-hosted'&&
    process.env.GITHUB_REPOSITORY==='newsdayads/tigeriq-ai-lab'),
  timeout:20000
},()=>{
  // Invoke the real Core entrypoint in a disposable *private network namespace*.
  // env -i strips inherited database URLs, tokens, GitHub credentials, provider
  // keys, and production addresses. A safe verdict here is a REFUSAL to boot.
  // This does NOT authorize an actual database/Core/bridge launch.
  const outcome=spawnSync('sudo',[
    '-n','unshare','--net','--',
    'runuser','-u','runner','--',
    'env','-i','PATH=/usr/bin:/bin','NODE_ENV=test',
    process.execPath,'apps/tigeriq-core/core.mjs'
  ],{
    cwd:process.cwd(),shell:false,encoding:'utf8',timeout:15000,
    maxBuffer:65536
  });
  assert.equal(outcome.error,undefined,'T04_CORE_SANDBOX_LAUNCH_UNVERIFIED');
  assert.equal(outcome.signal,null,'T04_CORE_SANDBOX_TIMEOUT_OR_SIGNAL');
  assert.equal(outcome.status,1,'T04_CORE_BOOT_MUST_FAIL_CLOSED');
  assert.match(outcome.stderr||'',/DATABASE_URL_MISSING/,
    'T04_CORE_MUST_DENY_MISSING_DATABASE_BEFORE_LOOP');
  assert.doesNotMatch(outcome.stdout||'',/TIGERIQ_CORE_STARTED|CORE_LOOP_ERROR/,
    'T04_CORE_AUTONOMY_MUST_NOT_START');
  console.log('T04_REAL_CORE_DENIED_NO_DATABASE '+JSON.stringify({
    testedEntrypoint:'apps/tigeriq-core/core.mjs',
    host:'GITHUB_HOSTED_PRIVATE_NETNS',
    databaseSupplied:false,credentialsForwarded:false,
    processExitCode:outcome.status,
    expectedBlocker:'DATABASE_URL_MISSING',
    autonomousCoreStarted:false,nativeFullStackAccepted:false
  }));
});

// Source-only preflight: observes an ephemeral public-repo GitHub runner.
// This does NOT claim an isolated Core/bridge/database, a native inspector,
// a lease, or T04 acceptance. No containers, namespaces or services are created.
test('T04: hosted runner read-only capability preflight',{
  skip:process.env.GITHUB_ACTIONS!=='true'
},()=>{
  assert.equal(process.env.GITHUB_REPOSITORY,'newsdayads/tigeriq-ai-lab');
  assert.equal(process.env.RUNNER_OS,'Linux');
  assert.equal(process.env.RUNNER_ENVIRONMENT,'github-hosted');
  const namespace=readlinkSync('/proc/self/ns/net');
  assert.match(namespace,/^net:\[\d+\]$/);
  const docker=spawnSync('docker',['info','--format','{{.OSType}}'],{
    encoding:'utf8',timeout:10000,shell:false
  });
  assert.equal(docker.status,0,'T04_DOCKER_DAEMON_NOT_VERIFIED');
  assert.equal(docker.stdout.trim(),'linux','T04_DOCKER_OS_NOT_LINUX');
  const privilege=spawnSync('sudo',['-n','id','-u'],{
    encoding:'utf8',timeout:5000,shell:false
  });
  assert.equal(privilege.status,0,'T04_NATIVE_OPERATOR_PRIVILEGE_NOT_VERIFIED');
  assert.equal(privilege.stdout.trim(),'0','T04_NATIVE_OPERATOR_NOT_ROOT');
  console.log('T04_RUNNER_READ_ONLY_PREFLIGHT_OK '+JSON.stringify({
    repository:process.env.GITHUB_REPOSITORY,
    runnerEnvironment:process.env.RUNNER_ENVIRONMENT,
    runnerOS:process.env.RUNNER_OS,networkNamespace:namespace,
    dockerOS:docker.stdout.trim(),noninteractiveSudo:true,
    createdResources:false,nativeFullStackAccepted:false
  }));
});

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
 assert.equal(r.corePid,4567);
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
   const value=path==='/api/status'?{ok:true,core:{pid:proof().core.pid,time:new Date(now).toISOString()}}:
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

test('T04: matching attested process allows only the read-only doctor path',async()=>{
  const calls=[];
  const fetchImpl=async url=>{
    const route=new URL(url).pathname;
    calls.push(route);
    const payload=route==='/api/status'
      ?{ok:true,core:{pid:4567,time:new Date(now).toISOString()}}
      :{ok:true,projection:{generatedAt:new Date(now).toISOString(),stale:false,
        openWork:[{number:5012,title:'Isolated Work Order',url:'https://github.com/newsdayads/tigeriq-ai-lab/issues/5012'}]}};
    return {ok:true,headers:{get:()=> 'application/json'},json:async()=>payload};
  };
  const r=await doctorAndSelectWork({baseUrl,issueNumber:5012,now,expectedCorePid:4567,fetchImpl});
  assert.equal(r.issueNumber,5012);
  assert.deepEqual(calls,['/api/status','/api/health-live-work']);
});
test('T04: missing Core PID blocks before work projection is fetched',async()=>{
  const calls=[];
  await assert.rejects(doctorAndSelectWork({baseUrl,issueNumber:5012,now,expectedCorePid:4567,
    fetchImpl:async url=>{
      calls.push(new URL(url).pathname);
      return {ok:true,headers:{get:()=> 'application/json'},json:async()=>({ok:true,core:{time:new Date(now).toISOString()}})};
    }
  }),{code:'SANDBOX_CORE_PID_MISMATCH'});
  assert.deepEqual(calls,['/api/status']);
});
