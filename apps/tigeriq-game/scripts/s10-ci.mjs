/** GH-5284: Node 22 S10 deterministic CI gate; source-only, no PC01/ADB. */
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';

const game = resolve(import.meta.dirname, '..');
const root = resolve(game, '../..');
const sources = Object.freeze({
  'scripts/s10-preflight.mjs':'84e95f730600deb23614f5de5ec59dca628a3b1c',
  'scripts/s10-e2e.mjs':'24b25ab3b5c3a1441ded7bbbf2b9ed0dde714d4a',
  'scripts/s10-rdc-adapter.mjs':'b0438843163c6c85ccf78c13ccc482d600c532ce',
  'tests/s10-e2e.test.mjs':'7efeb3dc9072a07e5cff5aedfb1d83dce42b502a',
  'tests/s10-rdc-adapter.test.mjs':'f92f111707db781b940d92593a67d25605b06ef1',
  'scripts/s10-preview.mjs':'b20c40f2eeee893b8f15f904ba14af243a494b19',
  'tests/s10-preview.test.mjs':'6d2be9ae34c6f2fa7fdd4c2520a14d486f5d2485',
  'scripts/build-standalone.mjs':'87740fb62f295cf0a492e3e06be435bd6d0ed115',
  'tests/standalone.test.mjs':'56ecde3dd166faaa196671c406326754d5eba2f2',
  'preview/robot-oops-g06-field-test.html':'4a110f2a5704825bc7fb896ed4f88ef2f9cb1ded',
  'tests/field-preview.test.mjs':'e19c27481b74aad72d46c488b61fe8ba24d311fd'
});
const gate = (condition, label) => {if(!condition) throw Error(label);};
const run = (program,args,cwd=game)=>{
  const r=spawnSync(program,args,{cwd,encoding:'utf8',timeout:60000,maxBuffer:1024*1024});
  gate(!r.error && r.status===0,
    'EXEC_FAILURE '+program+' '+args.join(' ')+' '+(r.stderr||r.error||'').slice(0,500));
  return (r.stdout||'').trim();
};
const sha1blob=bytes=>createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
async function verify(){
  const [major,minor]=process.versions.node.split('.').map(Number);
  gate(major>22||(major===22&&minor>=14),'NODE_22_14_REQUIRED');
  const isActions=process.env.GITHUB_ACTIONS==='true';
  const expected=(process.env.TIGERIQ_GAME_EXPECTED_SHA||'').toLowerCase();
  let sourceSha='NOT_GITHUB_ATTESTED';
  if(isActions){
    gate(/^[a-f0-9]{40}$/.test(expected),'MISSING_EXACT_HEAD_SHA');
    sourceSha=run('git',['rev-parse','HEAD'],root).toLowerCase();
    gate(sourceSha===expected,'EXACT_HEAD_SHA_MISMATCH');
  }
  const verified=[];
  for(const [p,expectedBlob] of Object.entries(sources)){
    const bytes=await readFile(join(game,p));
    const blob=sha1blob(bytes);
    gate(blob===expectedBlob,'GIT_BLOB_CHANGED_OUTSIDE_ACCEPTED_SOURCE '+p);
    verified.push({path:'apps/tigeriq-game/'+p,gitBlobSha1:blob});
    if(p.endsWith('.mjs'))run(process.execPath,['--check',p]);
  }
  // A working preview is an actual built game over HTTP, not a static fixture.
  run(process.execPath,['scripts/build.mjs']);
  run(process.execPath,['scripts/build-standalone.mjs']);
  const tap=run(process.execPath,['--test','--test-reporter=tap',
    'tests/s10-e2e.test.mjs','tests/s10-rdc-adapter.test.mjs','tests/s10-preview.test.mjs','tests/standalone.test.mjs','tests/field-preview.test.mjs']);
  const getCount=name=>Number(new RegExp('^# '+name+' (\\d+)$','m').exec(tap)?.[1]);
  const tests=getCount('tests'),pass=getCount('pass'),fail=getCount('fail'),skipped=getCount('skipped');
  gate(tests===37 && pass===37 && fail===0 && skipped===0,'G06_REGRESSION_MATRIX_NOT_37_OF_37');
  const preflight=JSON.parse(run(process.execPath,['scripts/s10-preflight.mjs','--dry-run']));
  const noAdapter=JSON.parse(run(process.execPath,['scripts/s10-e2e.mjs']));
  gate(preflight.code==='WAIT_RUNTIME_MCP_BINDING' && preflight.deviceMutation===false &&
    preflight.ready===false && preflight.productG06Done===false &&
    noAdapter.code==='WAIT_RUNTIME_MCP_BINDING' && noAdapter.mutated===false &&
    noAdapter.productG06Done===false,'NATIVE_DEVICE_GATES_NOT_FAIL_CLOSED');
  const receipt={schema:'TIGERIQ_GH5284_NODE22_CI_GATE_V1',workOrder:'GH-5284',
    resourceScope:'TIGERIQ_GAME_G06_S10_E2E_HARNESS',
    githubActions:isActions,sourceSha,sourceFiles:verified,node:process.version,
    tests:{total:tests,pass,fail,skipped},preflightCode:preflight.code,
    noAdapterCode:noAdapter.code,nativeAdapterConnected:false,
    deviceModified:false,deviceE2EAccepted:false,wholeWorkOrderDone:false,
    requireGithubRunUrlForCiAttestation:true};
  const target=process.argv.find(s=>s.startsWith('--receipt='))?.slice(10);
  if(target){
    const out=resolve(target);
    await mkdir(dirname(out),{recursive:true});
    await writeFile(out,JSON.stringify(receipt,null,2)+'\n');
  }
  process.stdout.write('GH5284_NODE22_TESTS_PASS='+pass+'/'+tests+'\nGH5284_SOURCE_SHA='+sourceSha+
    '\nGH5284_NATIVE_E2E_ACCEPTED=false\n');
  return receipt;
}
verify().catch(e=>{console.error('GH5284_CI_GATE_FAILED',e.message);process.exitCode=1;});
