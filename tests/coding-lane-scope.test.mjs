import {test as vitestTest} from 'vitest';
const test=(name,fn)=>vitestTest(name,async()=>{const t={test:async(_name,subfn)=>subfn(t)};return fn(t)});
import assert from 'node:assert';
import {checkRepositoryGateState,CodingScopeViolationError,existingPrNeedsBaseUpdate,parseCompactEditJson,resolveCodingRepository,salvageCompactEditsJson,selectCodingWorker,targetRepositoryFromObjective,validateExistingPrResume,validateJobScope,validateObjectiveRoutingInput,validateSourceScope} from '../apps/tigeriq-coding-lane/coding-lane.mjs';
import {extractCanonicalAllowedPaths} from '../apps/tigeriq-coding-lane/policy.mjs';

test('coding lane scope validation tests',async(t)=>{
  const allowedPaths=['apps/tigeriq-coding-lane/coding-lane.mjs','apps/tigeriq-coding-lane/policy.mjs','tests/coding-lane-scope.test.mjs','tests/coding-lane-foundation.test.mjs'];

  await t.test('extracts canonical paths from source objective',()=>{
    const objective='## Exact hard scope\nAllowed paths ONLY:\n- apps/tigeriq-coding-lane/coding-lane.mjs\n- `tests/coding-lane-scope.test.mjs`\n\n## Implement\nDo work';
    assert.deepStrictEqual(extractCanonicalAllowedPaths(objective),['apps/tigeriq-coding-lane/coding-lane.mjs','tests/coding-lane-scope.test.mjs']);
  });

  await t.test('extracts inline bullet hard-scope contract',()=>{
    const objective='- Exact hard scope: apps/tigeriq-core/core.mjs; tests/rotating-idle-auditor.test.ts. If needed keep prose after it.\n- Do not broaden scope';
    assert.deepStrictEqual(extractCanonicalAllowedPaths(objective),['apps/tigeriq-core/core.mjs','tests/rotating-idle-auditor.test.ts']);
  });


  await t.test('parses ALLOW_PATH_PREFIX preserving exact file vs directory semantics',()=>{
    const objective='ALLOW_PATH_PREFIX=apps/x/file.mjs,tests/';
    assert.deepStrictEqual(extractCanonicalAllowedPaths(objective),['apps/x/file.mjs','tests/']);
    assert.throws(()=>extractCanonicalAllowedPaths('ALLOW_PATH_PREFIX=../escape,tests/'),/CODING_CANONICAL_SCOPE_INVALID/);
    assert.throws(()=>extractCanonicalAllowedPaths('ALLOW_PATH_PREFIX=apps/*,tests/'),/CODING_CANONICAL_SCOPE_INVALID/);
  });

  await t.test('exact file does not authorize descendants while directory prefix does',()=>{
    const canonical=['apps/x/file.mjs','tests/'];
    assert.strictEqual(validateSourceScope(['apps/x/file.mjs','tests/example.test.mjs'],canonical),true);
    assert.throws(()=>validateSourceScope(['apps/x/file.mjs/evil.js'],canonical),e=>e instanceof CodingScopeViolationError&&e.offending[0]==='apps/x/file.mjs/evil.js');
    assert.throws(()=>validateSourceScope(['unrelated/safe.mjs'],canonical),e=>e instanceof CodingScopeViolationError&&e.offending[0]==='unrelated/safe.mjs');
  });


  await t.test('salvages complete compact edits from a truncated JSON response',()=>{
    const broken='{"summary":"partial","edits":[{"path":"apps/tigeriq-coding-lane/coding-lane.mjs","search":"old","replace":"new"},{"path":"tests/coding-lane-scope.test.mjs","search":"unterminated';
    assert.deepStrictEqual(salvageCompactEditsJson(broken),{
      summary:'salvaged complete compact edits from truncated model response',
      edits:[{path:'apps/tigeriq-coding-lane/coding-lane.mjs',search:'old',replace:'new'}],
    });
    assert.deepStrictEqual(parseCompactEditJson(broken),{
      summary:'partial',
      edits:[{path:'apps/tigeriq-coding-lane/coding-lane.mjs',search:'old',replace:'new'}],
    });
  });

  await t.test('does not salvage incomplete first edit',()=>{
    assert.throws(()=>parseCompactEditJson('{"edits":[{"path":"x","search":"unterminated'),/JSON_OBJECT_/);
  });

  await t.test('allowed-only candidate passes',()=>{
    assert.strictEqual(validateSourceScope(['apps/tigeriq-coding-lane/policy.mjs'],allowedPaths),true);
    assert.strictEqual(validateJobScope(allowedPaths,[{path:'apps/tigeriq-coding-lane/policy.mjs',content:'x'}]),true);
  });

  await t.test('source manager scope expansion fails closed',()=>{
    assert.throws(()=>validateSourceScope(['apps/tigeriq-coding-lane/policy.mjs','unauthorized/extra.mjs'],allowedPaths),e=>e instanceof CodingScopeViolationError&&e.code==='CODING_SCOPE_VIOLATION'&&e.offending[0]==='unauthorized/extra.mjs');
  });

  await t.test('generated extra path fails closed',()=>{
    const changes=[{path:'apps/tigeriq-coding-lane/coding-lane.mjs',content:'ok'},{path:'unauthorized/secret-file.js',content:'bad'}];
    assert.throws(()=>validateJobScope(allowedPaths,changes),e=>e instanceof CodingScopeViolationError&&e.code==='CODING_SCOPE_VIOLATION');
  });

  await t.test('no write or PR continuation occurs after violation',async()=>{
    let writeCalled=false,prCreated=false;
    try{
      validateJobScope(allowedPaths,[{path:'unauthorized/path.js',content:'hack'}]);
      writeCalled=true;
      prCreated=true;
    }catch(e){assert.ok(e instanceof CodingScopeViolationError)}
    assert.strictEqual(writeCalled,false);
    assert.strictEqual(prCreated,false);
  });

  await t.test('locks exact TARGET_EMPLOYEE without silent failover',()=>{
    const resources=[{id:'NV09'},{id:'NV12'}];
    assert.strictEqual(selectCodingWorker(resources,'NV09',()=>resources[1]).id,'NV09');
    assert.strictEqual(selectCodingWorker([{id:'NV12'}],'NV09',()=>resources[1]),null);
    assert.strictEqual(selectCodingWorker(resources,'',()=>resources[1]).id,'NV09');
  });

  await t.test('resolves only source or allowlisted TARGET_REPOSITORY',()=>{
    assert.strictEqual(targetRepositoryFromObjective('TARGET_REPOSITORY=newsdayads/tigeriq-media\nPRIORITY=P1'),'newsdayads/tigeriq-media');
    assert.deepStrictEqual(resolveCodingRepository(''),{owner:'newsdayads',repo:'tigeriq-ai-lab',fullName:'newsdayads/tigeriq-ai-lab',isSource:true});
    assert.deepStrictEqual(resolveCodingRepository('newsdayads/tigeriq-media'),{owner:'newsdayads',repo:'tigeriq-media',fullName:'newsdayads/tigeriq-media',isSource:false});
    assert.throws(()=>resolveCodingRepository('bad value'),/CODING_TARGET_REPOSITORY_INVALID/);
    assert.throws(()=>resolveCodingRepository('other/private'),/CODING_TARGET_REPOSITORY_NOT_ALLOWED/);
  });

  await t.test('requires both tigeriq-media verify checks to pass',()=>{
    const target=resolveCodingRepository('newsdayads/tigeriq-media');
    assert.strictEqual(checkRepositoryGateState([{name:'verify',status:'completed',conclusion:'success'}],target).state,'pending');
    assert.strictEqual(checkRepositoryGateState([
      {name:'verify',status:'completed',conclusion:'success'},
      {name:'verify',status:'completed',conclusion:'success'},
    ],target).state,'passed');
    assert.strictEqual(checkRepositoryGateState([
      {name:'verify',status:'completed',conclusion:'success'},
      {name:'verify',status:'completed',conclusion:'failure'},
    ],target).state,'failed');
  });

  await t.test('validates objective routing input as an exact target/PR-head pair',()=>{
    const head='9b31b1885e8c31a97519ddaecf0dfa3a5917269b';
    assert.deepStrictEqual(validateObjectiveRoutingInput({targetEmployee:'nv09',currentPr:1870,targetHead:head}),{
      targetEmployee:'NV09',currentPr:1870,targetHead:head
    });
    assert.throws(()=>validateObjectiveRoutingInput({targetEmployee:'OTHER'}),/CODING_TARGET_EMPLOYEE_INVALID/);
    assert.throws(()=>validateObjectiveRoutingInput({currentPr:1870}),/CODING_CURRENT_PR_TARGET_HEAD_PAIR_REQUIRED/);
  });

  await t.test('accepts only the exact open same-repo existing PR identity',()=>{
    const head='9b31b1885e8c31a97519ddaecf0dfa3a5917269b';
    const pr={number:1870,state:'open',merged:false,head:{sha:head,ref:'feature-1870',repo:{full_name:'newsdayads/tigeriq-ai-lab'}},base:{repo:{full_name:'newsdayads/tigeriq-ai-lab'}}};
    assert.deepStrictEqual(validateExistingPrResume(pr,{number:1870,targetHead:head,repoFullName:'newsdayads/tigeriq-ai-lab'}),{
      number:1870,branch:'feature-1870',headSha:head
    });
    assert.throws(()=>validateExistingPrResume({...pr,state:'closed'},{number:1870,targetHead:head,repoFullName:'newsdayads/tigeriq-ai-lab'}),/EXISTING_PR_NOT_OPEN/);
    assert.throws(()=>validateExistingPrResume({...pr,merged:true},{number:1870,targetHead:head,repoFullName:'newsdayads/tigeriq-ai-lab'}),/EXISTING_PR_ALREADY_MERGED/);
    assert.throws(()=>validateExistingPrResume({...pr,head:{...pr.head,sha:'a'.repeat(40)}},{number:1870,targetHead:head,repoFullName:'newsdayads/tigeriq-ai-lab'}),/EXISTING_PR_TARGET_HEAD_MISMATCH/);
    assert.throws(()=>validateExistingPrResume({...pr,head:{...pr.head,repo:{full_name:'other/repo'}}},{number:1870,targetHead:head,repoFullName:'newsdayads/tigeriq-ai-lab'}),/EXISTING_PR_HEAD_REPO_MISMATCH/);
    const targetPr={...pr,base:{repo:{full_name:'newsdayads/tigeriq-media'}},head:{...pr.head,repo:{full_name:'newsdayads/tigeriq-media'}}};
    assert.deepStrictEqual(validateExistingPrResume(targetPr,{number:1870,targetHead:head,repoFullName:'newsdayads/tigeriq-media'}),{
      number:1870,branch:'feature-1870',headSha:head
    });
    assert.throws(()=>validateExistingPrResume(targetPr,{number:1870,targetHead:head,repoFullName:'newsdayads/tigeriq-ai-lab'}),/EXISTING_PR_BASE_REPO_MISMATCH/);
  });

  await t.test('marks behind or diverged existing PRs for three-way base update',()=>{
    assert.strictEqual(existingPrNeedsBaseUpdate({status:'diverged',behind_by:3}),true);
    assert.strictEqual(existingPrNeedsBaseUpdate({status:'behind',behind_by:2}),true);
    assert.strictEqual(existingPrNeedsBaseUpdate({status:'ahead',behind_by:0}),false);
  });
});
